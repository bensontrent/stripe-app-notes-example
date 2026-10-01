// /api/stripe-app/notes/summary — STRIPE APP SIGNATURE auth.
//
//   GET  The numbers above the task queue, for the calling Stripe account in
//        the current mode: { open, inProgress, assignedToMe, unassigned,
//        urgent } (TaskSummary in src/types/notes.ts). Counts only, no rows.
//
// See summarizeTasks() in src/lib/notes.ts.

import { NextRequest, NextResponse } from 'next/server';
import { summarizeTasks } from '@/lib/notes';
import { getSignedIdentity } from '@/lib/signed-request';

export async function GET(req: NextRequest) {
  try {
    const identity = getSignedIdentity(req);
    if (identity instanceof NextResponse) return identity;

    return NextResponse.json(await summarizeTasks(identity));
  } catch (error) {
    console.error('Error summarizing tasks:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
