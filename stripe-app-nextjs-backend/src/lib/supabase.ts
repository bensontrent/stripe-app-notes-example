import { createClient, SupabaseClient } from '@supabase/supabase-js';
// Maps Stripe Projects variable names (SUPABASE_PROJECT_URL, …) onto the classic
// names read below, for people who provision Supabase through Projects.
import './env';

// Which Postgres schema the app's tables live in. Defaults to `public`; set
// SUPABASE_SCHEMA in .env.local to install everything into a dedicated schema
// instead — handy for reusing a Supabase project you already have without
// burning one of the free tier's project slots. `npm run db:setup` creates
// the schema; you must also add it to "Exposed schemas" in the Supabase
// dashboard (Settings → API) so supabase-js can query it.
export const dbSchema = process.env.SUPABASE_SCHEMA || 'public';

// The name is interpolated into SQL (search_path) and PostgREST headers, so
// only allow plain identifiers.
if (!/^[a-z_][a-z0-9_]*$/.test(dbSchema)) {
  throw new Error(
    `SUPABASE_SCHEMA "${dbSchema}" is not a valid schema name — use lowercase letters, digits and _ only, starting with a letter.`,
  );
}

// Server-side Supabase client for all application data access.
//
// The service-role key bypasses Row Level Security (setup.sql enables RLS on
// every table so the public anon key can't touch them), so this client must
// only ever be used from server code — API routes and server components —
// never from anything that ships to the browser.
//
// Created lazily on first use so that merely importing this module (e.g.
// during `next build`) doesn't require the env vars to be set yet.
// The extra type params loosen the client's schema name from the literal
// "public" to any string, since dbSchema is only known at runtime.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AppSupabaseClient = SupabaseClient<any, any, string>;

let client: AppSupabaseClient | undefined;

export function getSupabase(): AppSupabaseClient {
  client ??= createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      db: { schema: dbSchema },
      auth: { persistSession: false },
    },
  );
  return client;
}
