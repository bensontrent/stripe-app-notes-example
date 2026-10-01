// src/lib/env.ts
//
// ============================================================================
//  Environment resolution — Stripe Projects names ⇄ classic names
// ============================================================================
//
// The backend connects to Supabase in one of two ways:
//
//   • Your own Supabase project (the default) — `npm run setup` asks for the
//     connection string and API keys and writes the classic names to
//     .env.local: DATABASE_URL, NEXT_PUBLIC_SUPABASE_URL,
//     SUPABASE_SERVICE_ROLE_KEY (+ optional SUPABASE_SCHEMA).
//
//   • Stripe Projects — `stripe projects add supabase/project` provisions a
//     brand-new Supabase project and writes provider-named variables to .env:
//       SUPABASE_PROJECT_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_POOLER_URL,
//       SUPABASE_DB_URL, SUPABASE_PROJECT_REF, SUPABASE_DB_PASS
//       (+ SUPABASE_SECRET_KEY when the provider includes one).
//     The provider can't target an existing project or a dedicated schema,
//     which is why it isn't the default — but it is a supported option.
//
// The rest of the codebase only ever reads the classic names. This module
// maps each classic name onto the first configured value among its aliases
// and writes the result back onto process.env, so `process.env.DATABASE_URL`
// is populated either way. It is imported by lib/supabase.ts and lib/auth.ts,
// so anything that touches the database has already run it.
//
// Precedence: a classic name always wins over a provider name, and Next.js
// loads .env.local over .env — so values in .env.local beat provisioned
// values in .env. Placeholder values copied from .env.example (REPLACE_ME,
// your-…, …) count as unset.
//
// scripts/env.mjs mirrors this table for the CLI scripts (setup, db:setup,
// deploy). Keep the two in sync.

export const ENV_ALIASES = {
  // Postgres connection string — Better Auth and `npm run db:setup` connect
  // here. Supabase's provider emits a direct URL and a pooler URL; prefer the
  // pooler: it works on IPv4-only networks and with serverless hosts.
  DATABASE_URL: ['SUPABASE_POOLER_URL', 'SUPABASE_DB_URL'],
  NEXT_PUBLIC_SUPABASE_URL: ['SUPABASE_PROJECT_URL', 'SUPABASE_URL'],
  // Supabase renamed service_role → "secret key" (sb_secret_…). Both bypass
  // Row Level Security, so both are fine for the server-side client.
  SUPABASE_SERVICE_ROLE_KEY: ['SUPABASE_SECRET_KEY'],
  NEXT_PUBLIC_SUPABASE_ANON_KEY: ['SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_ANON_KEY'],
} as const;

export type CanonicalEnvName = keyof typeof ENV_ALIASES;

/**
 * A value counts as configured when it isn't blank or one of the placeholder
 * shapes used by .env.example. Mirrored in scripts/env.mjs.
 */
export function isConfigured(value: string | undefined): value is string {
  if (!value || value.trim() === '') return false;
  return !/REPLACE_ME|your-|\.\.\.$|\[YOUR-PASSWORD\]|localhost:5432\/dbname/.test(value);
}

const sources: Partial<Record<CanonicalEnvName, string>> = {};

for (const [canonical, aliases] of Object.entries(ENV_ALIASES) as Array<
  [CanonicalEnvName, readonly string[]]
>) {
  for (const name of [canonical, ...aliases]) {
    const value = process.env[name];
    if (isConfigured(value)) {
      process.env[canonical] = value.trim();
      sources[canonical] = name;
      break;
    }
  }
}

/**
 * Which variable a classic name was resolved from — e.g. `DATABASE_URL` came
 * from `SUPABASE_POOLER_URL`. Undefined when nothing configured it.
 */
export function envSource(name: CanonicalEnvName): string | undefined {
  return sources[name];
}
