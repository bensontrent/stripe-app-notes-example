// scripts/deploy-vercel.mjs — `npm run deploy`
//
// Publishes this backend to the Vercel project that Stripe Projects created
// (`stripe projects add vercel/project`), using only the credentials that
// `stripe projects env --pull` wrote to .env:
//
//   VERCEL_TOKEN, VERCEL_PROJECT_ID, VERCEL_TEAM_ID / VERCEL_ORG_ID,
//   VERCEL_PROJECT_URL
//
// Steps:
//   1. Load .env and .env.local (same precedence as Next.js).
//   2. Sync every runtime variable to the Vercel project's production
//      environment — Supabase credentials, Better Auth + proxy secrets, Stripe
//      keys — with BETTER_AUTH_URL pointed at the production URL. The
//      Vercel credentials themselves and dev-only values are never synced.
//   3. Upload the source files and start a production deployment. Vercel
//      builds it (`next build`) on its side.
//
// Adapted from Stripe's nextjs-saas template (github.com/stripe/projects-templates,
// MIT). No Vercel CLI needed — plain REST calls.

import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { applyAliases } from './env.mjs';

const IGNORED_DIRECTORIES = new Set(['.git', '.next', '.vercel', '.projects', 'node_modules']);
const IGNORED_FILE_PATTERNS = [/^\.env(?:\..+)?$/, /\.log$/i, /\.tsbuildinfo$/];

// Never sent to the deployment: the deploy credentials themselves, values
// that only make sense on a developer machine, and raw provider extras the
// app doesn't read.
const DEPLOY_ENV_DENYLIST = new Set([
  'VERCEL_TOKEN',
  'VERCEL_ORG_ID',
  'VERCEL_TEAM_ID',
  'VERCEL_PROJECT_ID',
  'VERCEL_PROJECT_LINK',
  'VERCEL_PROJECT_URL',
  'VERCEL_URL',
  'DEV_API_KEY', // only honoured under `next dev` anyway
  'NODE_ENV', // Vercel sets it
  'SUPABASE_DB_PASS', // already embedded in the connection strings
]);

// Rewritten to the production URL when VERCEL_PROJECT_URL is known.
const PRODUCTION_URL_KEYS = ['BETTER_AUTH_URL', 'NEXT_PUBLIC_BETTER_AUTH_URL'];

const PLACEHOLDER = /REPLACE_ME|your-|\.\.\.$|\[YOUR-PASSWORD\]|localhost:5432\/dbname/;

function normalizePath(relativePath) {
  return relativePath.split(path.sep).join('/');
}

function shouldIgnoreFile(relativePath) {
  const parts = normalizePath(relativePath).split('/');
  const fileName = parts.at(-1) ?? '';
  if (parts.some((part) => IGNORED_DIRECTORIES.has(part))) return true;
  return IGNORED_FILE_PATTERNS.some((pattern) => pattern.test(fileName));
}

function parseEnvFile(contents) {
  const values = {};
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separatorIndex = line.indexOf('=');
    if (separatorIndex === -1) continue;
    const key = line.slice(0, separatorIndex).trim();
    let value = line.slice(separatorIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key) values[key] = value;
  }
  return values;
}

// .env first, then .env.local on top — .env.local wins, like in Next.js.
async function loadLocalEnv(rootDirectory) {
  const injectedKeys = new Set();
  const localValues = {};
  for (const fileName of ['.env', '.env.local']) {
    try {
      const contents = await fs.readFile(path.join(rootDirectory, fileName), 'utf8');
      const values = parseEnvFile(contents);
      Object.assign(localValues, values);
      for (const [key, value] of Object.entries(values)) {
        if (!Object.prototype.hasOwnProperty.call(process.env, key) || injectedKeys.has(key)) {
          process.env[key] = value;
          injectedKeys.add(key);
        }
      }
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') continue;
      throw error;
    }
  }
  return localValues;
}

async function collectProjectFiles(directory, rootDirectory, files = []) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);
    const relativePath = path.relative(rootDirectory, absolutePath);
    if (!relativePath || shouldIgnoreFile(relativePath)) continue;
    if (entry.isDirectory()) {
      await collectProjectFiles(absolutePath, rootDirectory, files);
      continue;
    }
    if (entry.isFile()) files.push(absolutePath);
  }
  return files;
}

function getVercelErrorMessage(payload, fallbackMessage) {
  if (payload && typeof payload === 'object') {
    const directError =
      typeof payload.error === 'string'
        ? payload.error
        : payload.error && typeof payload.error === 'object' && typeof payload.error.message === 'string'
          ? payload.error.message
          : null;
    if (directError) return directError;
    if (typeof payload.message === 'string') return payload.message;
  }
  return fallbackMessage;
}

function credentialsHint(status, fallbackMessage) {
  return status === 401 || status === 403
    ? 'The Vercel credentials from your Stripe project are no longer valid. Refresh them with `stripe projects env --pull` and try again.'
    : fallbackMessage;
}

async function readErrorPayload(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

/** https://<host> from whatever shape VERCEL_PROJECT_URL arrives in. */
function productionUrl() {
  const raw = process.env.VERCEL_PROJECT_URL?.trim();
  if (!raw) return null;
  const host = raw.replace(/^https?:\/\//, '').replace(/\/+$/, '');
  return host ? `https://${host}` : null;
}

function collectDeploymentEnvironmentValues(sourceValues) {
  const values = {};
  for (const [key, rawValue] of Object.entries(sourceValues)) {
    if (typeof rawValue !== 'string') continue;
    const trimmed = rawValue.trim();
    if (trimmed === '' || DEPLOY_ENV_DENYLIST.has(key)) continue;
    // Placeholders copied from .env.example would only break the deployment.
    if (PLACEHOLDER.test(trimmed)) continue;
    values[key] = trimmed;
  }

  // Make sure the classic names the app reads are present even when only
  // the Stripe Projects names are set locally.
  applyAliases(values);

  const url = productionUrl();
  for (const key of PRODUCTION_URL_KEYS) {
    if (url) values[key] = url;
    else if (values[key] && /localhost|127\.0\.0\.1/.test(values[key])) delete values[key];
  }
  return values;
}

async function syncProjectEnvironmentValues({ projectId, teamId, token, values }) {
  const syncedKeys = [];
  for (const [key, value] of Object.entries(values)) {
    const response = await fetch(
      `https://api.vercel.com/v10/projects/${encodeURIComponent(projectId)}/env?teamId=${encodeURIComponent(teamId)}&upsert=true`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, value, type: 'encrypted', target: ['production'] }),
      },
    );
    if (!response.ok) {
      const payload = await readErrorPayload(response);
      throw new Error(
        credentialsHint(
          response.status,
          getVercelErrorMessage(payload, `Unable to sync ${key} to the Vercel project environment.`),
        ),
      );
    }
    syncedKeys.push(key);
  }
  return syncedKeys;
}

async function uploadFileToVercel(absolutePath, rootDirectory, teamId, token) {
  const buffer = await fs.readFile(absolutePath);
  const sha = createHash('sha1').update(buffer).digest('hex');
  const file = normalizePath(path.relative(rootDirectory, absolutePath));

  const response = await fetch(`https://api.vercel.com/v2/files?teamId=${encodeURIComponent(teamId)}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Length': String(buffer.byteLength),
      'Content-Type': 'application/octet-stream',
      'x-vercel-digest': sha,
    },
    body: buffer,
  });

  if (!response.ok) {
    const payload = await readErrorPayload(response);
    throw new Error(
      credentialsHint(response.status, getVercelErrorMessage(payload, `Unable to upload ${file} to Vercel.`)),
    );
  }

  return { file, sha, size: buffer.byteLength };
}

async function main() {
  const rootDirectory = process.cwd();
  const localEnvValues = await loadLocalEnv(rootDirectory);

  const token = process.env.VERCEL_TOKEN?.trim();
  const projectId = process.env.VERCEL_PROJECT_ID?.trim();
  const teamId = process.env.VERCEL_TEAM_ID?.trim() || process.env.VERCEL_ORG_ID?.trim();

  if (!token || !projectId || !teamId) {
    throw new Error(
      'Vercel is not configured yet. Run `stripe projects add vercel/project` (then `stripe projects env --pull`) ' +
        'so VERCEL_TOKEN, VERCEL_PROJECT_ID and VERCEL_TEAM_ID are in .env.',
    );
  }

  const absolutePaths = await collectProjectFiles(rootDirectory, rootDirectory);
  if (absolutePaths.length === 0) throw new Error('No deployable files were found in this app.');

  const deploymentEnvironment = collectDeploymentEnvironmentValues(localEnvValues);
  const url = productionUrl();
  if (!url) {
    console.warn(
      'VERCEL_PROJECT_URL is not set, so BETTER_AUTH_URL was not pointed at production — set it in the Vercel dashboard after the first deploy.',
    );
  }

  console.log(`Uploading ${absolutePaths.length} files…`);
  const files = [];
  for (const absolutePath of absolutePaths) {
    files.push(await uploadFileToVercel(absolutePath, rootDirectory, teamId, token));
  }

  const syncedEnvironmentKeys = await syncProjectEnvironmentValues({
    projectId,
    teamId,
    token,
    values: deploymentEnvironment,
  });

  const response = await fetch(
    `https://api.vercel.com/v13/deployments?teamId=${encodeURIComponent(teamId)}&forceNew=1&skipAutoDetectionConfirmation=1`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        build: { env: deploymentEnvironment },
        env: deploymentEnvironment,
        files,
        name: process.env.NEXT_PUBLIC_APP_NAME?.trim() || path.basename(rootDirectory),
        project: projectId,
        projectSettings: { framework: 'nextjs' },
        target: 'production',
      }),
    },
  );

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(
      credentialsHint(response.status, getVercelErrorMessage(payload, 'Unable to start the Vercel deployment.')),
    );
  }

  const deploymentUrl = typeof payload.url === 'string' ? `https://${payload.url}` : null;
  const inspectorUrl = typeof payload.inspectorUrl === 'string' ? payload.inspectorUrl : null;

  console.log('Deployment started successfully.');
  if (syncedEnvironmentKeys.length > 0) {
    console.log(`Synced env vars: ${syncedEnvironmentKeys.sort().join(', ')}`);
  }
  if (inspectorUrl) console.log(`Inspect: ${inspectorUrl}`);
  if (deploymentUrl) console.log(`URL: ${deploymentUrl}`);

  const backend = url ?? deploymentUrl;
  if (backend) {
    console.log(`
Next, point the Stripe App at the deployed backend:
  • stripe-app/src/api/backend.ts   → BACKEND_BASE = '${backend}'
  • stripe-app/stripe-app.json      → connect-src: '${backend}/api/'
And create production webhook endpoints (Stripe Workbench → Webhooks):
  • ${backend}/api/webhooks/app?mode=test&type=connected
  • ${backend}/api/webhooks/app?mode=live&type=connected
  • ${backend}/api/webhooks/billing?mode=test      (in the account that bills for the app)
  • ${backend}/api/webhooks/billing?mode=live
then put each signing secret in the matching STRIPE_WEBHOOK_SECRET_* /
STRIPE_BILLING_WEBHOOK_SECRET_* variable and redeploy.`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Unable to start the Vercel deployment.');
  process.exitCode = 1;
});
