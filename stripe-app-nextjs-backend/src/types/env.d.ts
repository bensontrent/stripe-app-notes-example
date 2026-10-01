// Environment variable type definitions.
//
// The code reads the "classic" names. When Supabase is provisioned through
// Stripe Projects instead of connected by hand, `stripe projects env --pull`
// writes provider names to .env — src/lib/env.ts maps them onto the classic
// names at startup, so either set works.
declare global {
  namespace NodeJS {
    interface ProcessEnv {
      // ----------------------------------------------------------------
      // Database (Supabase Postgres) — classic names, set in .env.local
      // ----------------------------------------------------------------
      /** Postgres connection string (Better Auth + `npm run db:setup`). */
      DATABASE_URL: string;
      /** Optional dedicated schema for the app's tables (defaults to public). */
      SUPABASE_SCHEMA?: string;
      NEXT_PUBLIC_SUPABASE_URL: string;
      NEXT_PUBLIC_SUPABASE_ANON_KEY?: string;
      /** Server-only. Bypasses RLS — never expose to the browser. */
      SUPABASE_SERVICE_ROLE_KEY: string;

      // ----------------------------------------------------------------
      // Optional: written by Stripe Projects (`stripe projects add supabase/project`)
      // ----------------------------------------------------------------
      SUPABASE_PROJECT_URL?: string;
      SUPABASE_PUBLISHABLE_KEY?: string;
      SUPABASE_SECRET_KEY?: string;
      SUPABASE_POOLER_URL?: string;
      SUPABASE_DB_URL?: string;
      SUPABASE_PROJECT_REF?: string;
      SUPABASE_DB_PASS?: string;

      // Written by Stripe Projects (`stripe projects add vercel/project`);
      // read only by scripts/deploy-vercel.mjs, never at runtime.
      VERCEL_TOKEN?: string;
      VERCEL_PROJECT_ID?: string;
      VERCEL_TEAM_ID?: string;
      VERCEL_ORG_ID?: string;
      VERCEL_PROJECT_URL?: string;

      // ----------------------------------------------------------------
      // Better Auth
      // ----------------------------------------------------------------
      BETTER_AUTH_SECRET: string;
      BETTER_AUTH_URL: string;

      // ----------------------------------------------------------------
      // Stripe API keys & webhook secrets (see src/lib/stripe.ts)
      // ----------------------------------------------------------------
      STRIPE_SECRET_KEY_LIVE: string;
      STRIPE_SECRET_KEY_TEST: string;
      STRIPE_SECRET_KEY_MANAGED_SANDBOX: string;
      STRIPE_WEBHOOK_SECRET_LIVE_CONNECTED: string;
      STRIPE_WEBHOOK_SECRET_TEST_CONNECTED: string;
      STRIPE_WEBHOOK_SECRET_MANAGED_SANDBOX_CONNECTED: string;
      STRIPE_WEBHOOK_SECRET_LIVE_ACCOUNT?: string;
      STRIPE_WEBHOOK_SECRET_TEST_ACCOUNT?: string;
      /** Your own acct_… id — what `type=account` webhook events are about. */
      STRIPE_APP_ACCOUNT_ID?: string;
      STRIPE_BILLING_SECRET_KEY_LIVE?: string;
      STRIPE_BILLING_SECRET_KEY_TEST?: string;
      STRIPE_BILLING_WEBHOOK_SECRET_LIVE?: string;
      STRIPE_BILLING_WEBHOOK_SECRET_TEST?: string;

      // ----------------------------------------------------------------
      // Paywall & billing (src/lib/paywall.ts + src/lib/billing.ts)
      // ----------------------------------------------------------------
      /** Days a free trial lasts. Default 90; 0 = no time limit. */
      TRIAL_DAYS_LIMIT?: string;
      /** Notes a trial includes. Default 100; 0 = no cap. */
      TRIAL_COUNT_LIMIT?: string;
      /** 'true' applies the paywall in test mode too (for rehearsing it). */
      PAYWALL_ENFORCE_IN_TEST_MODE?: string;
      /** Which mode the website's /billing page charges in. Default 'test'. */
      BILLING_ENVIRONMENT?: 'live' | 'test';

      // ----------------------------------------------------------------
      // Proxy authentication (src/proxy.ts + src/lib/proxy-auth.ts)
      // ----------------------------------------------------------------
      /** Stripe App signing secret — verifies `stripe-signature` headers. */
      STRIPE_APP_SIGNING_SECRET: string;
      /** Comma-separated bearer keys for `Authorization: Bearer <key>`. */
      BEARER_TOKEN_KEYS?: string;
      /** Accepted as a bearer key; Vercel Cron sends it when it is set. */
      CRON_SECRET?: string;
      /** Bearer key accepted ONLY when NODE_ENV=development. */
      DEV_API_KEY?: string;

      // ----------------------------------------------------------------
      // Email (src/lib/email.ts) — optional
      // ----------------------------------------------------------------
      POSTMARK_SERVER_API_TOKEN?: string;
      /** A sender signature or domain verified in Postmark. */
      POSTMARK_FROM_EMAIL?: string;
      /** Defaults to 'outbound'. */
      POSTMARK_MESSAGE_STREAM?: string;

      // App
      NODE_ENV: 'development' | 'production' | 'test';
    }
  }
}

export {};
