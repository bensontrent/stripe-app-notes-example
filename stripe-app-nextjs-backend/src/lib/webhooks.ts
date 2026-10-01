// lib/webhooks.ts
//
// Plumbing shared by the two Stripe webhook endpoints:
//
//   src/pages/api/webhooks/app.ts      events about the accounts your app is
//                                      installed into (and your own account)
//   src/pages/api/webhooks/billing.ts  events from the account that charges
//                                      your users for the app
//
// Both live in the Pages Router (src/pages/api) with Next's body parser
// switched off, because Stripe signs the request body byte for byte: the
// signature only verifies against the exact bytes Stripe sent, never against
// JSON that was parsed and serialised again.

import type { NextApiRequest } from 'next';

/**
 * The request body exactly as it arrived. The route must export
 * `config = { api: { bodyParser: false } }`, otherwise Next has already
 * consumed the stream and this returns an empty buffer.
 */
export async function readRawBody(req: NextApiRequest): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

/** `?mode=live&mode=test` arrives as an array; take the first value. */
export function queryValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** The `stripe-signature` header, or null when it is missing. */
export function stripeSignature(req: NextApiRequest): string | null {
  const header = req.headers['stripe-signature'];
  return typeof header === 'string' && header ? header : null;
}
