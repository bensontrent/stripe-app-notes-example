# AGENTS.md — Notetaskerator backend (Next.js)

The backend of Notetaskerator, a Stripe App for notes and tasks on
customers, invoices and payments. The UI extension is `../stripe-app`. This
project was built from the
[stripe-apps-community-examples](https://github.com/bensontrent/stripe-apps-community-examples)
backend; its auth, per-account data model, webhooks, settings and paywall
are that example's code, adapted. Notes, tasks, the team directory and the
assignment email are this project's own.

## Start here

1. Read `README.md`, then `AUTHENTICATION.md` (how requests from the Stripe
   Dashboard are verified) and `ARCHITECTURE.md` (tables, flows).
2. Look at `src/proxy.ts` (auth router), `src/lib/notes.ts` (the notes data
   layer), `src/types/notes.ts` (what a note is), and `setup.sql` plus
   `migrations/` (the schema).
3. Check setup state with `npm run setup` (idempotent; `--non-interactive`
   when you have no terminal) or the checklist on `http://localhost:3006`
   under `npm run dev`.

## Non-negotiables

- **Every statement on `notes` is scoped by the signed identity.** Use
  `scope(identity)` in `src/lib/notes.ts`: the Stripe account the request
  was signed for, and the mode. A note id alone must never select a row.
  One account reading another's notes is the worst bug this app can have.
- Identity comes from `getSignedIdentity()` (`src/lib/signed-request.ts`),
  never from the request body. The account and user ids are signed; the
  `stripe-mode` header and the name and email sent at check-in are not.
  Treat names and emails as display data.
- Keep `src/proxy.ts` stripping `x-auth-type` / `x-stripe-verified` from
  incoming requests before setting them — routes trust those headers.
- Schema changes are new timestamped `.sql` files in `migrations/` (rules in
  `migrations/README.md`), applied once each by `npm run db:setup`. Don't
  edit `setup.sql` (the example's baseline) or a migration that has been
  applied anywhere.
- Every table has Row Level Security enabled with no policies; a migration
  must do the same for each table it adds. The backend uses the
  secret/service-role key, which bypasses RLS; never ship that key to the
  browser.
- The paywall is enforced here, not in the app: `POST /api/stripe-app/notes`
  calls `recordFeatureUse()` before saving and answers 402 when it says no.
  Everything that can refuse the request (validation, the assignee check)
  runs **before** the gate, so a refused request never uses up trial
  allowance. Only creating a note is gated; never gate reading or editing.
- `src/types/notes.ts`, `src/types/paywall.ts` and `src/types/settings.ts`
  have identical copies in `../stripe-app/src/types/`. Change both or
  neither; `npm test` in the app fails when they differ.
- The rules that tie a task's fields together live in `applyNoteChanges()`
  in `src/types/notes.ts`. The backend's write and the app's optimistic
  update both call it; don't re-implement them elsewhere.
- An assignee must be a row in `account_users` for the same account (the
  composite foreign key on `notes` enforces it). Rows there are never
  deleted.
- The assignment email must never fail a request: `notifyAssignee()`
  returns an outcome and swallows errors.
- Better Auth's table/column mapping lives in `src/lib/auth.ts`; keep it in
  sync with the four auth tables in `setup.sql`.
- Keep the login handshake (`/stripe`,
  `/api/stripe-app/{session,verify,userinfo}`) working — paying for the app
  depends on it.
- Stripe webhooks are the two Pages Router routes in `src/pages/api/webhooks/`.
  Keep `bodyParser: false` and verify the signature against the raw body
  before doing anything else. Webhooks arrive at least once: keep the
  handlers in `src/lib/app-installs.ts` idempotent, and never delete a
  `stripe_accounts` row at uninstall — notes, settings and the trial hang
  off it.
- Plans are tied to Stripe by price lookup key (`src/config/plans.json`);
  never hard-code price ids. The plan in that file is a placeholder.
- A pristine checkout must build and serve with no env vars at all: nothing
  may read configuration at import time (Stripe and Supabase clients are
  created lazily).
- Test mode only while developing. Never print or commit values from
  `.env.local`.

## Conventions

- Routes are thin: validate, call `src/lib`, answer. Follow the header
  comment style of the existing route files.
- Stripe ids are natural keys; timestamps are `timestamptz`; every foreign
  key column is indexed.
- Data that Stripe splits by mode carries `livemode`. Notes do; the team
  directory does not (the same people work in both modes).
- The backend never reads the installing account's Stripe data. Labels for
  customers, invoices and payments are sent by the app with each note and
  stored as a snapshot.
- The public docs in `src/content/docs/` state the trial as "100 notes or
  90 days". Change them when the defaults in `src/lib/paywall.ts` change.

## Verification

- `npm run build` must pass.
- `npm run smoke` (with `npm run dev` running) must pass: it exercises the
  notes API end to end with signed requests, including isolation between
  accounts and modes and the paywall, and cleans up after itself.
- With the dev server running, `http://localhost:3006` shows the setup
  checklist; every required item should be green.
- `/login` → register → `/account` exercises Better Auth end to end.

## Not verified yet

- A real install or uninstall event from Stripe (the handlers were checked
  with locally signed events in the example), including whether the app
  needs the `event_read` permission to receive them.
- A real delivery of the assignment email (the decision and the template
  are tested; Postmark refused the smoke test's made-up recipient, as
  intended).
- `npm run deploy` against a real Vercel project.
- A paid Checkout and the customer portal.
