// /api/stripe-app/paywall — STRIPE APP SIGNATURE auth.
//
//   GET   The calling Stripe account's PaywallStatus: whether it may use the
//         paid features, why (test mode / subscribed / trialing / …), what
//         the app should render (`view`), and the trial's remaining
//         allowance. This is what the Stripe App's usePaywall hook loads.
//
// The family of routes:
//
//   GET    /api/stripe-app/paywall           status (this file)
//   POST   /api/stripe-app/paywall/trial     start the free trial
//   (the gate itself is POST /api/stripe-app/notes: creating a note)
//   POST   /api/stripe-app/paywall/refresh   re-read subscriptions from Stripe
//
// Every one answers with a PaywallStatus (src/types/paywall.ts), so the app
// replaces its state in one step whatever it just did.
//
// Identity is the signature: the trial belongs to the Stripe account
// (stripe-account-id), so no app login is needed to start or use one. A
// login only enters the picture when someone pays — see src/lib/billing.ts.
//
// See src/lib/paywall.ts (facts + operations) and src/types/paywall.ts (the
// decision).

import { NextRequest, NextResponse } from 'next/server';
import { loadPaywallStatus } from '@/lib/paywall';
import { getSignedIdentity } from '@/lib/signed-request';

export async function GET(req: NextRequest) {
  try {
    const identity = getSignedIdentity(req);
    if (identity instanceof NextResponse) return identity;

    return NextResponse.json(await loadPaywallStatus(identity));
  } catch (error) {
    console.error('Error loading paywall status:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
