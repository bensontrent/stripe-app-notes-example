// pages/api/webhooks/app.ts
//
// ============================================================================
//  The APP webhook — events about the Stripe accounts your app works in
// ============================================================================
//
// A Stripe App needs two kinds of webhook, and they are two files:
//
//   this file       events from the accounts that INSTALLED your app (and
//                   from your own account), sent to the account your app was
//                   created in. Installs, uninstalls, and whatever business
//                   objects your app works with.
//   ./billing.ts    events from the account that CHARGES people for your
//                   app: their subscriptions to you.
//
// One file serves every endpoint you register for the app. The query string
// you give each endpoint in the Stripe Dashboard says which one is calling,
// and therefore which signing secret verifies it:
//
//   /api/webhooks/app?mode=live&type=connected         STRIPE_WEBHOOK_SECRET_LIVE_CONNECTED
//   /api/webhooks/app?mode=test&type=connected         STRIPE_WEBHOOK_SECRET_TEST_CONNECTED
//   /api/webhooks/app?mode=test&type=managed_sandbox   STRIPE_WEBHOOK_SECRET_MANAGED_SANDBOX_CONNECTED
//   /api/webhooks/app?mode=live&type=account           STRIPE_WEBHOOK_SECRET_LIVE_ACCOUNT
//   /api/webhooks/app?mode=test&type=account           STRIPE_WEBHOOK_SECRET_TEST_ACCOUNT
//
//   type=connected        "Listen to events on connected accounts" — the
//                         accounts that installed your app. Every event
//                         carries the account's id in `event.account`.
//   type=managed_sandbox  the same, registered inside the managed sandbox
//                         Stripe creates in your account: it receives the
//                         events of users who installed into a sandbox.
//   type=account          events in your OWN account — where the app runs
//                         while you develop it, or always, for an app that
//                         is private to your account. No `event.account`.
//
// Why the Pages Router: Stripe signs the raw request body, so the body
// parser is switched off (`config` below) and the bytes are read untouched.
// The proxy lets this path through unauthenticated (PUBLIC_ROUTES in
// src/proxy.ts); the signature check below is the authentication.
//
// Docs: the "Webhooks" section of this backend's README.md
// ============================================================================

import type { NextApiRequest, NextApiResponse } from 'next';
import Stripe from 'stripe';
import { handleAppAuthorized, handleAppDeauthorized } from '@/lib/app-installs';
import {
  getStripeClient,
  getWebhookSecret,
  type StripeEnvironment,
  type WebhookScope,
} from '@/lib/stripe';
import { queryValue, readRawBody, stripeSignature } from '@/lib/webhooks';

// Hand the body over unparsed — see readRawBody().
export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).end('Method Not Allowed');
  }

  // --- Which endpoint is this? ---------------------------------------------
  const mode = queryValue(req.query.mode);
  const type = queryValue(req.query.type) ?? 'connected';

  const endpoint: StripeEnvironment =
    type === 'managed_sandbox' ? 'managed_sandbox'
    : mode === 'live' ? 'live'
    : 'test';
  const scope: WebhookScope = type === 'account' ? 'account' : 'connected';

  // --- Verify the signature -------------------------------------------------
  let webhookSecret: string;
  try {
    webhookSecret = getWebhookSecret(endpoint, 'app', scope);
  } catch (error) {
    // The message names the missing variable; keep it in the server log.
    console.error('[webhooks/app]', error instanceof Error ? error.message : error);
    return res.status(500).json({ error: 'Webhook signing secret is not configured' });
  }

  const signature = stripeSignature(req);
  if (!signature) {
    return res.status(400).json({ error: 'Missing stripe-signature header' });
  }

  let event: Stripe.Event;
  try {
    event = Stripe.webhooks.constructEvent(await readRawBody(req), signature, webhookSecret);
  } catch (error) {
    console.error('[webhooks/app] Signature verification failed:', error);
    return res.status(400).json({ error: 'Invalid signature' });
  }

  // --- Which mode is the event's data in? -----------------------------------
  // Trust `event.livemode`, not the endpoint's `mode`: for an account that
  // installed your app in both modes, Stripe sends its TEST events to your
  // live endpoint as well as your test one. (That also means such an event
  // arrives twice — one more reason every handler below is idempotent.)
  const environment: StripeEnvironment =
    endpoint === 'managed_sandbox' ? 'managed_sandbox'
    : event.livemode ? 'live'
    : 'test';

  // The account the event is about: the installing account on a connected
  // endpoint, your own account (set STRIPE_APP_ACCOUNT_ID) on type=account.
  const accountId = event.account ?? process.env.STRIPE_APP_ACCOUNT_ID ?? null;

  // --- Handle the event -----------------------------------------------------
  try {
    let result: string;

    switch (event.type) {
      // A Stripe account installed the app: record it, send the welcome email.
      case 'account.application.authorized':
        result = await handleAppAuthorized(event, getStripeClient(environment));
        break;

      // A Stripe account uninstalled the app: record it, clean up, say goodbye.
      case 'account.application.deauthorized':
        result = await handleAppDeauthorized(event);
        break;

      // An example of the events your app is really about: something changed
      // in an account the app is installed in. To act on it, call the API as
      // that account:
      //
      //   const stripe = getStripeClient(environment);
      //   await stripe.customers.retrieve(customer.id, { stripeAccount: accountId });
      //
      // The app needs the `event_read` permission plus the one for each
      // object (`customer_read` here) in stripe-app.json to receive these.
      case 'customer.created':
      case 'customer.updated': {
        const customer = event.data.object;
        result = `Customer ${customer.id} in ${accountId ?? 'an unknown account'} (${environment})`;
        break;
      }

      // Stripe expects a 2xx for events you don't handle too; anything else
      // is retried for days and can get the endpoint disabled.
      default:
        result = `Unhandled event type ${event.type}`;
    }

    console.log(`[webhooks/app] ${event.type} ${event.id}: ${result}`);
    return res.status(200).json({ received: true, result });
  } catch (error) {
    // A 500 asks Stripe to deliver the event again later, which is what you
    // want when the database was briefly unreachable.
    console.error(`[webhooks/app] ${event.type} ${event.id} failed:`, error);
    return res.status(500).json({ error: 'Webhook handler failed' });
  }
}
