// scripts/env.mjs — env loading + name resolution shared by the CLI scripts.
//
// Mirrors src/lib/env.ts: the app reads the classic variable names
// (DATABASE_URL, NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, …). When
// Supabase was provisioned through Stripe Projects instead of connected by
// hand, `stripe projects env --pull` writes provider names (SUPABASE_POOLER_URL,
// SUPABASE_PROJECT_URL, SUPABASE_SECRET_KEY, …) to .env — either works.
// Keep the two tables in sync.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import dotenv from 'dotenv';

export const ENV_ALIASES = {
  DATABASE_URL: ['SUPABASE_POOLER_URL', 'SUPABASE_DB_URL'],
  NEXT_PUBLIC_SUPABASE_URL: ['SUPABASE_PROJECT_URL', 'SUPABASE_URL'],
  SUPABASE_SERVICE_ROLE_KEY: ['SUPABASE_SECRET_KEY'],
  NEXT_PUBLIC_SUPABASE_ANON_KEY: ['SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_ANON_KEY'],
};

/** Blank or a placeholder copied from .env.example counts as unset. */
export function isConfigured(value) {
  if (!value || String(value).trim() === '') return false;
  return !/REPLACE_ME|your-|\.\.\.$|\[YOUR-PASSWORD\]|localhost:5432\/dbname/.test(value);
}

/**
 * Fill each classic name from the first configured alias, in place.
 * Returns { classicName: nameItCameFrom } for everything that resolved.
 */
export function applyAliases(env) {
  const sources = {};
  for (const [canonical, aliases] of Object.entries(ENV_ALIASES)) {
    for (const name of [canonical, ...aliases]) {
      if (isConfigured(env[name])) {
        env[canonical] = String(env[name]).trim();
        sources[canonical] = name;
        break;
      }
    }
  }
  return sources;
}

/**
 * Load .env.local and .env into process.env with Next.js precedence
 * (.env.local wins; values already in process.env win over both), then
 * resolve aliases. Returns the sources map from applyAliases().
 *
 * `override` re-reads the files even for keys already in process.env — used
 * after `stripe projects add …` rewrote .env mid-run.
 */
export function loadEnv(root, { override = false } = {}) {
  for (const file of ['.env.local', '.env']) {
    const filePath = join(root, file);
    // quiet: dotenv v17 prints an "injected env" tip to stdout by default,
    // which would corrupt the SQL that `db:setup --print` emits.
    if (existsSync(filePath)) dotenv.config({ path: filePath, quiet: true, override });
  }
  return applyAliases(process.env);
}
