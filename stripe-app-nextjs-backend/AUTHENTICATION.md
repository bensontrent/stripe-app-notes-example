# Authentication

Every request to this backend passes through the Next.js proxy
([`src/proxy.ts`](src/proxy.ts)) before reaching a page or route handler.
The proxy sorts requests into **auth flavors**; the verification helpers
live in [`src/lib/proxy-auth.ts`](src/lib/proxy-auth.ts).

## The flavors at a glance

| Flavor | How the caller authenticates | Verified | Used by |
| --- | --- | --- | --- |
| Stripe App signature | `stripe-signature` header from `fetchStripeSignature()` | In the proxy | Everything under `/api/stripe-app/` — notes, team, settings, paywall |
| Public + webhook signature | `stripe-signature` header (webhook scheme) | At the route | [`/api/webhooks/app`](src/pages/api/webhooks/app.ts), [`/api/webhooks/billing`](src/pages/api/webhooks/billing.ts) |
| Better Auth session | `better-auth.session_token` cookie | Cookie check in the proxy, real check at the route | The website: `/account`, `/billing`, `/api/protected/*` |
| Bearer token | `Authorization: Bearer <key>` vs `BEARER_TOKEN_KEYS` / `CRON_SECRET` | In the proxy | Nothing yet; ready for a scheduled job |
| Local dev API key | `Authorization: Bearer $DEV_API_KEY`, **`next dev` only** | In the proxy | Any bearer route |

After verification the proxy forwards the request with `x-auth-type` set to
the flavor that matched and, for Stripe App requests, `x-stripe-verified:
true`. The proxy **strips those headers from every incoming request first**,
so route handlers can trust them.

## Stripe App signature auth

This is how the app in the Dashboard talks to the backend, and it is the
whole identity model for notes: **no login is involved**.

The UI extension calls `fetchStripeSignature()` and sends:

```
stripe-signature:  t=...,v1=...           (HMAC from Stripe)
stripe-user-id:    usr_...                (covered by the signature)
stripe-account-id: acct_...               (covered by the signature)
stripe-mode:       live | test            (NOT covered by the signature)
```

The proxy rebuilds the signed payload from those headers and verifies the
HMAC against **`STRIPE_APP_SIGNING_SECRET`** — the "Signing secret" from the
app's page in the Stripe Developers Dashboard. Tampering with either id
breaks the signature, so route handlers can trust them. Routes read them
through `getSignedIdentity()` in
[`src/lib/signed-request.ts`](src/lib/signed-request.ts):

```ts
const identity = getSignedIdentity(req);
if (identity instanceof NextResponse) return identity;
// identity.stripeAccountId and identity.stripeUserId are trustworthy
```

What that means for notes:

- **The account id is the tenant.** Every query on `notes` is filtered by
  it (`scope()` in [`src/lib/notes.ts`](src/lib/notes.ts)).
- **The user id is "me"**: the author of a note, the "assigned to me"
  filter, the owner of the email setting.
- **The mode is not signed.** It selects which notes are read and written,
  and whether the paywall applies. Someone replaying a request could claim
  test mode to skip the paywall, but would then only reach test-mode notes.
  To close the gap, pass the mode to `fetchStripeSignature()` in the app and
  add it to the payload `verifyStripeAppSignature()` checks.
- **Names and emails are not signed either.** The app reports them at
  check-in (`POST /api/stripe-app/team`). They are display data and the
  address for assignment emails; never base a permission on them.

### Getting the signing secret (you must upload the app first)

The signing secret **does not exist until the app has been uploaded**. Until
then `fetchStripeSignature()` itself fails with `No such app: <app id>`.

```bash
cd stripe-app
stripe apps upload
```

Then open the app's page in the Stripe Developers Dashboard, copy the
**Signing secret** into `STRIPE_APP_SIGNING_SECRET` in `.env.local`, and
restart the dev server. Uploading is not publishing: an uploaded app is
visible only to your own Stripe account.

The client side lives in
[`stripe-app/src/api/backend.ts`](../stripe-app/src/api/backend.ts). The
backend URL must be listed in `connect-src` in
[`stripe-app.json`](../stripe-app/stripe-app.json).

## Public routes (route-level auth)

Routes listed in `PUBLIC_ROUTES` in `src/proxy.ts` bypass the proxy checks.
They are either genuinely public (`/docs`, `/plans`, the login pages) or
verify credentials themselves:

- **Stripe webhooks** — `/api/webhooks/app` and `/api/webhooks/billing`
  verify the webhook signature with `Stripe.webhooks.constructEvent()`.
- **Better Auth's own endpoints** — `/api/auth/*` handle their own cookies
  and CSRF.

## Better Auth sessions (the website)

Everything else falls back to the Better Auth session cookie:

- **Pages** without a session redirect to `/login?redirect=<path>`.
- **API routes** without a session get a `401` JSON response.

The proxy only does an optimistic cookie check. Route handlers do the real
verification with `auth.api.getSession()`.

Only one kind of person needs a website account: whoever pays for the app.
The pages live in the [`(login)` route group](src/app/(login)): `/login`,
`/register`, `/reset-password` and `/confirm` (the reset link is emailed
through Postmark when configured, and printed to the backend terminal
otherwise).

## Logging in from inside the Dashboard

To pay, a website account has to be tied to the Stripe account the app runs
in. A UI extension can't set cookies or render a login form, so the two
flavors above are combined in a handshake:

1. The app's [`Login` component](../stripe-app/src/components/Login.tsx)
   mints a random `state` key and opens `/stripe?state=…` in a browser tab.
2. The user signs in there. The [`/stripe` page](src/app/(login)/stripe/page.tsx)
   POSTs the state to `/api/stripe-app/session` (session auth), storing
   state → user for 15 minutes.
3. Meanwhile the app polls `GET /api/stripe-app/verify?state=…` (signature
   auth). Once the state exists, the backend links the **signed** Dashboard
   identity to that user in `stripe_app_sessions`, upserts a `memberships`
   row, and consumes the state.
4. From then on `GET /api/stripe-app/userinfo` resolves the Dashboard user
   to the website user. "Log out" is `DELETE /api/stripe-app/session`.

A subscription of any member of a Stripe account covers that account (see
`findAccountSubscription()` in `src/lib/paywall.ts`). The server-side halves
of the handshake are in
[`src/lib/stripe-app-session.ts`](src/lib/stripe-app-session.ts).

## Bearer tokens and the dev key

Any non-public request with `Authorization: Bearer <key>` is checked
against `BEARER_TOKEN_KEYS` and `CRON_SECRET`, then against `DEV_API_KEY`
(accepted only when `NODE_ENV=development`). No route requires a bearer key
today: `BEARER_ONLY_ROUTES` in `src/proxy.ts` is empty, ready for the first
scheduled job. Note that a bearer key does not make a request a Stripe App
request: the `/api/stripe-app/*` routes still refuse it, because they
require the verified signature.

## Adding a new route

1. For the app: put it under `/api/stripe-app/`, start with
   `getSignedIdentity()`, and scope every query by the identity. No proxy
   changes needed.
2. For the website: session-protected routes need no proxy changes either;
   verify with `auth.api.getSession()`.
3. Public or route-verified: add the prefix to `PUBLIC_ROUTES` and verify
   inside the handler.
4. Machine-only: add the prefix to `BEARER_ONLY_ROUTES`.
