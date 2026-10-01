// /api/stripe-app/session — the two ends of the Stripe App login handshake.
//
//   POST   (browser, BETTER AUTH SESSION auth) — called by the /stripe page
//          after the user logs in. Body: { state }. Stores state → user so
//          the app's polling (GET /api/stripe-app/verify) can claim it.
//
//   DELETE (STRIPE APP SIGNATURE auth) — called by the app's Log Out button.
//          Forgets the stripe_app_sessions link for this dashboard identity.
//
// See src/lib/stripe-app-session.ts for the full flow.

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { AUTH_HEADERS } from '@/lib/proxy-auth';
import {
  createLoginState,
  deleteAppSession,
  isValidStateKey,
} from '@/lib/stripe-app-session';

export async function POST(req: NextRequest) {
  try {
    // Browser traffic: the proxy only did the optimistic cookie check, so
    // verify the session for real here.
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = (await req.json().catch(() => ({}))) as { state?: unknown };
    if (!isValidStateKey(body.state)) {
      return NextResponse.json(
        { error: 'Bad request', message: 'Missing or invalid state key' },
        { status: 400 },
      );
    }

    await createLoginState(body.state, session.user.id);

    return NextResponse.json({
      message: 'Login recorded. Return to Stripe to continue.',
    });
  } catch (error) {
    console.error('Error saving login state:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  // Defense in depth: confirm the proxy verified the Stripe App signature.
  if (req.headers.get(AUTH_HEADERS.stripeVerified) !== 'true') {
    return NextResponse.json(
      { error: 'Unauthorized', message: 'Stripe signature not verified' },
      { status: 401 },
    );
  }

  // Trustworthy: covered by the signature the proxy verified.
  const accountId = req.headers.get('stripe-account-id');
  if (!accountId) {
    return NextResponse.json(
      { error: 'Bad request', message: 'Missing stripe-account-id' },
      { status: 400 },
    );
  }

  try {
    await deleteAppSession(accountId, req.headers.get('stripe-user-id') ?? '');
    return NextResponse.json({ message: 'Logged out' });
  } catch (error) {
    console.error('Error deleting app session:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
