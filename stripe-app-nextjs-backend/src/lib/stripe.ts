// lib/stripe.ts
//
// ============================================================================
//  Stripe configuration for Stripe Apps — single source of truth
// ============================================================================
//
// This file holds every Stripe credential your App needs and exposes two
// helpers (`getStripeClient` and `getWebhookSecret`) that the rest of your
// codebase calls into.
//
// Read top-to-bottom. The config object below shows you exactly which env
// vars matter; the helpers below it show you how the rest of the app uses
// them. There's no hidden indirection — what you see is what runs.
//
// ----------------------------------------------------------------------------
//  The mental model: 2 accounts × 3 environments
// ----------------------------------------------------------------------------
//
//                 |  live  |  test  |  managed_sandbox
//   --------------|--------|--------|------------------
//   app           |   ✓    |   ✓    |        ✓
//   billing       |   ✓    |   ✓    |        —
//
// "app"     The Stripe account where your Stripe App was created. This is
//           the platform account that owns connected accounts (the users
//           who installed your App) and receives Connect webhooks.
//
// "billing" The Stripe account that charges *your* customers for access to
//           the App itself. Separate from the app account. If you use a
//           single Stripe account for both, leave the STRIPE_BILLING_*
//           variables unset — the billing helpers fall back to the app
//           account automatically.
//
// "live"             Production traffic.
// "test"             Stripe's "test mode sandbox" — the renamed test mode
//                    every account has had since day one.
// "managed_sandbox"  A sandbox Stripe automatically creates inside your
//                    app account to receive events from users who install
//                    your App into a *general* sandbox (the new kind users
//                    create from the Dashboard). It has its own API keys
//                    and webhook endpoints. The billing account has no
//                    equivalent because it isn't a Stripe App.
//
// ----------------------------------------------------------------------------
//  How to determine which environment a request belongs to
// ----------------------------------------------------------------------------
//
// From the App frontend (UI extension):
//   const env =
//     userContext.account.livemode ? "live"
//     : userContext.account.isSandbox ? "managed_sandbox"
//     : "test";
//   // Send `env` to your backend in a *signed* request payload.
//
// From a webhook handler:
//   Configure each webhook endpoint with a distinct query string, e.g.:
//     /api/webhooks/app?mode=live&type=connected
//     /api/webhooks/app?mode=test&type=connected
//     /api/webhooks/app?mode=test&type=managed_sandbox
//     /api/webhooks/billing?mode=live
//   Then read the params off the incoming request to pick the signing
//   secret, and take the mode of the DATA from `event.livemode` (a live
//   connected endpoint also receives test-mode events). The two handlers
//   are src/pages/api/webhooks/app.ts and billing.ts.
//
// ============================================================================

import Stripe from "stripe";

export const STRIPE_API_VERSION = "2026-03-25.dahlia" as const;

export type StripeAccount = "app" | "billing";
export type StripeEnvironment = "live" | "test" | "managed_sandbox";
export type BillingEnvironment = "live" | "test";
export type WebhookScope = "connected" | "account";

// ---------------------------------------------------------------------------
//  Configuration
//
//  Every credential this App uses, in one object. Read this and you know
//  exactly which environment variables to set in your deployment.
//
//  All API keys here are SECRET keys (sk_live_..., sk_test_...). Never
//  put publishable keys (pk_*) in this file — those belong client-side,
//  exposed via NEXT_PUBLIC_* or equivalent.
//
//  Nothing is validated at import time. Every credential is read as
//  `process.env.X` and checked when it is first used: the helpers below
//  throw a descriptive error naming the missing variable (app account) or
//  fall back to the app account (billing account). A fresh checkout
//  therefore builds and runs before every key is configured, and only the
//  environments you actually hit need their keys.
// ---------------------------------------------------------------------------

const config = {
    app: {
        // Three secret API keys — one per environment. Each is required for
        // the environment it serves (test is all you need locally).
        secretKeys: {
            live: process.env.STRIPE_SECRET_KEY_LIVE,
            test: process.env.STRIPE_SECRET_KEY_TEST,
            managed_sandbox: process.env.STRIPE_SECRET_KEY_MANAGED_SANDBOX,
        },
        // Webhook signing secrets, split by scope:
        //   connected = events on connected accounts (your users) — required
        //               for each environment whose webhooks you receive.
        //   account   = events on your own platform account — optional, only
        //               needed if your App listens to self-account events.
        //               Managed sandbox has no `account` scope.
        webhookSecrets: {
            live: {
                connected: process.env.STRIPE_WEBHOOK_SECRET_LIVE_CONNECTED,
                account: process.env.STRIPE_WEBHOOK_SECRET_LIVE_ACCOUNT, // optional
            },
            test: {
                connected: process.env.STRIPE_WEBHOOK_SECRET_TEST_CONNECTED,
                account: process.env.STRIPE_WEBHOOK_SECRET_TEST_ACCOUNT, // optional
            },
            managed_sandbox: {
                connected: process.env.STRIPE_WEBHOOK_SECRET_MANAGED_SANDBOX_CONNECTED,
            },
        },
    },

    // Billing account — entirely optional. If you charge App users from a
    // separate Stripe account, set these. If you bill from the same account
    // your App lives in, leave them unset and the helpers below fall back
    // to the app account's credentials.
    billing: {
        secretKeys: {
            live: process.env.STRIPE_BILLING_SECRET_KEY_LIVE,           // optional
            test: process.env.STRIPE_BILLING_SECRET_KEY_TEST,           // optional
        },
        webhookSecrets: {
            live: process.env.STRIPE_BILLING_WEBHOOK_SECRET_LIVE,       // optional
            test: process.env.STRIPE_BILLING_WEBHOOK_SECRET_TEST,       // optional
        },
    },
} as const;

// ---------------------------------------------------------------------------
//  Stripe clients
//
//  One `Stripe` instance per secret API key, created on first use and then
//  cached for the life of the process. Stripe's SDK is designed for one
//  client per key — don't share a client across keys, and don't construct
//  per-request.
//
//  Creating clients lazily (instead of at module load) means a missing key
//  only fails the request that needs that environment, with an error naming
//  the variable — not `next build` or every route that imports this file.
//
//  `getClient` returns `undefined` when the key isn't set; `getStripeClient`
//  turns that into a fallback (billing → app) or a descriptive error (app).
// ---------------------------------------------------------------------------

const SECRET_KEY_ENV_VARS = {
    app: {
        live: "STRIPE_SECRET_KEY_LIVE",
        test: "STRIPE_SECRET_KEY_TEST",
        managed_sandbox: "STRIPE_SECRET_KEY_MANAGED_SANDBOX",
    },
} as const;

const stripeClients = new Map<string, Stripe>();

function getClient(account: StripeAccount, environment: StripeEnvironment): Stripe | undefined {
    const secretKeys: Record<string, string | undefined> = config[account].secretKeys;
    const secretKey = secretKeys[environment];
    if (!secretKey) return undefined;

    const cacheKey = `${account}:${environment}`;
    let client = stripeClients.get(cacheKey);
    if (!client) {
        client = new Stripe(secretKey, { apiVersion: STRIPE_API_VERSION });
        stripeClients.set(cacheKey, client);
    }
    return client;
}

function connectedWebhookSecret(environment: StripeEnvironment): string {
    const secret = config.app.webhookSecrets[environment].connected;
    if (!secret) {
        throw new Error(
            `[stripe] Missing STRIPE_WEBHOOK_SECRET_${environment.toUpperCase()}_CONNECTED. ` +
            "Copy the signing secret of that webhook endpoint from the Stripe Dashboard " +
            "(locally: the whsec_… printed by `stripe listen`).",
        );
    }
    return secret;
}

// ===========================================================================
//  Public API
// ===========================================================================

/**
 * Get a Stripe SDK client for the given environment.
 *
 * The `account` argument defaults to `"app"` because most calls in a
 * Stripe App target the platform account. Pass `"billing"` only when
 * you're operating on the account that charges your App's customers.
 *
 * If `"billing"` is requested but no billing-specific credentials are
 * configured, this falls back to the app account's client for the same
 * environment. Single-account and dual-account deployments share the same
 * code path; only the env vars differ.
 *
 * @example
 *   // Common case: app account, environment determined elsewhere.
 *   const stripe = getStripeClient(environment);
 *   const invoices = await stripe.invoices.list({ stripeAccount });
 *
 * @example
 *   // Charging an App customer for a subscription.
 *   const stripe = getStripeClient("live", "billing");
 *   await stripe.subscriptions.create({ customer, items });
 */
export function getStripeClient(
    environment: StripeEnvironment,
    account?: "app",
): Stripe;
export function getStripeClient(
    environment: BillingEnvironment,
    account: "billing",
): Stripe;
export function getStripeClient(
    environment: StripeEnvironment,
    account: StripeAccount = "app",
): Stripe {
    if (account === "billing") {
        if (environment === "managed_sandbox") {
            throw new Error(
                "[stripe] The billing account has no managed_sandbox environment.",
            );
        }
        // Fall back to the app client if billing isn't configured separately.
        const billingClient = getClient("billing", environment);
        if (billingClient) return billingClient;
    }
    const client = getClient("app", environment);
    if (!client) {
        throw new Error(
            `[stripe] Missing ${SECRET_KEY_ENV_VARS.app[environment]}. ` +
            `Set it to use the "${environment}" environment of the app account.`,
        );
    }
    return client;
}

/**
 * Get a webhook signing secret for the given environment.
 *
 * Defaults: `account = "app"`, `scope = "connected"` — the right defaults
 * for the vast majority of Stripe App webhook handlers (Connect events
 * for the users who installed your App).
 *
 * Pass `scope: "account"` only when verifying webhooks for events on your
 * own platform account (rare). The corresponding env var must be set, or
 * this throws.
 *
 * Pass `account: "billing"` to verify webhooks from your billing account.
 * Falls back to the app account's connected secret if billing isn't
 * configured separately.
 *
 * @example
 *   const secret = getWebhookSecret(environment);
 *   const event = stripe.webhooks.constructEvent(body, sig, secret);
 *
 * @example
 *   const secret = getWebhookSecret("live", "app", "account");
 *
 * @example
 *   const secret = getWebhookSecret("live", "billing");
 */
export function getWebhookSecret(
    environment: StripeEnvironment,
    account?: "app",
    scope?: WebhookScope,
): string;
export function getWebhookSecret(
    environment: BillingEnvironment,
    account: "billing",
): string;
export function getWebhookSecret(
    environment: StripeEnvironment,
    account: StripeAccount = "app",
    scope: WebhookScope = "connected",
): string {
    if (account === "billing") {
        if (environment === "managed_sandbox") {
            throw new Error(
                "[stripe] The billing account has no managed_sandbox environment.",
            );
        }
        const billingSecret = config.billing.webhookSecrets[environment];
        if (billingSecret) return billingSecret;
        // Fall back to the app account's connected secret.
        return connectedWebhookSecret(environment);
    }

    if (environment === "managed_sandbox") {
        if (scope !== "connected") {
            throw new Error(
                "[stripe] The managed sandbox only emits connected-account events.",
            );
        }
        return connectedWebhookSecret("managed_sandbox");
    }

    if (scope === "account") {
        const secret = config.app.webhookSecrets[environment].account;
        if (!secret) {
            throw new Error(
                `[stripe] Missing STRIPE_WEBHOOK_SECRET_${environment.toUpperCase()}_ACCOUNT. ` +
                `Set it to verify account-scope webhooks, or use scope: "connected".`,
            );
        }
        return secret;
    }

    return connectedWebhookSecret(environment);
}

/**
 * Whether a separate billing account is configured. Returns `false` when
 * the App is running with a single Stripe account (billing falls back to
 * the app account).
 */
export function isBillingAccountConfigured(): boolean {
    return Boolean(config.billing.secretKeys.live && config.billing.secretKeys.test);
}

// ===========================================================================
//  Example usage
// ===========================================================================
//
//  --- In a webhook route handler -------------------------------------------
//  (the real ones: src/pages/api/webhooks/app.ts and billing.ts)
//
//  import Stripe from "stripe";
//  import { getStripeClient, getWebhookSecret } from "@/lib/stripe";
//
//  export default async function handler(req, res) {
//    const mode = req.query.mode as string | undefined;
//    const type = req.query.type as string | undefined;
//
//    const endpoint =
//      type === "managed_sandbox" ? "managed_sandbox"
//      : mode === "live" ? "live"
//      : "test";
//
//    const event = Stripe.webhooks.constructEvent(
//      rawBody,
//      req.headers["stripe-signature"]!,
//      getWebhookSecret(endpoint),
//    );
//
//    // The event's own mode decides which client acts on it.
//    const stripe = getStripeClient(
//      endpoint === "managed_sandbox" ? endpoint : event.livemode ? "live" : "test",
//    );
//    // ... handle event
//  }
//
//  --- In a backend endpoint called from your App's UI extension ------------
//
//  // The frontend computed `environment` from userContext.account and
//  // sent it inside a signed request payload. Don't trust an unsigned
//  // client header here — verify the Stripe Apps fetch signature first.
//
//  const stripe = getStripeClient(environment);
//  const customer = await stripe.customers.retrieve(customerId, {
//    stripeAccount: connectedAccountId,
//  });
//
//  --- Charging an App customer (billing account) ---------------------------
//
//  const stripe = getStripeClient("live", "billing");
//  await stripe.subscriptions.create({
//    customer: customerId,
//    items: [{ price: "price_..." }],
//  });
//
//  // If STRIPE_BILLING_* env vars aren't set, this transparently uses
//  // the app account instead. Same code, single- or dual-account deploys.
//
// ===========================================================================
//  Environment variables
// ===========================================================================
//
//  All keys below are SECRET keys (sk_live_..., sk_test_...). Publishable
//  keys (pk_*) are not used here — those belong on the client side.
//
//  Required (app account) — per environment: only the environments your
//  deployment actually serves need their keys; a missing one fails at first
//  use with an error naming it. Locally, the test keys are enough.
//    STRIPE_SECRET_KEY_LIVE
//    STRIPE_SECRET_KEY_TEST
//    STRIPE_SECRET_KEY_MANAGED_SANDBOX
//    STRIPE_WEBHOOK_SECRET_LIVE_CONNECTED
//    STRIPE_WEBHOOK_SECRET_TEST_CONNECTED
//    STRIPE_WEBHOOK_SECRET_MANAGED_SANDBOX_CONNECTED
//
//  Optional (app account self-event webhooks):
//    STRIPE_WEBHOOK_SECRET_LIVE_ACCOUNT
//    STRIPE_WEBHOOK_SECRET_TEST_ACCOUNT
//
//  Optional (separate billing account):
//    STRIPE_BILLING_SECRET_KEY_LIVE
//    STRIPE_BILLING_SECRET_KEY_TEST
//    STRIPE_BILLING_WEBHOOK_SECRET_LIVE
//    STRIPE_BILLING_WEBHOOK_SECRET_TEST
//
//  The managed sandbox secret key lives *inside* the managed sandbox
//  itself, not in your main account. Open your Stripe Dashboard, switch
//  into your managed sandbox via the account picker, and grab the keys
//  from there.
// ===========================================================================