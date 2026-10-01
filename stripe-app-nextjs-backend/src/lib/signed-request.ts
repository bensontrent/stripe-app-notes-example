// lib/signed-request.ts
//
// Who a signed request from the Stripe App is about. By the time a route
// runs, the proxy (src/proxy.ts) has verified the `stripe-signature` header
// and marked the request; this helper turns that into a typed identity, or
// into the error response to send instead.
//
//   const identity = getSignedIdentity(req);
//   if (identity instanceof NextResponse) return identity;
//   // identity.stripeAccountId is trustworthy from here on

import { NextRequest, NextResponse } from 'next/server';
import { AUTH_HEADERS } from './proxy-auth';
import { normalizeStripeUserId } from './stripe-app-session';

export type SignedIdentity = {
  /** acct_… — covered by the signature. */
  stripeAccountId: string;
  /** usr_…, or '' for Connect/platform callers without a Dashboard user. */
  stripeUserId: string;
  /**
   * The mode the app is running in. NOT covered by the signature: it is the
   * `stripe-mode` header the app sends. Anything but 'live' is treated as
   * test. See "Can the mode header be trusted?" in the paywall docs before
   * gating money on it.
   */
  mode: 'live' | 'test';
};

export function getSignedIdentity(req: NextRequest): SignedIdentity | NextResponse {
  // Defense in depth: confirm the proxy verified the Stripe App signature.
  if (req.headers.get(AUTH_HEADERS.stripeVerified) !== 'true') {
    return NextResponse.json(
      { error: 'Unauthorized', message: 'Stripe signature not verified' },
      { status: 401 },
    );
  }

  const stripeAccountId = req.headers.get('stripe-account-id');
  if (!stripeAccountId) {
    return NextResponse.json(
      { error: 'Bad request', message: 'Missing stripe-account-id' },
      { status: 400 },
    );
  }

  return {
    stripeAccountId,
    stripeUserId: normalizeStripeUserId(req.headers.get('stripe-user-id')),
    mode: req.headers.get('stripe-mode') === 'live' ? 'live' : 'test',
  };
}
