# Notetaskerator backend

The Next.js backend of **Notetaskerator**, a Stripe App that adds notes and
tasks to customers, invoices and payments in the Stripe Dashboard. The UI
extension lives in [`../stripe-app`](../stripe-app); this project stores its
data, decides who may add notes (free trial and subscriptions), sends its
emails and hosts its public website (docs, plans, billing).

Built from the
[stripe-apps-community-examples](https://github.com/bensontrent/stripe-apps-community-examples)
backend: the request signing, the per-account data model, the login
handshake, webhooks, settings and the paywall are that example's, adapted.
The notes, tasks, team directory and assignment email were added on top.

## What it does

| Area | What | Where |
| --- | --- | --- |
| Notes and tasks | Create, list, change and delete notes; a task queue with priority, status and assignee | `src/lib/notes.ts`, `src/app/api/stripe-app/notes/` |
| Team directory | Remembers each Dashboard user who opens the app, so tasks can be assigned to them | `src/lib/account-users.ts`, `src/app/api/stripe-app/team/` |
| Assignment email | Emails a teammate when someone else assigns them a task | `src/lib/notifications.ts`, `src/lib/email-templates.ts` |
| Trial and paywall | 100 notes or 90 days per Stripe account in live mode; test mode is free | `src/lib/paywall.ts`, `src/types/paywall.ts` |
| Billing | Public price list, Stripe Checkout, customer portal | `src/lib/billing.ts`, `src/app/(site)/plans`, `src/app/(site)/billing` |
| Settings | Per-user "email me when a task is assigned to me" | `src/lib/settings.ts`, `src/types/settings.ts` |
| Installs | Welcome and goodbye emails, install state per account | `src/lib/app-installs.ts`, `src/pages/api/webhooks/app.ts` |
| Auth | Every request is sorted into an auth flavor before any route runs | `src/proxy.ts`, [AUTHENTICATION.md](AUTHENTICATION.md) |
| User guide | Public docs at `/docs`, rendered from Markdown | `src/content/docs/` |

How the pieces fit: [ARCHITECTURE.md](ARCHITECTURE.md). Rules for changing
this project: [AGENTS.md](AGENTS.md).

## Requirements

- Node.js 20.9+
- A Supabase project (Postgres). This project keeps its tables in a
  dedicated schema, `notes` (`SUPABASE_SCHEMA` in `.env.local`).
- The [Stripe CLI](https://docs.stripe.com/stripe-cli), logged in to the
  Stripe account that owns the app

## Run it locally

```bash
npm install
npm run setup      # fills in anything missing in .env.local, creates the tables
npm run dev        # https://localhost:3006
```

The dev server uses HTTPS (`next dev --experimental-https`). On the first
run Next.js installs a local certificate authority with mkcert, which may
ask for permission, and writes the certificate to `certificates/`
(gitignored). `npm run dev:http` is the plain-HTTP fallback, but the Stripe
App and `.env.local` expect `https://localhost:3006`.

`npm run setup` is safe to re-run: it only adds what is missing. While
anything is still missing, the home page shows a checklist with the fix for
each item.

Two things can't be automated:

1. **Expose the schema.** In the Supabase dashboard, add `notes` to
   *Exposed schemas* (Settings → API). The backend can't query it otherwise.
2. **The app's signing secret.** It exists only after the first
   `stripe apps upload` (from `../stripe-app`). Copy it from the app's page
   in the Stripe Developers Dashboard into `STRIPE_APP_SIGNING_SECRET` in
   `.env.local`. Until then every request from the app is refused.

### Environment

`.env.local` holds everything (`.env.example` documents each variable).
The ones that matter most:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Postgres connection string, *Session pooler* (Better Auth, `db:setup`) |
| `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Server-side data access; the key bypasses Row Level Security and must never reach a browser |
| `SUPABASE_SCHEMA` | `notes` |
| `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` | Sessions on the website |
| `STRIPE_APP_SIGNING_SECRET` | Verifies requests from the Stripe App |
| `STRIPE_SECRET_KEY_TEST` / `_LIVE` | Stripe API (billing; reading an account's name at install) |
| `STRIPE_WEBHOOK_SECRET_*` | One per webhook endpoint, see below |
| `POSTMARK_SERVER_API_TOKEN`, `POSTMARK_FROM_EMAIL` | Email. Without both, emails are skipped (and printed to the terminal under `npm run dev`) |
| `TRIAL_COUNT_LIMIT`, `TRIAL_DAYS_LIMIT` | Override the trial (defaults 100 and 90; 0 switches a limit off) |
| `PAYWALL_ENFORCE_IN_TEST_MODE` | `true` to rehearse the paywall in test mode |
| `BILLING_ENVIRONMENT` | `test` (default) or `live`: which mode `/billing` sells in |

Environment variables set on the machine itself win over `.env.local`
(that is how Next.js loads them), so check there when a value seems to come
from nowhere.

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Dev server on https://localhost:3006 |
| `npm run dev:http` | Same, over plain HTTP |
| `npm run build` | Production build. Must pass before every commit |
| `npm run setup` | Fill in `.env.local`, create the tables. Idempotent |
| `npm run db:setup` | Apply `setup.sql` and any new files in `migrations/` |
| `npm run smoke` | End-to-end test of the notes API against the running dev server (see below) |
| `npm run billing:seed` | Create the plans from `src/config/plans.json` in Stripe test mode |
| `npm run deploy` | Sync env vars to Vercel and deploy |

## API for the Stripe App

All under `/api/stripe-app/`, all authenticated by the Stripe App signature
(the proxy verifies it; routes read the account and user ids it vouches
for). Notes are always scoped to the signed account and to the mode in the
`stripe-mode` header.

| Route | What |
| --- | --- |
| `POST team` | Check in: record the current Dashboard user (name, email) and return the team |
| `GET team` | The team, without checking in |
| `GET notes` | List notes. Query: `objectType` + `objectId`, `tasks=true`, `assignee=me\|unassigned\|anyone`, `status=active\|open\|in_progress\|resolved\|any`, `sort=priority\|newest`, `limit`, `offset` |
| `POST notes` | Create a note. **The paid route**: answers 402 with the paywall status when the account may not add notes |
| `GET notes/summary` | Counts for the task queue |
| `GET` / `PATCH` / `DELETE notes/:id` | One note |
| `GET` / `PATCH settings` | The user's and the account's settings |
| `GET paywall`, `POST paywall/trial`, `POST paywall/refresh` | Paywall status, start the trial, recheck the plan |
| `POST session`, `GET verify`, `GET userinfo`, `DELETE session` | Login handshake, used only by the person paying |

The request and response types are in `src/types/notes.ts`,
`src/types/paywall.ts` and `src/types/settings.ts`. **Identical copies of
those three files live in `../stripe-app/src/types/`** — change both or
neither (a test in the app fails when they differ).

## Database

`setup.sql` is the baseline schema from the example and is never edited.
Every change is a new timestamped file in [`migrations/`](migrations/README.md),
applied once by `npm run db:setup`.

| Table | Holds |
| --- | --- |
| `notes` | The notes and tasks. One row per note, per account, per mode |
| `account_users` | Everyone who has opened the app in an account: the assignee list |
| `stripe_accounts` | One row per Stripe account the app has been used in; install state |
| `account_settings` | Per account and mode: settings, and the free trial's start and count |
| `user_settings` | Per Dashboard user, account and mode |
| `users`, `sessions`, `auth_accounts`, `verifications` | Better Auth (website logins) |
| `memberships`, `stripe_app_sessions` | Which website user belongs to and is logged in from which Stripe account |
| `subscriptions` | Plans bought on the website |

Every table has Row Level Security on with no policies; only the backend's
secret key can read them.

## Webhooks

Two routes, both verified against the raw body:

| Endpoint to register | In | Listening to | Secret goes in |
| --- | --- | --- | --- |
| `/api/webhooks/app?mode=test&type=connected` | your account, test mode | Connected accounts | `STRIPE_WEBHOOK_SECRET_TEST_CONNECTED` |
| `/api/webhooks/app?mode=live&type=connected` | your account, live mode | Connected accounts | `STRIPE_WEBHOOK_SECRET_LIVE_CONNECTED` |
| `/api/webhooks/billing?mode=test` | your account, test mode | Your account | falls back to the connected secret of that mode |
| `/api/webhooks/billing?mode=live` | your account, live mode | Your account | falls back to the connected secret of that mode |

The app endpoints need `account.application.authorized` and
`account.application.deauthorized` (install and uninstall). The billing
endpoints need `customer.subscription.created`, `.updated` and `.deleted`.
The app and the billing run in the same Stripe account, so the
`STRIPE_BILLING_*` variables stay unset.

Locally, one command forwards both and prints the signing secret to put in
`STRIPE_WEBHOOK_SECRET_TEST_CONNECTED`:

```bash
stripe listen --forward-connect-to "https://localhost:3006/api/webhooks/app?mode=test&type=connected" --forward-to "https://localhost:3006/api/webhooks/billing?mode=test" --skip-verify
```

## Trial and billing

- Creating a note is the only paid action. Reading, editing, resolving and
  deleting are never blocked, so an account whose trial ran out keeps what
  it wrote.
- The trial belongs to the Stripe account, starts when someone accepts it
  in the app, and is never reset by reinstalling.
- A subscription belongs to a website user. An account is covered when any
  user who logged in from that account's Dashboard has an active plan.
- `src/config/plans.json` holds **one placeholder plan** (Pro, $19/month).
  Replace it with your real plans, then `npm run billing:seed` creates the
  products and prices in test mode (`-- --live` for live). Plans are tied to
  Stripe by price lookup key, never by price id.
- The customer portal must be saved once per mode in the Stripe Dashboard
  (Settings → Billing → Customer portal) before "Manage plan" works.

To rehearse the paywall without going live, set
`PAYWALL_ENFORCE_IN_TEST_MODE=true` and restart.

## Checking it works

```bash
npm run build
```

```bash
npm run smoke
```

`npm run smoke` needs the dev server running. It signs requests the way the
app does (with `STRIPE_APP_SIGNING_SECRET`), runs about 50 checks against
the real database — signatures, validation, listing, task rules, isolation
between accounts and between modes, the paywall — in made-up accounts, and
deletes everything it created. Its made-up teammates have `@example.com`
addresses, so no email reaches anyone. Use `SMOKE_BASE_URL` to point it at
another port.

## Deploying

Hosting is a Vercel project provisioned through Stripe Projects. Both steps
create cloud resources:

```bash
stripe projects init
```

```bash
stripe projects add vercel/project
```

```bash
npm run deploy
```

`npm run deploy` (`scripts/deploy-vercel.mjs`) syncs the variables from
`.env` and `.env.local` to the Vercel project's production environment
(rewriting `BETTER_AUTH_URL` to the production URL, never uploading the
Vercel credentials or `DEV_API_KEY`) and starts a deployment. It came with
the example and has not been run against a real Vercel project from this
repository yet.

After the first deploy:

1. Register the webhook endpoints above with the production URL, put their
   secrets in `.env.local`, and deploy again.
2. In `../stripe-app`: set `BACKEND_BASE` in `src/api/backend.ts` to the
   production URL, list `https://<your-domain>/api/` under `connect-src` in
   `stripe-app.json`, and run `stripe apps upload`.
3. Set `BILLING_ENVIRONMENT=live` and the live Stripe key when you are ready
   to charge.

Consider a separate Supabase project (or at least a separate schema) for
production before real customers arrive.
