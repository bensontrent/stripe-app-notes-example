// GET /api/stripe-app/verify?state=… — STRIPE APP SIGNATURE auth.
//
// The polling half of the login handshake. The Stripe App calls this every
// few seconds after opening /stripe?state=… in a browser tab:
//
//   404 — the user hasn't finished logging in yet (or the state expired);
//         keep polling.
//   200 — the state was claimed: the dashboard identity from the signed
//         headers is now linked to the app user, and the app can fetch
//         /api/stripe-app/userinfo.
//
// See src/lib/stripe-app-session.ts for the full flow.

import { NextRequest, NextResponse } from 'next/server';
import { AUTH_HEADERS } from '@/lib/proxy-auth';
import { claimLoginState, isValidStateKey } from '@/lib/stripe-app-session';

export async function GET(req: NextRequest) {
  // Defense in depth: confirm the proxy verified the Stripe App signature.
  if (req.headers.get(AUTH_HEADERS.stripeVerified) !== 'true') {
    return NextResponse.json(
      { error: 'Unauthorized', message: 'Stripe signature not verified' },
      { status: 401 },
    );
  }

  // Trustworthy: covered by the signature the proxy verified.
  const accountId = req.headers.get('stripe-account-id');
  const state = req.nextUrl.searchParams.get('state');

  if (!accountId || !isValidStateKey(state)) {
    return NextResponse.json(
      { error: 'Bad request', message: 'Missing account id or state key' },
      { status: 400 },
    );
  }

  try {
    const linked = await claimLoginState(
      state,
      accountId,
      req.headers.get('stripe-user-id') ?? '',
    );

    if (!linked) {
      return NextResponse.json(
        { linked: false, message: 'Login not completed yet' },
        { status: 404 },
      );
    }

    return NextResponse.json({ linked: true });
  } catch (error) {
    console.error('Error verifying login state:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
