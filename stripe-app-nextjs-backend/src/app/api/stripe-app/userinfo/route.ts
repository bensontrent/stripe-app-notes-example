// GET /api/stripe-app/userinfo — STRIPE APP SIGNATURE auth.
//
// Resolves the signed dashboard identity (stripe-account-id +
// stripe-user-id) to the app user who logged in via the /stripe handshake.
// The Stripe App calls this on every load: 200 with the user means "show
// the logged-in UI", 401 means "show the login button".
//
// See src/lib/stripe-app-session.ts for the full flow.

import { NextRequest, NextResponse } from 'next/server';
import { AUTH_HEADERS } from '@/lib/proxy-auth';
import { getAppUser } from '@/lib/stripe-app-session';

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
  if (!accountId) {
    return NextResponse.json(
      { error: 'Bad request', message: 'Missing stripe-account-id' },
      { status: 400 },
    );
  }

  try {
    const user = await getAppUser(
      accountId,
      req.headers.get('stripe-user-id') ?? '',
    );

    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized', message: 'Not logged in' },
        { status: 401 },
      );
    }

    return NextResponse.json({
      userId: user.userId,
      email: user.email,
      name: user.name,
      accountId,
    });
  } catch (error) {
    console.error('Error fetching app user:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
