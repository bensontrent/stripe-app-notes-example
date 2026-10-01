# Architecture

Notetaskerator is two programs: a UI extension that runs inside the Stripe
Dashboard, and this backend.

```
Stripe Dashboard                          This backend (Next.js)
┌───────────────────────────┐            ┌─────────────────────────────────┐
│ stripe-app (UI extension) │  signed    │ proxy.ts  verifies the signature│
│  • drawer on customer,    │  requests  │   │                             │
│    invoice, payment pages │ ─────────► │   ▼                             │
│  • full page: task queue  │            │ /api/stripe-app/*  notes, team, │
└───────────────────────────┘            │   settings, paywall             │
        │ reads labels                   │                                 │
        ▼ (Dashboard session)            │ website: /docs /plans /billing  │
┌───────────────────────────┐            │   (Better Auth sessions)        │
│ Stripe API of the account │            └───────┬─────────────────┬───────┘
│ the app is installed in   │ ── webhooks ──────►│                 │
└───────────────────────────┘   install,         ▼                 ▼
                                uninstall,   Supabase Postgres   Postmark
                                billing      (schema "notes")    (email)
```

Three decisions shape everything else:

1. **The tenant is the Stripe account.** Every request from the app is
   signed by Stripe for one account and one Dashboard user. The backend
   takes its identity from that signature and nothing else, and every query
   is filtered by the account id. No login is involved in using the app.
2. **The backend never reads an installing account's Stripe data.** The app
   reads the customer, invoice or payment it is open on (through the
   Dashboard session, with the permissions in `stripe-app.json`) and sends
   the labels along with the note. The backend stores them as a snapshot.
   So the backend needs no per-account Stripe credentials for notes.
3. **Test and live never mix.** Notes carry `livemode`; the same routes
   serve both, selected by the `stripe-mode` header.

## Technology

- **Next.js 16** (App Router; the two webhook routes are in the Pages
  Router), TypeScript, Tailwind for the website
- **Supabase Postgres**, accessed with supabase-js and the secret key
  (server-side only); schema in `setup.sql` + `migrations/`
- **Better Auth** for website logins, over a direct `pg` connection
- **Stripe** for billing (Checkout, customer portal) and install events
- **Postmark** for email, through plain `fetch`

## Data model

```
stripe_accounts (acct_…)
  ├── account_users       who has opened the app here      PK (account, usr_…)
  ├── notes               notes and tasks                  per account, per mode
  │     └── assignee ───► account_users (same account, enforced by a foreign key)
  ├── account_settings    settings + free trial            PK (account, livemode)
  ├── user_settings       one Dashboard user's settings    PK (account, usr_…, livemode)
  └── memberships ───────► users (website accounts) ──► subscriptions
```

### notes

One row per note. The columns that carry the design:

| Column | Meaning |
| --- | --- |
| `stripe_account_id`, `livemode` | The tenant and the mode. Part of every query |
| `object_type`, `object_id` | What the note is attached to: `customer`, `invoice` or `payment` (a `pi_…` or `ch_…` id) |
| `customer_id` | The customer the object belongs to; the customer's own id for a customer note. The customer page lists by this column, which is how it also shows notes from that customer's invoices and payments |
| `object_label`, `customer_label` | Names saved when the note was written, for lists and emails |
| `is_task` | A note becomes a task when true; the next three only mean something then |
| `priority` | 1 low … 4 urgent, a number so "most urgent first" is an `ORDER BY` |
| `status`, `resolved_at` | `open`, `in_progress`, `resolved` |
| `assignee_stripe_user_id` | Must be in `account_users` for the same account |
| `created_by`, `updated_by` | Dashboard user ids |

The rules that tie the task fields together (a plain note has no assignee,
`resolved_at` follows the status, …) are one function, `applyNoteChanges()`
in `src/types/notes.ts`, shared with the app.

### account_users

Stripe gives an app no list of an account's team. Each view of the app
"checks in" when it opens (`POST /api/stripe-app/team`), and this table
remembers everyone who ever did, with the name and email the app reported.
That is the assignee list and where the assignment email finds an address.
One row per person per account, not per mode. Rows are never deleted.

### The rest (from the example, unchanged in shape)

- `account_settings` / `user_settings`: jsonb settings per owner per mode,
  merged inside Postgres (`settings_merge`). The one setting today is the
  user-scoped `emailOnAssignment`. `account_settings` also carries the
  trial: `trial_started_at` and `trial_usage_count`.
- `users`, `sessions`, `auth_accounts`, `verifications`: Better Auth.
- `memberships`, `stripe_app_sessions`: which website user belongs to, and
  is logged in from, which Stripe account.
- `subscriptions`: plans bought on the website, synced from Stripe.

## Flows

### Opening the drawer on an invoice

```
1. The Dashboard gives the view { id: in_…, object: "invoice" }
2. In parallel:
   • the app reads the invoice from Stripe → its number and customer
   • POST /api/stripe-app/team      check in, get the team
   • GET  /api/stripe-app/notes?objectType=invoice&objectId=in_…
   • GET  /api/stripe-app/paywall   may this account add notes?
3. The drawer shows the form (or the paywall view) and the notes
```

### Adding a note

```
1. POST /api/stripe-app/notes { objectType, objectId, customerId, labels, body, isTask, … }
2. proxy: verify the Stripe App signature
3. route: validate the body; check the assignee is on the team
4. recordFeatureUse(): test mode and subscribers pass; during a trial the
   note is counted (atomically); otherwise → 402 with the paywall status
5. insert the note, scoped to the signed account and the mode
6. notifyAssignee(): email, if the task was assigned to someone else who
   has an address and hasn't switched the emails off
7. 201 { note, notification, status }
```

Editing, resolving and deleting go through `PATCH` / `DELETE
/api/stripe-app/notes/:id`, which are never gated.

### The task queue

`GET /api/stripe-app/notes?tasks=true&status=active&sort=priority` plus an
`assignee` filter per tab, and `GET /api/stripe-app/notes/summary` for the
counts. A partial index (`notes_task_queue_idx`) serves the queue.

### Install and uninstall

```
account.application.authorized   → /api/webhooks/app?mode=…&type=connected
  store the account's name and contact email, mark it installed for the
  event's mode, send the welcome email (once per account)
account.application.deauthorized
  mark it uninstalled, clear its Dashboard logins, send the goodbye email.
  The row, its notes, settings and trial are kept.
```

Both handlers change the row with one conditional `UPDATE` and act only when
a row comes back, so a redelivered event does nothing
(`src/lib/app-installs.ts`). The mode comes from `event.livemode`, not from
the endpoint.

### Paying

```
1. The trial runs out; the app shows three steps instead of the form
2. Log in: the handshake in AUTHENTICATION.md ties a website user to the
   Stripe account (a memberships row)
3. /billing → Stripe Checkout → the subscription is synced into
   `subscriptions` (webhook, every load of /billing, and "Recheck my plan")
4. The account is covered while any member has an active subscription
```

## Security

- Signature-verified identity; tenant and mode scoping on every query
- Row Level Security on every table with no policies; the secret key stays
  on the server
- Webhook signatures verified against the raw body
- Input validated by `src/types/notes.ts` before it reaches a query; ids are
  checked against strict patterns
- The paywall is enforced in the route that does the paid work
- Email content is escaped; names are stripped of control characters

## Known limits

- The team list only contains people who have opened the app.
- Labels are snapshots: renaming a customer doesn't rename old notes.
- Names and emails are reported by the app, not signed by Stripe.
- The `stripe-mode` header is not signed (see AUTHENTICATION.md).
- Lists are paged by offset (50 per page, 100 at most). Fine for a team's
  queue; switch to a cursor if an account grows to tens of thousands of
  notes.
- No scheduled jobs, no due dates, no reminders, no audit log.
