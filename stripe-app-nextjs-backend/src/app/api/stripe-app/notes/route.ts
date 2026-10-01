// /api/stripe-app/notes — STRIPE APP SIGNATURE auth.
//
//   GET   The calling Stripe account's notes in the current mode, filtered
//         by the query string (all optional):
//
//           objectType + objectId   the notes on one customer, invoice or
//                                   payment. A customer also gets the notes
//                                   on its invoices and payments.
//           tasks=true              only notes that are tasks
//           assignee=me|unassigned|anyone
//           status=active|open|in_progress|resolved|any
//           sort=priority|newest    priority = most urgent first, then oldest
//           limit, offset           paging (default 50, at most 100)
//
//         200  { notes, hasMore }
//
//   POST  Create a note (CreateNoteBody in src/types/notes.ts). THIS IS THE
//         PAID FEATURE, so it is the gated route:
//
//           1. validate the body and the assignee — a request that is going
//              to be refused must not use up trial allowance
//           2. recordFeatureUse() checks access and, during a trial, counts
//              the note against the allowance (atomically)
//           3. not allowed → 402 Payment Required with the PaywallStatus, so
//              the app can show the right paywall view
//           4. allowed → save, then email the assignee if there is one
//
//         201  { note, notification, status: PaywallStatus }
//         402  { error, message, status: PaywallStatus }
//
// Reading, editing, resolving and deleting existing notes are never gated:
// an account whose trial ran out keeps everything it wrote.
//
// Identity is the signature: the account and Dashboard user ids the proxy
// verified, plus the mode header. See src/lib/notes.ts.

import { NextRequest, NextResponse } from 'next/server';
import { assertAssignable, createNote, listNotes, NoteRequestError } from '@/lib/notes';
import { notifyAssignee } from '@/lib/notifications';
import { recordFeatureUse } from '@/lib/paywall';
import { getSignedIdentity } from '@/lib/signed-request';
import {
  ASSIGNEE_FILTERS,
  isNoteObjectType,
  isValidObjectId,
  NOTE_SORTS,
  STATUS_FILTERS,
  validateCreateNote,
  type AssigneeFilter,
  type CreateNoteResponse,
  type NoteListQuery,
  type NoteSort,
  type StatusFilter,
} from '@/types/notes';
import { REASON_MESSAGES, type PaywallDeniedBody } from '@/types/paywall';

const badRequest = (message: string) =>
  NextResponse.json({ error: 'Bad request', message }, { status: 400 });

/** A whole number from the query string, or undefined when absent or not one. */
function readInteger(value: string | null): number | undefined {
  if (value === null || !/^\d{1,6}$/.test(value)) return undefined;
  return Number(value);
}

/** The query string as a NoteListQuery, or the reason it isn't one. */
function readListQuery(params: URLSearchParams): NoteListQuery | string {
  const query: NoteListQuery = {
    tasksOnly: params.get('tasks') === 'true',
    limit: readInteger(params.get('limit')),
    offset: readInteger(params.get('offset')),
  };

  const objectType = params.get('objectType');
  const objectId = params.get('objectId');
  if (objectType !== null || objectId !== null) {
    if (!isNoteObjectType(objectType)) return 'objectType must be customer, invoice or payment';
    if (!isValidObjectId(objectType, objectId)) return `objectId is not a ${objectType} id`;
    query.objectType = objectType;
    query.objectId = objectId;
  }

  const assignee = params.get('assignee');
  if (assignee !== null) {
    if (!(ASSIGNEE_FILTERS as readonly string[]).includes(assignee)) {
      return `assignee must be one of ${ASSIGNEE_FILTERS.join(', ')}`;
    }
    query.assignee = assignee as AssigneeFilter;
  }

  const status = params.get('status');
  if (status !== null) {
    if (!(STATUS_FILTERS as readonly string[]).includes(status)) {
      return `status must be one of ${STATUS_FILTERS.join(', ')}`;
    }
    query.status = status as StatusFilter;
  }

  const sort = params.get('sort');
  if (sort !== null) {
    if (!(NOTE_SORTS as readonly string[]).includes(sort)) {
      return `sort must be one of ${NOTE_SORTS.join(', ')}`;
    }
    query.sort = sort as NoteSort;
  }

  return query;
}

export async function GET(req: NextRequest) {
  try {
    const identity = getSignedIdentity(req);
    if (identity instanceof NextResponse) return identity;

    const query = readListQuery(req.nextUrl.searchParams);
    if (typeof query === 'string') return badRequest(query);

    return NextResponse.json(await listNotes(identity, query));
  } catch (error) {
    console.error('Error listing notes:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const identity = getSignedIdentity(req);
    if (identity instanceof NextResponse) return identity;

    const validated = validateCreateNote(await req.json().catch(() => null));
    if (!validated.ok) return badRequest(validated.error);
    // Everything that can refuse the request comes before the gate.
    await assertAssignable(identity, validated.value.assigneeId);

    // ---- The gate. Nothing is saved before this says yes. -----------------
    const use = await recordFeatureUse(identity);
    if (!use.allowed) {
      const denied: PaywallDeniedBody = {
        error: 'Payment required',
        message: REASON_MESSAGES[use.status.reason],
        status: use.status,
      };
      return NextResponse.json(denied, { status: 402 });
    }
    // -----------------------------------------------------------------------

    const note = await createNote(identity, validated.value);
    const notification = await notifyAssignee(identity, note, null);

    const response: CreateNoteResponse = { note, notification, status: use.status };
    return NextResponse.json(response, { status: 201 });
  } catch (error) {
    if (error instanceof NoteRequestError) return badRequest(error.message);
    console.error('Error creating a note:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
