// /api/stripe-app/team — STRIPE APP SIGNATURE auth.
//
//   POST  "I'm here." Every view of the Stripe App calls this when it opens,
//         with the name and email the Dashboard gave it for the current
//         user: { name?, email? }. The backend records the signed Dashboard
//         user as a member of the signed Stripe account and answers with the
//         whole team — the people a task can be assigned to.
//
//   GET   The team, without checking in.
//
// Both answer { me, members } (TeamResponse in src/types/notes.ts).
//
// The ids come from the signature and can be trusted. The name and email
// come from the request body and are display data only — see
// src/lib/account-users.ts.

import { NextRequest, NextResponse } from 'next/server';
import { checkIn, listTeamMembers } from '@/lib/account-users';
import { getSignedIdentity } from '@/lib/signed-request';
import type { TeamResponse } from '@/types/notes';

export async function GET(req: NextRequest) {
  try {
    const identity = getSignedIdentity(req);
    if (identity instanceof NextResponse) return identity;

    const response: TeamResponse = {
      me: identity.stripeUserId,
      members: await listTeamMembers(identity.stripeAccountId),
    };
    return NextResponse.json(response);
  } catch (error) {
    console.error('Error loading the team:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const identity = getSignedIdentity(req);
    if (identity instanceof NextResponse) return identity;

    const body = (await req.json().catch(() => null)) as { name?: unknown; email?: unknown } | null;

    return NextResponse.json(await checkIn(identity, body ?? {}));
  } catch (error) {
    console.error('Error checking in:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
