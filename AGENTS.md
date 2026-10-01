# AGENTS.md — Notetaskerator

Notes for whoever picks this up next. Read `README.md` first.

## What this is

A Stripe App for the Stripe App Marketplace: notes and tasks on customers,
invoices and payments, with a full-page task queue for support teams. Many
Stripe accounts install it; each is a separate tenant.

- `stripe-app/` — the UI extension (`@stripe/ui-extension-sdk` 9.3.0,
  React 18). App id `com.productivity.notetaskerator1`, name
  "Notetaskerator". Four views: the full-page task queue and a notes drawer
  on the customer, invoice and payment detail pages. Own notes:
  `stripe-app/README.md`.
- `stripe-app-nextjs-backend/` — Next.js 16 backend: notes API, team
  directory, assignment email, trial and billing, install webhooks, public
  website. Own notes: `AGENTS.md` (the rules), `README.md`,
  `ARCHITECTURE.md`, `AUTHENTICATION.md` in that folder.
- Root `package.json` — no npm workspaces (the Stripe CLI builds the app
  from `stripe-app/` and expects its dependencies there). `postinstall`
  installs both; `npm run dev` runs both.

Built on 2026-10-01 from
[stripe-apps-community-examples](https://github.com/bensontrent/stripe-apps-community-examples)
(copied, not forked; no submodule). When something about the inherited
parts is unclear — signing, the login handshake, webhooks, settings, the
paywall — that repository's docs explain the reasoning.

## Product decisions (from the owner)

- A note is plain by default and can become a task (priority, status,
  assignee). Some notes are only for the record.
- A task can be assigned to anyone in the same Stripe account who has opened
  the app. Stripe gives apps no team list.
- The assignee gets an email when someone else assigns them a task. Each
  person can switch that off.
- Everyone in the account sees, edits and deletes every note. No private
  notes, no roles.
- Test-mode and live-mode notes are separate.
- A customer's page shows the notes on that customer's invoices and
  payments too.
- Trial: 100 notes, 90 days, per Stripe account, live mode only. After it,
  existing notes stay readable and editable; adding notes needs a plan.
- The Stripe account that owns the app also bills for it (so the
  `STRIPE_BILLING_*` variables stay unset).
- Not in the first version: due dates, reminders, scheduled jobs, tasks
  created automatically from Stripe events, a default drawer on other pages.

## Rules that span both folders

- `src/types/notes.ts`, `paywall.ts` and `settings.ts` exist in both
  projects and must stay identical. Edit the backend's copy and copy it
  over; `stripe-app/src/types/sync.test.ts` fails when they differ.
- The backend rules are in `stripe-app-nextjs-backend/AGENTS.md`
  ("Non-negotiables"). The most important: every query on `notes` is scoped
  by the signed Stripe account and the mode.
- The app's UI is built only from `@stripe/ui-extension-sdk` components.
  Check <https://docs.stripe.com/stripe-apps> when unsure of a component or
  prop.
- Request only the Stripe permissions a feature needs, and say why in
  `stripe-app.json`. Today they are all read-only.
- Database changes are new files in `stripe-app-nextjs-backend/migrations/`.
  `setup.sql` is the example's baseline and is not edited.
- Stripe test mode only while developing. Secrets live in
  `stripe-app-nextjs-backend/.env.local` (gitignored); never print them,
  commit them or ask for them in a chat. Steps that need credentials or an
  interactive terminal (`stripe login`, `stripe apps upload`,
  `stripe apps start`, copying the signing secret, deploying) are the
  owner's to run.

## Checks before calling something done

| Where | Command |
| --- | --- |
| `stripe-app/` | `npm test` and `npm run typecheck` |
| `stripe-app-nextjs-backend/` | `npm run build` |
| `stripe-app-nextjs-backend/` | `npm run smoke`, with `npm run dev` running |

## Things specific to this setup

- The database is the owner's existing Supabase project, schema `notes`
  (`SUPABASE_SCHEMA`). The schema must be listed under *Exposed schemas* in
  Supabase.
- The owner's machine also runs the example's backend on port 3006 at
  times. This backend uses the same port; only one can run. For a second
  port, start it with `npx next dev -p <port>` and set `SMOKE_BASE_URL`.
- Postmark is configured on the owner's machine through an environment
  variable outside `.env.local`, so emails can really be sent from a dev
  server. The smoke test uses `@example.com` recipients for that reason.
- On Windows the checkout has CRLF line endings (git `autocrlf`).
- The Stripe CLI's bundler has not built this app yet. The code avoids
  `satisfies` and generic arrow functions, as the example did, because the
  bundler's TypeScript support was uncertain.

## Not done, not verified

See "Status" and "Before going to the Marketplace" in `README.md`, and "Not
verified yet" in `stripe-app-nextjs-backend/AGENTS.md`. In short: nothing
has run inside a real Stripe Dashboard yet.

## Likely next steps

1. Run `stripe apps upload`, set the signing secret, run `npm run dev`, and
   click through the drawer and the task queue in the Dashboard. Fix what
   the real Dashboard disagrees with (layout, `objectContext` on the payment
   page, whether `/:tabId?` matches `/`).
2. Install the app from a second account or a sandbox with `stripe listen`
   running, to see a real install event and welcome email.
3. Real plans and prices; one paid test Checkout; the customer portal.
4. Sign the `stripe-mode` header (see `AUTHENTICATION.md`).
5. Deploy the backend, point the app at it, upload, submit for review.
