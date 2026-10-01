# Notetaskerator — Stripe App (UI extension)

The part of Notetaskerator that runs inside the Stripe Dashboard: a notes
drawer on customer, invoice and payment pages, and a full-page task queue
for the team. It stores nothing itself; everything goes to the backend in
[`../stripe-app-nextjs-backend`](../stripe-app-nextjs-backend) over requests
signed by Stripe.

| View | Viewport | File |
| --- | --- | --- |
| Task queue (full page) | `stripe.dashboard.fullpage` | [`src/views/FullPage.tsx`](src/views/FullPage.tsx) |
| Notes on a customer | `stripe.dashboard.customer.detail` | [`src/views/CustomerNotes.tsx`](src/views/CustomerNotes.tsx) |
| Notes on an invoice | `stripe.dashboard.invoice.detail` | [`src/views/InvoiceNotes.tsx`](src/views/InvoiceNotes.tsx) |
| Notes on a payment | `stripe.dashboard.payment.detail` | [`src/views/PaymentNotes.tsx`](src/views/PaymentNotes.tsx) |

App id `com.productivity.notetaskerator1`, display name "Notetaskerator"
([`stripe-app.json`](stripe-app.json)).

## What the user sees

**In the drawer** (all three object pages share
[`src/components/ObjectNotes.tsx`](src/components/ObjectNotes.tsx)):

- a form to add a note. Switching on "This needs follow-up" makes it a task
  with a priority and an assignee
- the notes on that object, newest first, each with Resolve, Edit and
  Delete. A customer's page also lists the notes written on that customer's
  invoices and payments, with a link to where each was written
- during a live-mode trial, what is left of it; after it, how to subscribe.
  The list stays usable either way: only *adding* a note is paid for

**In the full-page app**:

| Route | Pattern | What it shows |
| --- | --- | --- |
| `home` | `/:tabId?` | The task queue: tabs **Everyone** (`/`), **Assigned to me** (`/mine`), **Unassigned** (`/unassigned`); a status filter kept in `?status=`; most urgent first. Row actions assign, start and resolve. Beside it: the team's counts, the email switch, the plan |
| `note` | `/notes/:noteId` | One note or task in full, editable, with links to the customer, invoice or payment it is about |

Routes are defined once in [`src/routes.tsx`](src/routes.tsx); everything
else navigates by route name.

## Permissions

Requested in `stripe-app.json`, read-only, and only what the features use:

| Permission | Why |
| --- | --- |
| `customer_read` | The customer's name on notes; filing an invoice or payment note under its customer |
| `invoice_read` | An invoice's number and customer |
| `payment_intent_read`, `charge_read` | A payment's amount and customer. The Dashboard's payment page is about one or the other |
| `user_email_read` | The current user's email, so teammates can be emailed when a task is assigned to them |

The app never writes to Stripe.

## How it is put together

```
stripe-app/
├── stripe-app.json               # Manifest: id, permissions, the four views, CSP
├── src/
│   ├── views/                    # One thin file per viewport
│   ├── routes.tsx                # Full-page routes + RouteRegister (type-safe navigation)
│   ├── pages/
│   │   ├── TaskQueue/            # /:tabId? — tabs.ts, QueueTab.tsx (table + side column)
│   │   └── NoteDetail/           # /notes/:noteId
│   ├── components/
│   │   ├── ObjectNotes.tsx       # The drawer: form + list for the current object
│   │   ├── NoteForm.tsx          # The one form for a note (add and edit)
│   │   ├── NoteCard.tsx          # One note in the drawer list
│   │   ├── Paywall.tsx           # The paid feature, or the trial / upgrade view
│   │   └── Login.tsx             # Log in to the website from the Dashboard (to pay)
│   ├── hooks/
│   │   ├── useNotes.ts           # A list of notes + create / update / remove (optimistic)
│   │   ├── useTeam.tsx           # Check in; who is on the team; names
│   │   ├── useNoteTarget.ts      # The object the drawer is open on, read from Stripe
│   │   ├── usePaywall.tsx        # The backend's paywall decision
│   │   └── useSettings.tsx       # The user's settings
│   ├── api/
│   │   ├── backend.ts            # Signed-fetch client: every backend call
│   │   └── stripeObjects.ts      # Reads the customer / invoice / payment for labels
│   ├── notes/display.ts          # Labels, badge colours, Dashboard links
│   ├── types/                    # notes.ts, paywall.ts, settings.ts — copies of the backend's
│   ├── providers/withNavigation.tsx
│   └── testing/                  # In-memory router, fixtures, fragment helpers for Jest
└── app_icon.png
```

Things worth knowing before changing it:

- **Only `@stripe/ui-extension-sdk` components.** Plain HTML elements and
  CSS files don't exist inside the Dashboard (`option` inside `Select` is
  the one exception). Check <https://docs.stripe.com/stripe-apps> rather
  than guessing a prop.
- **`PageModule` must be a direct child of `DetailPage` / `OverviewPage`
  columns.** Wrapping one in a `Box` throws "Invalid usage of PageModule" in
  the Dashboard.
- **Identity is the signature.** `signedFetch()` in `src/api/backend.ts`
  sends the Stripe account and user ids that `fetchStripeSignature()`
  vouches for. Nobody logs in to use notes.
- **The team is whoever has opened the app.** Stripe gives apps no team
  list, so every view checks in when it opens (`useTeam`).
- **`src/types/notes.ts`, `paywall.ts` and `settings.ts` are copies of the
  backend's files.** Change both or neither; `src/types/sync.test.ts` fails
  when they differ.
- **The paywall is decided by the backend.** The app renders the view it is
  told to; creating a note can answer 402, which `useNotes` returns as
  `denied` rather than throwing.

## Run it

Needs the [Stripe CLI](https://docs.stripe.com/stripe-cli) with the apps
plugin (`stripe plugin install apps`), and the backend running on port 3006.

```bash
npm install
```

```bash
stripe login
```

```bash
stripe apps start
```

`stripe apps start` opens the Stripe Dashboard with the app previewed. Open
a customer, an invoice or a payment and open the app from the drawer, or go
to the app's own page for the task queue.

### Upload once first: the signing secret

Signed requests are verified against the app's **signing secret**, which
exists only after the app has been uploaded once. Until then
`fetchStripeSignature()` fails with `No such app`.

```bash
stripe apps upload
```

Then copy the "Signing secret" from the app's page in the Stripe Developers
Dashboard into `STRIPE_APP_SIGNING_SECRET` in the backend's `.env.local`.
Uploading is not publishing: the app stays visible only to your own Stripe
account until you submit it for review.

## Tests

```bash
npm test
```

```bash
npm run typecheck
```

The view tests render the real views against an in-memory router
([`src/testing/mockRouter.ts`](src/testing/mockRouter.ts)) with the backend
mocked. Element props such as `OverviewPage`'s columns arrive as fragments
the test wrapper doesn't search;
[`src/testing/fragments.ts`](src/testing/fragments.ts) walks them.

## Pointing at a deployed backend

1. `src/api/backend.ts` → `BACKEND_BASE = 'https://your-backend.example.com'`
2. `stripe-app.json` → `content_security_policy.connect-src` must list
   `https://your-backend.example.com/api/` (an uploaded app can only reach
   listed URLs; the placeholder there now must be replaced)
3. `stripe apps upload`

## Before submitting to the Marketplace

- Replace `app_icon.png` and `src/views/brand_icon.svg`: they are still the
  example's.
- Set `distribution_type` to `public` in `stripe-app.json`.
- The listing needs a support URL and docs: the backend serves a user guide
  at `/docs` and prices at `/plans`.

## License

MIT — see [LICENSE](LICENSE).
