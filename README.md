# Notetaskerator

A Stripe App for support teams: notes on customers, invoices and payments,
and a shared task queue, inside the Stripe Dashboard. Built for the Stripe
App Marketplace, so every Stripe account that installs it is a separate
tenant.

- **Write a note** on a customer, invoice or payment page. A customer's
  page shows everything written about them, including notes on their
  invoices and payments.
- **Turn a note into a task**: priority (Low, Normal, High, Urgent), status
  (Open, In progress, Resolved) and an assignee, who gets an email.
- **Work the queue**: the full-page view lists the team's tasks, most
  urgent first, with tabs for Everyone, Assigned to me and Unassigned.
- Everyone in a Stripe account sees and may change every note. Test-mode
  and live-mode notes are kept apart.
- **Free trial**: 100 notes or 90 days per Stripe account in live mode,
  then a subscription. Test mode is always free.

## What's in the repo

| Folder | What it is | Runs on |
| --- | --- | --- |
| [`stripe-app/`](stripe-app/) | The UI extension: the notes drawer and the task queue | Stripe Dashboard (`stripe apps start`) |
| [`stripe-app-nextjs-backend/`](stripe-app-nextjs-backend/) | The backend: notes API, team directory, emails, trial and billing, public website | Local dev / Vercel |

```
Stripe Dashboard                         Your infrastructure
┌──────────────────────┐                ┌───────────────────────────────┐
│  stripe-app          │ signed requests│  stripe-app-nextjs-backend    │
│  (UI extension)      │ ─────────────► │  (Next.js)                    │
└──────────────────────┘                │   ├─ notes, tasks, team       │
        ▲                               │   ├─ trial, billing           │
        │ installs into                 │   └─ Stripe webhooks          │
┌──────────────────────┐                └───────────┬───────────────────┘
│  Stripe accounts     │ ── webhooks ──►            ▼
│  (one per install)   │                ┌───────────────────────────────┐
└──────────────────────┘                │  Supabase Postgres            │
                                        │  (schema "notes")             │
                                        └───────────────────────────────┘
```

The project started from
[stripe-apps-community-examples](https://github.com/bensontrent/stripe-apps-community-examples).
Kept from it: the signed requests between app and backend, the per-account
data model, the login handshake, install webhooks, settings, the trial and
paywall, and the billing pages. New here: notes, tasks, the team directory,
the assignment email, the three drawer views and the task queue.

## Requirements

- Node.js 20.9+
- [Stripe CLI](https://docs.stripe.com/stripe-cli) 1.43+ with the apps
  plugin (`stripe plugin install apps`), logged in (`stripe login`)
- A Supabase project. The tables live in a dedicated schema, `notes`, which
  must be listed under *Exposed schemas* (Supabase → Settings → API)

## Getting it running

```bash
npm install
```

installs both projects. The backend needs `stripe-app-nextjs-backend/.env.local`
(see [its README](stripe-app-nextjs-backend/README.md#environment));
`npm run setup` fills in whatever is missing and creates the tables.

1. **Upload the app once**, so it has a signing secret. From `stripe-app/`:

   ```bash
   stripe apps upload
   ```

   Uploading is not publishing: the app stays private to your Stripe account.

2. **Copy the signing secret** from the app's page in the Stripe Developers
   Dashboard into `STRIPE_APP_SIGNING_SECRET` in
   `stripe-app-nextjs-backend/.env.local`.

3. **Start both**:

   ```bash
   npm run dev
   ```

   The backend runs on <https://localhost:3006> and the Stripe Dashboard
   opens with the app previewed. Open a customer, invoice or payment and
   open the app in the drawer; the app's own page is the task queue.

The backend must be on port 3006 (the app is pointed there), so stop
anything else using it first.

## Root scripts

| Script | What it does |
| --- | --- |
| `npm install` | Installs dependencies for both projects |
| `npm run setup` | Fills in the backend's `.env.local` and creates the tables. Idempotent |
| `npm run dev` | Backend + Stripe App preview together |
| `npm run dev:backend` / `npm run dev:app` | One of the two |
| `npm run db:setup` | Apply `setup.sql` and any new migrations |
| `npm test` | The app's tests |
| `npm run typecheck` | The app's TypeScript check |
| `npm run build:backend` | Production build of the backend |
| `npm run smoke` | End-to-end test of the notes API (backend must be running) |
| `npm run stripe:upload` | Upload the app to Stripe |
| `npm run deploy:backend` | Deploy the backend to Vercel |

## Checks

```bash
npm test
```

```bash
npm run typecheck
```

```bash
npm run build:backend
```

```bash
npm run smoke
```

## Status

Verified in this repository: the backend builds; the notes API passes its
end-to-end smoke test against the real database (signatures, validation,
task rules, isolation between accounts and modes, the paywall); the app
type-checks and its tests pass.

Not verified yet, because each needs a real Stripe Dashboard or a paid
service:

- the app inside the Dashboard (`stripe apps start`): layout, the drawer
  on real customer, invoice and payment pages, the Stripe CLI's bundler
  accepting the code
- reading real customers, invoices and payments for labels, and the user's
  email through `user_email_read`
- a delivered assignment email, and the links in it
- a real install and uninstall webhook, a paid Checkout, the customer portal
- deploying the backend to Vercel

## Before going to the Marketplace

- Real plans and prices in `stripe-app-nextjs-backend/src/config/plans.json`
  (the one there is a placeholder)
- The app's own icon (`stripe-app/app_icon.png`, `src/views/brand_icon.svg`)
- A deployed backend, its URL in `stripe-app/src/api/backend.ts` and in
  `connect-src` in `stripe-app/stripe-app.json`
- Production webhook endpoints and a verified Postmark sender
- Terms, privacy policy and a support contact for the listing

## More

- [stripe-app/README.md](stripe-app/README.md) — the UI extension
- [stripe-app-nextjs-backend/README.md](stripe-app-nextjs-backend/README.md) — the backend, its API and deployment
- [stripe-app-nextjs-backend/ARCHITECTURE.md](stripe-app-nextjs-backend/ARCHITECTURE.md) — data model and flows
- [stripe-app-nextjs-backend/AUTHENTICATION.md](stripe-app-nextjs-backend/AUTHENTICATION.md) — how requests are verified
- [AGENTS.md](AGENTS.md) — notes for whoever (or whatever) works on this next
