// /api/protected/billing/portal — SESSION auth.
//
//   POST  Opens the Stripe customer portal for the signed-in user and
//         answers with { url }. The portal is where they change plan, update
//         the payment method, cancel, and download invoices — all hosted by
//         Stripe.
//
// See createPortalSession in src/lib/billing.ts (including the one-time
// portal setup Stripe requires).

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { BillingError, createPortalSession } from '@/lib/billing';

export async function POST(req: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const url = await createPortalSession(session.user, new URL(req.url).origin);
    return NextResponse.json({ url });
  } catch (error) {
    if (error instanceof BillingError) {
      return NextResponse.json(
        { error: 'Portal unavailable', message: error.message },
        { status: error.status },
      );
    }
    console.error('Error creating portal session:', error);
    return NextResponse.json(
      {
        error: 'Internal server error',
        message: error instanceof Error ? error.message : undefined,
      },
      { status: 500 },
    );
  }
}
