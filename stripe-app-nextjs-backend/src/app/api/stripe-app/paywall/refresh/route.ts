// /api/stripe-app/paywall/refresh — STRIPE APP SIGNATURE auth.
//
//   POST  "Recheck my plan": re-read the subscriptions of the account's
//         members from Stripe, store them, and answer with the fresh
//         PaywallStatus. The app calls this after the user comes back from
//         subscribing on the website, so the paywall lifts immediately —
//         whether or not the subscription's webhook has arrived yet.
//
// POST rather than GET because it writes (the subscriptions table) and
// calls Stripe; plain status reads stay cheap on GET /api/stripe-app/paywall.
//
// See src/lib/paywall.ts and src/lib/billing.ts.

import { NextRequest, NextResponse } from 'next/server';
import { refreshPaywallStatus } from '@/lib/paywall';
import { getSignedIdentity } from '@/lib/signed-request';

export async function POST(req: NextRequest) {
  try {
    const identity = getSignedIdentity(req);
    if (identity instanceof NextResponse) return identity;

    return NextResponse.json(await refreshPaywallStatus(identity));
  } catch (error) {
    console.error('Error refreshing paywall status:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
