// /api/protected/billing/checkout — SESSION auth.
//
//   POST  Body: { lookupKey: string } — a plan from src/config/plans.json.
//         Starts a Stripe Checkout session for that plan and answers with
//         { url } for the browser to go to. The plan is looked up on the
//         server; the browser never names a price id or an amount.
//
// See createCheckoutSession in src/lib/billing.ts.

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { BillingError, createCheckoutSession } from '@/lib/billing';

export async function POST(req: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = (await req.json().catch(() => ({}))) as { lookupKey?: unknown };
    if (typeof body.lookupKey !== 'string' || body.lookupKey === '') {
      return NextResponse.json(
        { error: 'Bad request', message: 'lookupKey is required' },
        { status: 400 },
      );
    }

    const url = await createCheckoutSession(
      session.user,
      body.lookupKey,
      new URL(req.url).origin,
    );
    return NextResponse.json({ url });
  } catch (error) {
    if (error instanceof BillingError) {
      return NextResponse.json(
        { error: 'Checkout unavailable', message: error.message },
        { status: error.status },
      );
    }
    console.error('Error creating checkout session:', error);
    return NextResponse.json(
      {
        error: 'Internal server error',
        // Stripe's own messages are written for developers and safe to show.
        message: error instanceof Error ? error.message : undefined,
      },
      { status: 500 },
    );
  }
}
