#!/usr/bin/env node
/*
 * scripts/setup.mjs — first-time setup, safe to re-run.
 *
 *   npm run setup                    walk through anything missing, create the tables
 *   npm run setup -- --dry-run       show what would be written, write nothing
 *   npm run setup -- --no-db         skip the database step
 *   npm run setup -- --non-interactive  never prompt (also the default when
 *                                    stdin isn't a terminal, e.g. in CI)
 *
 * It only ever ADDS missing values to .env.local and never overwrites what is
 * already there, so run it as often as you like.
 *
 * What it does:
 *   1. Loads .env (written by `stripe projects env --pull`) and .env.local.
 *   2. Connects a Supabase database. Default: a project of your own — an
 *      existing one or a new free one, into `public` or a dedicated schema.
 *      Option: let Stripe Projects provision a brand-new project
 *      (`stripe projects add supabase/project`); its variables land in .env
 *      and src/lib/env.ts maps them onto the names the backend reads.
 *   3. Generates the random secrets the backend needs (Better Auth, JWT-in-URL
 *      tokens, bearer keys) with node:crypto — nothing leaves your machine.
 *   4. Picks up your Stripe test-mode key from the Stripe CLI (`stripe login`),
 *      or asks for it.
 *   5. Creates the database tables from setup.sql when they don't exist yet.
 *   6. Prints what is still missing (webhook secret, app signing secret, …).
 *
 * Plain Node 20+, no dependencies beyond what the backend already has.
 */

import { exec, execFileSync, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { ensureTables, isValidSchemaName } from './db-setup.mjs';
import { isConfigured, loadEnv } from './env.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const envLocalPath = path.join(root, '.env.local');
const dryRun = process.argv.includes('--dry-run');
const skipDb = process.argv.includes('--no-db');
const interactive = Boolean(process.stdin.isTTY) && !process.argv.includes('--non-interactive');
const isWindows = process.platform === 'win32';

// --- tiny terminal helpers ---------------------------------------------------

const tty = process.stdout.isTTY;
const paint = (code) => (s) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
const bold = paint('1');
const dim = paint('2');
const red = paint('31');
const green = paint('32');
const yellow = paint('33');
const cyan = paint('36');
const ok = (s) => console.log(`${green('✔')} ${s}`);
const warn = (s) => console.log(`${yellow('•')} ${s}`);

let rl;
function readline() {
  rl ??= createInterface({ input: process.stdin, output: process.stdout });
  return rl;
}

async function ask(question, { def = '', validate } = {}) {
  for (;;) {
    const suffix = def ? ` ${dim(`(${def})`)}` : '';
    const raw = await readline().question(`${cyan('?')} ${question}${suffix} `);
    const answer = raw.trim() || def;
    if (!validate) return answer;
    const problem = validate(answer);
    if (!problem) return answer;
    console.log(red(`  ${problem}`));
  }
}

async function yesNo(question, def = true) {
  const answer = await ask(`${question} ${dim(def ? '[Y/n]' : '[y/N]')}`);
  if (!answer) return def;
  return /^y/i.test(answer);
}

async function choose(question, options) {
  console.log(`\n${bold(question)}`);
  options.forEach((opt, i) => console.log(`  ${cyan(String(i + 1))}) ${opt}`));
  const n = await ask('Choose', {
    def: '1',
    validate: (v) =>
      /^\d+$/.test(v) && +v >= 1 && +v <= options.length
        ? null
        : `Enter a number between 1 and ${options.length}`,
  });
  return +n - 1;
}

function openInBrowser(url) {
  const cmd =
    isWindows ? `start "" "${url}"`
      : process.platform === 'darwin' ? `open "${url}"`
        : `xdg-open "${url}"`;
  exec(cmd, () => {}); // best effort — the URL is printed either way
}

const secret = () => randomBytes(32).toString('hex');

// --- Stripe CLI: reuse the test-mode key from `stripe login` -----------------

function parseConfigAssignment(line, key) {
  const match = line.match(new RegExp(`^${key}\\s*=\\s*(?:'([^']*)'|"([^"]*)"|([^\\s]+))`));
  if (!match) return '';
  return (match[1] || match[2] || match[3] || '').trim();
}

// `stripe config --list` prints a TOML-ish file: a `project-name = '…'`
// pointer to the active profile, then one [section] per profile holding
// test_mode_api_key. Newer CLIs store a restricted key (rk_test_…), older
// ones a secret key (sk_test_…); the backend accepts both.
function parseStripeCliConfig(config) {
  let profileName = 'default';
  for (const line of config.split(/\r?\n/)) {
    const value = parseConfigAssignment(line.trim(), 'project-name');
    if (value) {
      profileName = value;
      break;
    }
  }
  const headers = new Set([`[${profileName}]`, `["${profileName}"]`, `['${profileName}']`]);
  let inSection = false;
  for (const line of config.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (/^\[/.test(trimmed)) {
      inSection = headers.has(trimmed);
      continue;
    }
    if (!inSection) continue;
    const key = parseConfigAssignment(trimmed, 'test_mode_api_key');
    if (/^(sk|rk)_test_/.test(key) && !key.includes('*')) return { profileName, key };
  }
  return { profileName: '', key: '' };
}

function stripeTestKeyFromCli() {
  try {
    const output = execFileSync('stripe', ['config', '--list'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      shell: isWindows, // `stripe` is a .cmd shim on Windows
    });
    return parseStripeCliConfig(output);
  } catch {
    const configPath =
      process.env.STRIPE_CONFIG?.trim() || path.join(os.homedir(), '.config', 'stripe', 'config.toml');
    if (!fs.existsSync(configPath)) return { profileName: '', key: '' };
    return parseStripeCliConfig(fs.readFileSync(configPath, 'utf8'));
  }
}

// --- the setup -----------------------------------------------------------------

async function main() {
  console.log(`
${bold('Stripe App backend — setup')}
${dim(`Adds missing values to ${path.relative(process.cwd(), envLocalPath) || envLocalPath}. Nothing leaves your machine.`)}${dryRun ? yellow('\nDRY RUN — nothing will be written.') : ''}${interactive ? '' : dim('\nNon-interactive: anything that needs a prompt is listed at the end instead.')}
`);

  let sources = loadEnv(root);
  const have = (key) => isConfigured(process.env[key]);
  const from = (key) => (sources[key] && sources[key] !== key ? dim(` (from ${sources[key]})`) : '');
  const additions = {};
  const add = (key, value) => {
    additions[key] = value;
    process.env[key] = value;
  };
  let provisionedByProjects = sources.DATABASE_URL && sources.DATABASE_URL !== 'DATABASE_URL';

  // 1. Database.
  if (have('DATABASE_URL')) {
    ok(`DATABASE_URL set${from('DATABASE_URL')} — kept as-is.`);
  } else if (!interactive) {
    warn(
      'DATABASE_URL is not set. Run `npm run setup` in a terminal to be walked through it, set it in\n' +
        '  .env.local, or provision a new project with `stripe projects add supabase/project`.',
    );
  } else {
    const pick = await choose('Where is your Postgres database? (Supabase free tier works)', [
      'I already have a Supabase project — paste its connection string',
      "I don't have one — help me create a free Supabase project",
      'Let Stripe Projects provision a new Supabase project (runs `stripe projects add supabase/project`)',
      'Skip for now',
    ]);
    if (pick === 1) {
      console.log(`
  1. Sign in at Supabase ${cyan('https://database.new')} — it drops you straight into a "new project" form
  2. Pick any name and region, set a ${bold('database password')} and keep it handy
  3. Wait a couple of minutes while the project provisions
`);
      if (await yesNo('Open https://database.new in your browser now?')) openInBrowser('https://database.new');
    }
    if (pick === 0 || pick === 1) {
      console.log(`
  In the Supabase dashboard, click ${bold('Connect')} in the top toolbar and copy a
  connection string. ${bold('Session pooler')} is the safest default — it works on
  IPv4-only networks and with every command in this repo.
`);
      let url = await ask('Paste the connection string', {
        validate: (s) => (/^postgres(ql)?:\/\//.test(s) ? null : 'That does not look like a postgres:// URL'),
      });
      if (url.includes('[YOUR-PASSWORD]')) {
        const pw = await ask('It still contains [YOUR-PASSWORD] — enter your database password');
        url = url.replace('[YOUR-PASSWORD]', encodeURIComponent(pw));
      }
      if (/:6543\//.test(url)) {
        console.log(
          yellow(
            '  Note: port 6543 is the transaction pooler. If anything fails to connect,\n' +
              '  copy the session pooler (port 5432) connection string instead.',
          ),
        );
      }
      add('DATABASE_URL', url);
    } else if (pick === 2) {
      console.log(
        dim(
          '\n  Stripe Projects creates a brand-new free-tier project (it cannot reuse an existing one\n' +
            '  or use a dedicated schema) and writes its credentials to .env. This may open a browser\n' +
            '  to link your Supabase account. Needs `stripe projects init` to have run in this folder.\n',
        ),
      );
      if (dryRun) {
        warn('Would run `stripe projects add supabase/project` (dry run).');
      } else {
        const res = spawnSync('stripe', ['projects', 'add', 'supabase/project'], {
          cwd: root,
          stdio: 'inherit',
          shell: isWindows,
        });
        if (res.status === 0) {
          sources = loadEnv(root, { override: true });
          provisionedByProjects = true;
          if (have('DATABASE_URL')) ok(`DATABASE_URL set${from('DATABASE_URL')}.`);
          else warn('Provisioning finished but .env has no connection string yet — try `stripe projects env --pull`.');
        } else {
          console.log(red('✖ `stripe projects add supabase/project` did not succeed — see the output above.'));
        }
      }
    } else {
      console.log(dim('  Skipped — the checklist at https://localhost:3006 will remind you.'));
    }
  }

  // 2. Supabase API keys — the backend's data access goes through supabase-js.
  if (have('NEXT_PUBLIC_SUPABASE_URL') && have('SUPABASE_SERVICE_ROLE_KEY')) {
    ok(`Supabase API keys set${from('NEXT_PUBLIC_SUPABASE_URL')}${from('SUPABASE_SERVICE_ROLE_KEY')} — kept as-is.`);
  } else if (!interactive) {
    warn('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set.');
  } else if (await yesNo('Add your Supabase API keys now? (dashboard → Project Settings → API Keys)')) {
    if (!have('NEXT_PUBLIC_SUPABASE_URL')) {
      add(
        'NEXT_PUBLIC_SUPABASE_URL',
        await ask('Project URL (https://....supabase.co)', {
          validate: (s) => (/^https:\/\//.test(s) ? null : 'That does not look like an https:// URL'),
        }),
      );
    }
    if (!have('SUPABASE_SERVICE_ROLE_KEY')) {
      add(
        'SUPABASE_SERVICE_ROLE_KEY',
        await ask('Secret (service_role) key', {
          validate: (s) => (s ? null : 'Paste the secret key (it stays on your machine)'),
        }),
      );
    }
  } else {
    console.log(dim('  Skipped — the checklist at https://localhost:3006 will remind you.'));
  }

  // 3. public schema, or a dedicated one on a shared project? (Only worth
  //    asking for a project of your own — a Projects-provisioned one is fresh.)
  if (have('SUPABASE_SCHEMA')) {
    ok(`SUPABASE_SCHEMA already set to "${process.env.SUPABASE_SCHEMA}" — kept as-is.`);
  } else if (interactive && !provisionedByProjects) {
    const pick = await choose('Which Postgres schema should the tables live in?', [
      'public — the default, simplest choice',
      "A dedicated schema — reuse a Supabase project you already have (doesn't use up a free-tier project slot)",
    ]);
    if (pick === 1) {
      const schema = await ask('Schema name', {
        def: 'stripe_app',
        validate: (s) => (isValidSchemaName(s) ? null : 'Lowercase letters, digits and _ only, starting with a letter'),
      });
      add('SUPABASE_SCHEMA', schema);
      console.log(dim('  The database step below creates the schema and its tables automatically.'));
      console.log(
        yellow(
          `  One manual step: in the Supabase dashboard, open Project Settings → Data API → Settings and add\n  "${schema}" to "Exposed schemas" — the backend can't query it until then.`,
        ),
      );
    }
  }

  // 4. Random secrets — generated locally, no openssl needed.
  const generated = [];
  for (const key of ['BETTER_AUTH_SECRET', 'BEARER_TOKEN_KEYS', 'CRON_SECRET', 'DEV_API_KEY']) {
    if (!have(key)) {
      add(key, secret());
      generated.push(key);
    }
  }
  ok(
    generated.length > 0
      ? `Generated random secrets: ${generated.join(', ')}`
      : 'All random secrets already set — kept as-is.',
  );

  // 5. URLs for local development.
  if (!have('BETTER_AUTH_URL')) add('BETTER_AUTH_URL', 'https://localhost:3006');
  if (!have('NEXT_PUBLIC_BETTER_AUTH_URL')) add('NEXT_PUBLIC_BETTER_AUTH_URL', 'https://localhost:3006');

  // 6. Stripe test key — reuse the Stripe CLI's login instead of pasting.
  if (have('STRIPE_SECRET_KEY_TEST')) {
    ok('STRIPE_SECRET_KEY_TEST already set — kept as-is.');
  } else {
    const { profileName, key } = stripeTestKeyFromCli();
    if (key) {
      add('STRIPE_SECRET_KEY_TEST', key);
      ok(`STRIPE_SECRET_KEY_TEST taken from the Stripe CLI (profile "${profileName}").`);
    } else if (interactive && (await yesNo('No Stripe CLI login found. Paste your Stripe test-mode secret key now?'))) {
      if (await yesNo('Open https://dashboard.stripe.com/test/apikeys in your browser?')) {
        openInBrowser('https://dashboard.stripe.com/test/apikeys');
      }
      add(
        'STRIPE_SECRET_KEY_TEST',
        await ask('Paste the test secret key (sk_test_...)', {
          validate: (s) =>
            /^(sk|rk)_test_/.test(s) ? null : 'Test secret keys start with sk_test_ (or rk_test_ for restricted keys)',
        }),
      );
    } else {
      warn('No Stripe test key yet — `stripe login` and re-run, or paste one into STRIPE_SECRET_KEY_TEST in .env.local.');
    }
  }

  // 7. Write .env.local — append only; existing lines are never touched.
  const keys = Object.keys(additions);
  if (keys.length === 0) {
    ok('.env.local already has everything this script can provide.');
  } else {
    const header = fs.existsSync(envLocalPath)
      ? ''
      : [
          '# ============================================================================',
          '#  Local secrets & configuration — created by `npm run setup`.',
          '#  See .env.example for what every variable does. (.env, if present, holds',
          '#  credentials written by `stripe projects env --pull`; this file wins.)',
          '# ============================================================================',
          '',
        ].join('\n');
    const block =
      `${header}\n# --- Added by \`npm run setup\` on ${new Date().toISOString().slice(0, 10)} ---\n` +
      keys.map((key) => `${key}=${additions[key]}`).join('\n') +
      '\n';
    if (dryRun) {
      console.log(`\n${dim('--- would append to .env.local ---')}\n${block}`);
    } else {
      fs.appendFileSync(envLocalPath, block);
      ok(`Wrote ${keys.length} value${keys.length === 1 ? '' : 's'} to .env.local: ${keys.join(', ')}`);
    }
  }

  // 8. Database tables.
  const schema = process.env.SUPABASE_SCHEMA || 'public';
  if (skipDb) {
    warn('Database step skipped (--no-db).');
  } else if (!have('DATABASE_URL')) {
    warn('No DATABASE_URL yet — skipping table creation.');
  } else if (!isValidSchemaName(schema)) {
    console.log(red(`✖ SUPABASE_SCHEMA "${schema}" is not a valid schema name.`));
    process.exitCode = 1;
  } else if (dryRun) {
    warn(`Would create the tables in schema "${schema}" (dry run).`);
  } else if (!interactive || (await yesNo('Create or update the database tables now? (applies setup.sql and new migrations; safe to re-run, keeps data)'))) {
    try {
      const { state, migrations } = await ensureTables({ connectionString: process.env.DATABASE_URL, schema });
      const ran = migrations.length > 0 ? ` + ${migrations.length} from migrations/` : '';
      ok(
        state === 'created'
          ? `Database tables created in schema "${schema}" (setup.sql${ran}).`
          : `Database tables in schema "${schema}" brought up to date (setup.sql${ran}).`,
      );
    } catch (err) {
      console.log(
        red(`✖ Could not create the tables: ${err.message}`) +
          dim('\n  Re-run with `npm run db:setup`, or paste setup.sql into the Supabase SQL editor.'),
      );
      process.exitCode = 1;
    }
  }

  // 9. What's left.
  const todo = [];
  if (!have('DATABASE_URL')) {
    todo.push(
      'Set DATABASE_URL in .env.local (Supabase → Connect → Session pooler) and re-run `npm run setup`,\n' +
        '    or provision a new project with `stripe projects add supabase/project`',
    );
  }
  if (!have('NEXT_PUBLIC_SUPABASE_URL') || !have('SUPABASE_SERVICE_ROLE_KEY')) {
    todo.push(
      provisionedByProjects
        ? 'Supabase secret key: `stripe projects open supabase` → Project Settings → API Keys, then either put it in\n' +
            '    .env.local as SUPABASE_SECRET_KEY or `stripe projects variables set supabase-secret-key --env-key SUPABASE_SECRET_KEY`'
        : 'Copy the project URL and secret (service_role) key (Project Settings → API Keys)\n' +
            '    into NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local',
    );
  }
  if (schema !== 'public') {
    todo.push(
      `Add "${schema}" to "Exposed schemas" in the Supabase dashboard (Settings → API)\n` +
        '    — the checklist verifies this once the tables exist',
    );
  }
  if (!have('STRIPE_SECRET_KEY_TEST')) todo.push('Paste your Stripe test key into STRIPE_SECRET_KEY_TEST in .env.local');
  if (!have('STRIPE_WEBHOOK_SECRET_TEST_CONNECTED')) {
    todo.push(
      'Local webhooks: `stripe listen --forward-connect-to "https://localhost:3006/api/webhooks/app?mode=test&type=connected" --forward-to "https://localhost:3006/api/webhooks/billing?mode=test" --skip-verify`\n' +
        '    → copy the printed whsec_… into STRIPE_WEBHOOK_SECRET_TEST_CONNECTED in .env.local',
    );
  }
  if (!have('STRIPE_APP_SIGNING_SECRET')) {
    todo.push(
      'After your first `stripe apps upload`: copy the app "Signing secret" from the Stripe\n' +
        '    Developers Dashboard into STRIPE_APP_SIGNING_SECRET in .env.local',
    );
  }

  console.log(`\n${bold(todo.length > 0 ? 'Still to do' : 'All set')}`);
  for (const item of todo) console.log(`  ${yellow('•')} ${item}`);
  console.log(`
  Start the backend with ${cyan('npm run dev')} — ${cyan('https://localhost:3006')} shows a live setup
  checklist that re-checks everything above on every reload.
`);
}

main()
  .catch((err) => {
    // stdin closing mid-question (Ctrl+D / piped input running out) lands here.
    console.error(red(`\nSetup did not finish: ${err?.message ?? err}`));
    process.exitCode = 1;
  })
  .finally(() => rl?.close());
