// /api/protected/billing — SESSION auth (the website, not the Stripe App).
//
//   GET  Everything the /billing page shows for the signed-in user: the plan
//        catalogue with live prices, their current plan and payment method,
//        and the Stripe accounts the plan covers. Also syncs the user's
//        subscriptions from Stripe, so the page is right the moment they
//        return from Checkout.
//
// See src/lib/billing.ts (BillingOverview) and src/lib/plans.ts.

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { loadBillingOverview } from '@/lib/billing';

export async function GET(req: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    return NextResponse.json(await loadBillingOverview(session.user));
  } catch (error) {
    console.error('Error loading billing overview:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
