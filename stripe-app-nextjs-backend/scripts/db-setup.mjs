// scripts/db-setup.mjs — creates every table the backend expects: applies
// setup.sql (the baseline schema), then every file in migrations/ that this
// database hasn't had yet.
//
//   npm run db:setup              apply setup.sql and the pending migrations
//                                 (safe to re-run: setup.sql is idempotent
//                                 and each migration runs exactly once)
//   npm run db:setup -- --print   print the (schema-qualified) SQL a fresh
//                                 database needs instead — paste it into the
//                                 Supabase SQL editor
//
// Schema changes are new files in migrations/ (see migrations/README.md);
// setup.sql is not edited any more.
//
// Where the connection string comes from (first match wins, see env.mjs):
//   DATABASE_URL           your own Supabase project, set in .env.local by
//                          `npm run setup` (Session pooler string)
//   SUPABASE_POOLER_URL    written to .env when Supabase was provisioned with
//                          `stripe projects add supabase/project`
//   SUPABASE_DB_URL        ditto (direct connection; IPv6-only on Supabase)
//
// Set SUPABASE_SCHEMA to install everything into a dedicated schema instead
// of `public` — handy for reusing a Supabase project you already have. This
// script then creates the schema, installs the tables there, and grants
// Supabase's API roles access. One manual step remains: add the schema to
// "Exposed schemas" in the Supabase dashboard (Settings → API) so supabase-js
// can query it.
//
// `npm run setup` calls ensureTables() from here, so you rarely need to run
// this directly.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import pg from 'pg';
import { isConfigured, loadEnv } from './env.mjs';

export const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const migrationsDir = join(root, 'migrations');

export function isValidSchemaName(schema) {
  return /^[a-z_][a-z0-9_]*$/.test(schema);
}

/**
 * The .sql files in migrations/, oldest first. The UTC timestamp prefix is
 * what orders them, so a file without one is an error rather than a file
 * that silently runs out of order (or never).
 */
export function listMigrations() {
  if (!existsSync(migrationsDir)) return [];
  const files = readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .sort();
  const misnamed = files.find((file) => !/^\d{14}_[a-z0-9_]+\.sql$/.test(file));
  if (misnamed) {
    throw new Error(
      `migrations/${misnamed} is not named YYYYMMDDHHMMSS_description.sql (lowercase letters, digits and _ in the description).`,
    );
  }
  return files;
}

/** setup.sql, wrapped in the CREATE SCHEMA / GRANT statements a dedicated schema needs. */
export function buildSql(schema) {
  const sql = readFileSync(join(root, 'setup.sql'), 'utf8');
  if (schema === 'public') return sql;
  // Every statement in setup.sql is schema-unqualified (including the inline
  // REFERENCES clauses), so pointing search_path at the dedicated schema is
  // all it takes to install everything there.
  return [
    `CREATE SCHEMA IF NOT EXISTS "${schema}";`,
    `SET search_path TO "${schema}";`,
    '',
    sql,
    '',
    `-- Supabase's REST API roles need to reach the new schema. service_role does`,
    `-- the backend's actual work; anon/authenticated get USAGE only and RLS (no`,
    `-- policies) keeps them out of every table.`,
    `GRANT USAGE ON SCHEMA "${schema}" TO anon, authenticated, service_role;`,
    `GRANT ALL ON ALL TABLES IN SCHEMA "${schema}" TO service_role;`,
    `ALTER DEFAULT PRIVILEGES IN SCHEMA "${schema}" GRANT ALL ON TABLES TO service_role;`,
    '',
  ].join('\n');
}

/**
 * What `--print` emits: everything a FRESH database needs — buildSql() plus
 * every migration, each recorded in applied_migrations so a later
 * `npm run db:setup` doesn't run it again.
 */
export function buildPrintSql(schema) {
  const migrations = listMigrations();
  if (migrations.length === 0) return buildSql(schema);
  return [
    '-- For a FRESH database: setup.sql followed by every file in migrations/.',
    '-- On a database that already has the tables, run `npm run db:setup`',
    '-- instead (it applies only the migrations that database has not had yet);',
    '-- pasting this again would run every migration a second time.',
    '',
    buildSql(schema),
    ...migrations.flatMap((name) => [
      `-- migrations/${name}`,
      readFileSync(join(migrationsDir, name), 'utf8'),
      `INSERT INTO "applied_migrations" ("name") VALUES ('${name}') ON CONFLICT DO NOTHING;`,
      '',
    ]),
  ].join('\n');
}

/**
 * Apply setup.sql, then the migrations this database hasn't had yet.
 * setup.sql is idempotent, so this is safe to run on an empty database
 * (creates everything) and on an existing one (leaves data alone); each
 * migration runs once, in its own transaction, and is recorded in
 * applied_migrations. Resolves to `{ state, migrations }`: state is 'created'
 * when the tables didn't exist before and 'updated' otherwise, migrations
 * lists the files applied by this run. Throws on connection/SQL errors — a
 * failed migration is rolled back and the ones after it are not attempted.
 */
export async function ensureTables({ connectionString, schema }) {
  const migrations = listMigrations();
  const client = new pg.Client({ connectionString, connectionTimeoutMillis: 10_000 });
  await client.connect();
  try {
    const { rows } = await client.query(
      `select 1 from information_schema.tables where table_schema = $1 and table_name = 'users'`,
      [schema],
    );
    const existed = rows.length > 0;
    // One multi-statement query runs in a single implicit transaction:
    // either every statement applies, or none do. Its SET search_path (for a
    // dedicated schema) stays in effect for the migrations below.
    await client.query(buildSql(schema));

    const done = await client.query('select "name" from "applied_migrations"');
    const applied = new Set(done.rows.map((row) => row.name));
    const ran = [];
    for (const name of migrations) {
      if (applied.has(name)) continue;
      await client.query('BEGIN');
      try {
        // Claim the name first: a second db:setup running at the same moment
        // waits on this row and then fails, instead of applying the file twice.
        await client.query('insert into "applied_migrations" ("name") values ($1)', [name]);
        await client.query(readFileSync(join(migrationsDir, name), 'utf8'));
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`migrations/${name}: ${err.message}`);
      }
      ran.push(name);
    }
    return { state: existed ? 'updated' : 'created', migrations: ran };
  } finally {
    await client.end();
  }
}

async function main() {
  const printOnly = process.argv.includes('--print');
  const sources = loadEnv(root);
  const schema = process.env.SUPABASE_SCHEMA || 'public';

  if (!isValidSchemaName(schema)) {
    console.error(
      `SUPABASE_SCHEMA "${schema}" is not a valid schema name — use lowercase letters, digits and _ only, starting with a letter.`,
    );
    process.exit(1);
  }

  if (printOnly) {
    try {
      console.log(buildPrintSql(schema));
    } catch (err) {
      console.error(err.message);
      process.exitCode = 1;
    }
    return;
  }

  if (!isConfigured(process.env.DATABASE_URL)) {
    console.error(
      'No database connection string found — run `npm run setup` first (it asks for DATABASE_URL),\n' +
        'or `stripe projects env --pull` if Supabase was provisioned with Stripe Projects.',
    );
    process.exit(1);
  }

  try {
    const { state, migrations } = await ensureTables({
      connectionString: process.env.DATABASE_URL,
      schema,
    });
    const from = sources.DATABASE_URL === 'DATABASE_URL' ? '' : ` (via ${sources.DATABASE_URL})`;
    console.log(
      state === 'created'
        ? `setup.sql applied — all tables created in schema "${schema}"${from}.`
        : `setup.sql applied to the existing tables in schema "${schema}"${from} — anything new was added, data untouched.`,
    );
    console.log(
      migrations.length > 0
        ? `Migrations applied: ${migrations.join(', ')}.`
        : 'Migrations: nothing new to apply.',
    );
    if (schema !== 'public') {
      console.log(
        `\nOne manual step left: in the Supabase dashboard, open Settings → API and add\n"${schema}" to "Exposed schemas" — supabase-js can't query the schema until then.`,
      );
    }
  } catch (err) {
    console.error(`Failed to set up the database: ${err.message}`);
    process.exitCode = 1;
  }
}

// Run main() only when invoked directly (`node scripts/db-setup.mjs`), not
// when setup.mjs imports ensureTables().
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
