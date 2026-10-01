-- setup.sql — the baseline schema: every table and function the backend
-- expected when migrations/ was introduced (2026-09-30). The current schema
-- is this file plus every file in migrations/, applied in filename order.
--
-- Run it against your Supabase project, either way:
--   • paste it into the Supabase SQL editor (Dashboard → SQL Editor → Run), or
--   • npm run db:setup   (applies it over DATABASE_URL from .env.local)
--
-- It is SAFE TO RE-RUN: every statement is idempotent (CREATE TABLE IF NOT
-- EXISTS, CREATE INDEX IF NOT EXISTS, CREATE OR REPLACE FUNCTION, and the
-- "Upgrades" section at the end uses IF EXISTS / IF NOT EXISTS). Running it
-- on an empty database creates everything; running it on a database that
-- already has the tables adds whatever is new and leaves the data alone.
--
-- Tables land in the `public` schema. To share a Supabase project you already
-- use for something else, set SUPABASE_SCHEMA in .env.local and run
-- `npm run db:setup` instead — it creates the dedicated schema, installs
-- everything there, and grants the Supabase API roles access
-- (`npm run db:setup -- --print` prints that schema-qualified SQL if you
-- prefer the SQL editor). Then add the schema to "Exposed schemas" in the
-- Supabase dashboard (Settings → API).
--
-- To change the schema: DON'T edit this file. Add a new file to migrations/
-- (see migrations/README.md) and run `npm run db:setup`, which applies this
-- file and then every migration the database hasn't seen yet. Databases that
-- already hold data get the change the same way fresh installs do.
--
-- The shape, in three parts:
--
--   Better Auth      users, sessions, auth_accounts, verifications.
--                    auth_accounts is a sign-in method (credential or OAuth
--                    provider) — Better Auth's "account" model, unrelated to
--                    Stripe accounts. `users` also carries app-owned columns
--                    (billing customer ids); Better Auth ignores columns it
--                    doesn't know about.
--
--   Merchant side    stripe_accounts (one row per acct_… id the app is
--                    installed into) and memberships (the user ↔ Stripe
--                    account many-to-many, carrying the user's role).
--
--   App settings     account_settings (shared by everyone in a Stripe
--                    account) and user_settings (one Dashboard user's own)
--                    — one jsonb row per owner per mode, keyed by the ids
--                    the Stripe App signature vouches for (no app login
--                    needed), written through the settings_merge /
--                    patch_*_settings functions.
--
--   App login        stripe_app_sessions — which app user is logged in
--                    inside the Stripe Dashboard. (The short-lived login
--                    handshakes ride on the verifications table.)
--
--   Publisher side   subscriptions — each app user's subscription in the
--                    app publisher's own Stripe account. The matching
--                    Customer ids live on `users`.
--
--   Paywall          no table of its own: the account's free trial is two
--                    columns on account_settings (when it started, how
--                    much of its allowance is used), written through
--                    start_account_trial / record_trial_usage. Together
--                    with subscriptions it answers "may this account use
--                    the paid features?" (src/lib/paywall.ts).
--
-- Have a database from before the settings tables existed (2026-09-21)?
-- Just re-run this file (`npm run db:setup`): the settings tables and
-- functions are created, and the "Upgrades" section drops the old
-- `settings` columns.
--
-- Two conventions worth noticing:
--
--   Natural keys     Stripe ids are unique and immutable, so Stripe-owned
--                    rows use them as primary keys directly (acct_… for
--                    stripe_accounts, sub_… for subscriptions). No surrogate
--                    uuid + separate unique column carrying the same fact.
--
--   livemode         Kept where Stripe itself splits data by mode — billing
--                    customers (two columns on users), subscriptions (a
--                    livemode column) — and on the settings tables, so what
--                    you configure in test mode never applies in live mode.
--                    Roles and login state are mode-independent.

-- ============================================================================
--  Better Auth (managed by Better Auth over DATABASE_URL; mapped in
--  src/lib/auth.ts)
-- ============================================================================

CREATE TABLE IF NOT EXISTS "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"name" text,
	"image" text,
	-- App-owned columns (written via supabase-js, not Better Auth):
	-- The user as a Customer in the app publisher's Stripe billing account,
	-- one id per mode. NULL until first checkout in that mode.
	"stripe_customer_id_live" text,
	"stripe_customer_id_test" text,
	"created_at" timestamptz DEFAULT now() NOT NULL,
	"updated_at" timestamptz DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_stripe_customer_id_live_unique" UNIQUE("stripe_customer_id_live"),
	CONSTRAINT "users_stripe_customer_id_test_unique" UNIQUE("stripe_customer_id_test")
);

CREATE TABLE IF NOT EXISTS "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
	"token" text NOT NULL,
	"expires_at" timestamptz NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamptz DEFAULT now() NOT NULL,
	"updated_at" timestamptz DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_token_unique" UNIQUE("token")
);
CREATE INDEX IF NOT EXISTS "sessions_user_id_idx" ON "sessions" ("user_id");

-- A sign-in method (email/password credential or OAuth provider link).
CREATE TABLE IF NOT EXISTS "auth_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamptz,
	"refresh_token_expires_at" timestamptz,
	"scope" text,
	"password" text,
	"created_at" timestamptz DEFAULT now() NOT NULL,
	"updated_at" timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "auth_accounts_user_id_idx" ON "auth_accounts" ("user_id");

CREATE TABLE IF NOT EXISTS "verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamptz NOT NULL,
	"created_at" timestamptz DEFAULT now() NOT NULL,
	"updated_at" timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "verifications_identifier_idx" ON "verifications" ("identifier");

-- ============================================================================
--  Merchant side — the Stripe accounts the app is installed into
-- ============================================================================

-- One row per Stripe account (the acct_… id is the primary key). Install
-- state is two nullable columns: NULL means "not installed in that mode",
-- non-NULL holds the installation id. A general sandbox has its own acct_…
-- id, so it's simply another row here (installs land in the test column).
CREATE TABLE IF NOT EXISTS "stripe_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"live_installation_id" text,
	"test_installation_id" text,
	"created_at" timestamptz DEFAULT now() NOT NULL,
	"updated_at" timestamptz DEFAULT now() NOT NULL
);

-- The user ↔ Stripe account many-to-many. Data about the *relationship*
-- lives here: the user's role in that company.
CREATE TABLE IF NOT EXISTS "memberships" (
	"stripe_account_id" text NOT NULL REFERENCES "stripe_accounts"("id") ON DELETE cascade,
	"user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
	"role" text DEFAULT 'member' NOT NULL,
	"created_at" timestamptz DEFAULT now() NOT NULL,
	"updated_at" timestamptz DEFAULT now() NOT NULL,
	CONSTRAINT "memberships_pkey" PRIMARY KEY ("stripe_account_id", "user_id"),
	CONSTRAINT "memberships_role_check" CHECK ("role" IN ('owner', 'admin', 'member'))
);
CREATE INDEX IF NOT EXISTS "memberships_user_id_idx" ON "memberships" ("user_id");

-- ============================================================================
--  Stripe App login — who is logged in inside the Stripe Dashboard
--  (the /api/stripe-app/session|verify|userinfo routes; see AUTHENTICATION.md)
-- ============================================================================

-- (The other half of the login flow — the short-lived state handshake the
-- app polls while the user logs in in a browser tab — needs no table of its
-- own: it's stored as rows in "verifications" above, identifier
-- 'stripe-app-login:<state>'. See src/lib/stripe-app-session.ts.)

-- The persistent "logged in inside Stripe" link: one row per dashboard user
-- (usr_…) per Stripe account. stripe_user_id is '' when the caller has no
-- dashboard user id (Connect/platform contexts). Distinct from memberships —
-- a membership says the user belongs to the account; this row says the app's
-- UI extension currently has them logged in. Deleted on app logout.
CREATE TABLE IF NOT EXISTS "stripe_app_sessions" (
	"stripe_account_id" text NOT NULL,
	"stripe_user_id" text DEFAULT '' NOT NULL,
	"user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
	"created_at" timestamptz DEFAULT now() NOT NULL,
	"updated_at" timestamptz DEFAULT now() NOT NULL,
	CONSTRAINT "stripe_app_sessions_pkey" PRIMARY KEY ("stripe_account_id", "stripe_user_id")
);
CREATE INDEX IF NOT EXISTS "stripe_app_sessions_user_id_idx" ON "stripe_app_sessions" ("user_id");

-- ============================================================================
--  Publisher side — charging app users for the app itself
-- ============================================================================

-- Subscription state synced from the publisher billing account's webhooks.
-- The sub_… id is the primary key; livemode stays because live and test
-- subscriptions are genuinely different Stripe objects.
CREATE TABLE IF NOT EXISTS "subscriptions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
	"stripe_customer_id" text NOT NULL,
	"livemode" boolean NOT NULL,
	"status" text NOT NULL,
	"price_id" text,
	-- The price's lookup key (e.g. 'community_example_pro_monthly'): how the
	-- plan catalogue in src/config/plans.json recognises the plan without
	-- hard-coding price ids, which differ between test and live mode.
	"price_lookup_key" text,
	"quantity" integer,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"current_period_start" timestamptz,
	"current_period_end" timestamptz,
	"ended_at" timestamptz,
	"cancel_at" timestamptz,
	"canceled_at" timestamptz,
	"trial_start" timestamptz,
	"trial_end" timestamptz,
	"metadata" jsonb,
	"created_at" timestamptz DEFAULT now() NOT NULL,
	"updated_at" timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "subscriptions_user_id_idx" ON "subscriptions" ("user_id");

-- ============================================================================
--  App settings — the /api/stripe-app/settings route
--  (see src/lib/settings.ts and the model in src/types/settings.ts)
-- ============================================================================

-- A setting belongs to one of two scopes, each with its own table, and every
-- row is for one mode: (owner, livemode) is the primary key, so test-mode
-- settings and live-mode settings are different rows. The owner ids are the
-- ones every signed request from the app carries — the Stripe account
-- (acct_…) and the Dashboard user (usr_…) — so settings work as soon as the
-- app is installed, with no app login involved (the Better Auth login is a
-- separate, optional step, e.g. for paying for the app). Which keys live in
-- which table is decided once, in src/types/settings.ts; the jsonb column
-- only ever holds keys that file describes (the route validates writes).

-- Shared by everyone who uses the app in the Stripe account (e.g. the
-- company name).
--
-- The row also carries the account's free trial (see "Paywall" below). The
-- trial is account-wide and per mode, exactly like the row itself, so it
-- lives here rather than in a table of its own. The two trial columns are
-- deliberately NOT inside the `settings` jsonb: that document is written by
-- the app through PATCH /api/stripe-app/settings, and a trial the client
-- could edit would not be a trial. Only the two paywall functions write
-- these columns.
CREATE TABLE IF NOT EXISTS "account_settings" (
	"stripe_account_id" text NOT NULL REFERENCES "stripe_accounts"("id") ON DELETE cascade,
	"livemode" boolean NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	-- When the free trial started. NULL = not started yet.
	"trial_started_at" timestamptz,
	-- How many times the paid feature was used during the trial.
	"trial_usage_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamptz DEFAULT now() NOT NULL,
	"updated_at" timestamptz DEFAULT now() NOT NULL,
	CONSTRAINT "account_settings_pkey" PRIMARY KEY ("stripe_account_id", "livemode"),
	CONSTRAINT "account_settings_trial_usage_count_check" CHECK ("trial_usage_count" >= 0)
);

-- One Dashboard user's own preferences within a Stripe account (e.g. their
-- label printer). stripe_user_id is '' when the caller has no Dashboard
-- user id (Connect/platform contexts), same as stripe_app_sessions.
CREATE TABLE IF NOT EXISTS "user_settings" (
	"stripe_account_id" text NOT NULL REFERENCES "stripe_accounts"("id") ON DELETE cascade,
	"stripe_user_id" text DEFAULT '' NOT NULL,
	"livemode" boolean NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamptz DEFAULT now() NOT NULL,
	"updated_at" timestamptz DEFAULT now() NOT NULL,
	CONSTRAINT "user_settings_pkey" PRIMARY KEY ("stripe_account_id", "stripe_user_id", "livemode")
);

-- Merges `patch` into `current` and returns the result: the patch's keys
-- replace the current ones, and a key whose value is null is removed, so
-- the app's default applies again.
--
-- Doing the merge here, inside the write, is what makes a settings save
-- safe under concurrency: reading the row, merging in application code and
-- writing it back loses one of two overlapping saves.
CREATE OR REPLACE FUNCTION "settings_merge"(current jsonb, patch jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
	SELECT coalesce(jsonb_object_agg(key, value), '{}'::jsonb)
	FROM jsonb_each(coalesce(current, '{}'::jsonb) || coalesce(patch, '{}'::jsonb))
	WHERE value <> 'null'::jsonb;
$$;

-- One upsert per scope: creates the (owner, mode) row on first save, merges
-- into it afterwards. The stripe_accounts row the settings hang off is
-- created on demand too — the first signed request from a fresh install may
-- well be a settings save. Called from the backend via supabase-js `rpc()`.
-- Row Level Security still applies inside (the functions run as the
-- caller), so the public anon key gets no rows here either.
CREATE OR REPLACE FUNCTION "patch_user_settings"(p_account_id text, p_stripe_user_id text, p_livemode boolean, p_patch jsonb) RETURNS jsonb
LANGUAGE sql AS $$
	INSERT INTO "stripe_accounts" ("id") VALUES (p_account_id) ON CONFLICT ("id") DO NOTHING;
	INSERT INTO "user_settings" ("stripe_account_id", "stripe_user_id", "livemode", "settings")
	VALUES (p_account_id, p_stripe_user_id, p_livemode, settings_merge('{}'::jsonb, p_patch))
	ON CONFLICT ("stripe_account_id", "stripe_user_id", "livemode") DO UPDATE
	SET "settings" = settings_merge("user_settings"."settings", p_patch), "updated_at" = now()
	RETURNING "settings";
$$;

CREATE OR REPLACE FUNCTION "patch_account_settings"(p_account_id text, p_livemode boolean, p_patch jsonb) RETURNS jsonb
LANGUAGE sql AS $$
	INSERT INTO "stripe_accounts" ("id") VALUES (p_account_id) ON CONFLICT ("id") DO NOTHING;
	INSERT INTO "account_settings" ("stripe_account_id", "livemode", "settings")
	VALUES (p_account_id, p_livemode, settings_merge('{}'::jsonb, p_patch))
	ON CONFLICT ("stripe_account_id", "livemode") DO UPDATE
	SET "settings" = settings_merge("account_settings"."settings", p_patch), "updated_at" = now()
	RETURNING "settings";
$$;

-- ============================================================================
--  Paywall — free trials (the /api/stripe-app/paywall routes)
--  (see src/lib/paywall.ts and the decision in src/types/paywall.ts)
-- ============================================================================

-- One free trial per Stripe account per mode, stored as two columns on the
-- account_settings row: trial_started_at and trial_usage_count. The trial
-- starts when someone in the account accepts the trial terms (not at
-- install), and the columns are never cleared: uninstalling and
-- reinstalling the app does not buy a second trial. Only live mode is
-- paywalled by default; the test-mode row's trial is used only when a
-- developer sets PAYWALL_ENFORCE_IN_TEST_MODE to rehearse the flow — test
-- and live being different rows is what keeps a rehearsal from using up
-- the real trial.
--
-- The limits themselves (TRIAL_DAYS_LIMIT, TRIAL_COUNT_LIMIT) are backend
-- configuration, not columns: the row stores facts (when, how many), the
-- backend applies today's policy to them. Changing a limit therefore applies
-- to running trials too.

-- Upgrade for databases whose account_settings table predates the trial
-- columns (2026-09-29). It sits here rather than in the "Upgrades" section
-- at the end because the two functions below are checked against the table
-- when they are created, so the columns must exist first.
ALTER TABLE "account_settings" ADD COLUMN IF NOT EXISTS "trial_started_at" timestamptz;
ALTER TABLE "account_settings" ADD COLUMN IF NOT EXISTS "trial_usage_count" integer DEFAULT 0 NOT NULL;

-- Starts the account's trial and returns the row. Idempotent: when the trial
-- has already started the row is returned with its original start date, so
-- two users pressing "Start trial" at the same moment (or one user pressing
-- it twice) can neither restart the clock nor fail. Creates the
-- stripe_accounts row and the account_settings row on demand, like the
-- settings functions.
CREATE OR REPLACE FUNCTION "start_account_trial"(p_account_id text, p_livemode boolean) RETURNS "account_settings"
LANGUAGE sql AS $$
	INSERT INTO "stripe_accounts" ("id") VALUES (p_account_id) ON CONFLICT ("id") DO NOTHING;
	INSERT INTO "account_settings" ("stripe_account_id", "livemode", "trial_started_at")
	VALUES (p_account_id, p_livemode, now())
	ON CONFLICT ("stripe_account_id", "livemode") DO UPDATE
	SET "trial_started_at" = coalesce("account_settings"."trial_started_at", now())
	RETURNING *;
$$;

-- Counts one use of the paid feature against the trial and returns the new
-- count — or NULL when nothing was counted, because the trial hasn't
-- started or the allowance (p_limit, NULL = no cap) is already used up.
--
-- The check and the increment are one UPDATE, so the cap holds under
-- concurrency: with one use left and two requests racing, exactly one gets a
-- number back. Reading the count, comparing in application code and writing
-- count + 1 would let both through.
CREATE OR REPLACE FUNCTION "record_trial_usage"(p_account_id text, p_livemode boolean, p_limit integer) RETURNS integer
LANGUAGE sql AS $$
	UPDATE "account_settings"
	SET "trial_usage_count" = "trial_usage_count" + 1
	WHERE "stripe_account_id" = p_account_id
	  AND "livemode" = p_livemode
	  AND "trial_started_at" IS NOT NULL
	  AND (p_limit IS NULL OR "trial_usage_count" < p_limit)
	RETURNING "trial_usage_count";
$$;

-- ============================================================================
--  Migrations — which files from migrations/ this database has had applied.
--  Written by `npm run db:setup`; nothing in the app reads it.
-- ============================================================================

CREATE TABLE IF NOT EXISTS "applied_migrations" (
	"name" text PRIMARY KEY,
	"applied_at" timestamptz NOT NULL DEFAULT now()
);

-- ============================================================================
--  Row Level Security
-- ============================================================================

-- Supabase exposes the public schema through its auto-generated REST API.
-- Enabling Row Level Security with no policies locks every table down for the
-- public anon key. The backend is unaffected: it uses the service-role key
-- (which bypasses RLS), and Better Auth connects directly over DATABASE_URL.
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "auth_accounts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "verifications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "stripe_accounts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "memberships" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "account_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "user_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "stripe_app_sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "subscriptions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "applied_migrations" ENABLE ROW LEVEL SECURITY;

-- ============================================================================
--  Upgrades — bring a database created from an older version of this file
--  up to the baseline. Every statement here is idempotent (IF EXISTS /
--  IF NOT EXISTS) so the whole file stays safe to re-run.
--
--  Closed since 2026-09-30: new changes go in migrations/, not here.
-- ============================================================================

-- 2026-09-21: app settings moved from jsonb columns on users,
-- stripe_accounts and memberships into the account_settings / user_settings
-- tables above (one row per owner per mode). The columns held nothing in
-- any deployment we know of, so they are simply dropped.
ALTER TABLE "users" DROP COLUMN IF EXISTS "settings";
ALTER TABLE "stripe_accounts" DROP COLUMN IF EXISTS "settings";
ALTER TABLE "memberships" DROP COLUMN IF EXISTS "settings";

-- 2026-09-21: earlier signatures of the settings functions from the same
-- day. CREATE OR REPLACE FUNCTION adds an overload rather than replacing a
-- function whose arguments changed, so retire the old ones explicitly.
DROP FUNCTION IF EXISTS "patch_user_settings"(uuid, jsonb);
DROP FUNCTION IF EXISTS "patch_user_settings"(uuid, boolean, jsonb);
DROP FUNCTION IF EXISTS "patch_account_settings"(text, jsonb);

-- 2026-09-29: the paywall example. The trial columns on account_settings are
-- added in the "Paywall" section above (they must exist before its functions
-- are created); subscriptions gained the price's lookup key so a plan can be
-- recognised in both modes.
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "price_lookup_key" text;
