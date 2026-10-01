// /api/stripe-app/paywall/trial — STRIPE APP SIGNATURE auth.
//
//   POST    Start the calling Stripe account's free trial and answer with
//           the new PaywallStatus. The app calls this when the user accepts
//           the trial terms. Idempotent: if the trial already exists it is
//           returned untouched — pressing the button again, or a colleague
//           pressing it at the same moment, never restarts the clock.
//
// There is deliberately no way to reset a trial over HTTP: it would be a
// free-trial vending machine. To rehearse the paywall again in development,
// clear trial_started_at / trial_usage_count on the account's
// account_settings row in the database.
//
// See src/lib/paywall.ts.

import { NextRequest, NextResponse } from 'next/server';
import { startTrial } from '@/lib/paywall';
import { getSignedIdentity } from '@/lib/signed-request';

export async function POST(req: NextRequest) {
  try {
    const identity = getSignedIdentity(req);
    if (identity instanceof NextResponse) return identity;

    return NextResponse.json(await startTrial(identity));
  } catch (error) {
    console.error('Error starting trial:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
