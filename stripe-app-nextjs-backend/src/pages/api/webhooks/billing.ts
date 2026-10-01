// pages/api/webhooks/billing.ts
//
// ============================================================================
//  The BILLING webhook — events from the account that charges for your app
// ============================================================================
//
// The people who install your Stripe App are your customers. They subscribe
// on this backend's website (/billing, src/lib/billing.ts), and those
// subscriptions live in YOUR Stripe account — the "billing" account of
// src/lib/stripe.ts. This endpoint listens to that account, and its one job
// is to keep the `subscriptions` table current, because that table is what
// the paywall reads (src/lib/paywall.ts).
//
// It has nothing to do with the accounts your app is installed into — their
// events go to ./app.ts. Here there is no `event.account` and no Connect: a
// plain endpoint ("Your account") in the billing account, one per mode:
//
//   /api/webhooks/billing?mode=live   STRIPE_BILLING_WEBHOOK_SECRET_LIVE
//   /api/webhooks/billing?mode=test   STRIPE_BILLING_WEBHOOK_SECRET_TEST
//
// subscribed to customer.subscription.created, .updated and .deleted.
//
// One Stripe account for both the app and its billing? Then leave the
// STRIPE_BILLING_* variables unset: the secret falls back to
// STRIPE_WEBHOOK_SECRET_<MODE>_CONNECTED, which is also what a single local
// `stripe listen` signs everything with.
//
// Pages Router with the body parser off, for the same reason as ./app.ts:
// the signature is over the raw bytes.
//
// Docs: the "Webhooks" and "Trial and billing" sections of this backend's README.md
// ============================================================================

import type { NextApiRequest, NextApiResponse } from 'next';
import Stripe from 'stripe';
import { syncSubscription } from '@/lib/billing';
import { getWebhookSecret, type BillingEnvironment } from '@/lib/stripe';
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

  const environment: BillingEnvironment =
    queryValue(req.query.mode) === 'live' ? 'live' : 'test';

  // --- Verify the signature -------------------------------------------------
  let webhookSecret: string;
  try {
    webhookSecret = getWebhookSecret(environment, 'billing');
  } catch (error) {
    // The message names the missing variable; keep it in the server log.
    console.error('[webhooks/billing]', error instanceof Error ? error.message : error);
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
    console.error('[webhooks/billing] Signature verification failed:', error);
    return res.status(400).json({ error: 'Invalid signature' });
  }

  // --- Handle the event -----------------------------------------------------
  try {
    let result: string;

    switch (event.type) {
      // Every subscription change — bought, renewed, plan changed, payment
      // failed (past_due), cancelled (deleted) — is handled the same way:
      // write the subscription's current state. The event carries the whole
      // object, status 'canceled' included, so there is no per-event logic
      // to get out of step, and a repeated or late event does no harm.
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const subscription = event.data.object;
        const synced = await syncSubscription(subscription);
        // false: not one of our users' customers (e.g. a subscription made by
        // hand in the Dashboard). Acknowledged all the same, or Stripe
        // would keep retrying an event that will never match.
        result = synced
          ? `Subscription ${subscription.id} synced (${subscription.status})`
          : `Subscription ${subscription.id} belongs to an unknown customer, skipped`;
        break;
      }

      // More events worth adding once you send your own billing email,
      // each one a `case` that loads the customer and calls sendEmail():
      //
      //   invoice.paid                    receipt
      //   invoice.payment_failed          "your payment failed, update your card"
      //   customer.subscription.paused / .resumed
      //
      // Stripe can send the receipt and failed-payment emails for you
      // (Dashboard → Settings → Billing), which is where to start.

      default:
        result = `Unhandled event type ${event.type}`;
    }

    console.log(`[webhooks/billing] ${event.type} ${event.id}: ${result}`);
    return res.status(200).json({ received: true, result });
  } catch (error) {
    // A 500 asks Stripe to deliver the event again later.
    console.error(`[webhooks/billing] ${event.type} ${event.id} failed:`, error);
    return res.status(500).json({ error: 'Webhook handler failed' });
  }
}
