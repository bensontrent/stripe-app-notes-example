// /api/stripe-app/notes/:id — STRIPE APP SIGNATURE auth.
//
//   GET     One note.                                   200 { note }
//   PATCH   Change it: UpdateNoteBody (src/types/notes.ts), only the keys
//           that change — the text, whether it is a task, and a task's
//           priority, status and assignee. Emails the new assignee when the
//           assignee changed.                           200 { note, notification }
//   DELETE  Remove it.                                  200 { deleted: true }
//
// A note is only ever found inside the caller's own Stripe account and mode
// (src/lib/notes.ts scopes every statement by the signed identity), so an id
// from another account is a 404 like any id that doesn't exist. Everyone in
// the account may change every note — that is the product's rule, not an
// oversight; gate on the author (note.createdBy) here if yours differs.
//
// None of these is paywalled: only creating a note is.

import { NextRequest, NextResponse } from 'next/server';
import { deleteNote, getNote, NoteRequestError, updateNote } from '@/lib/notes';
import { notifyAssignee } from '@/lib/notifications';
import { getSignedIdentity } from '@/lib/signed-request';
import { isValidNoteId, validateUpdateNote, type NoteWriteResponse } from '@/types/notes';

type RouteContext = { params: Promise<{ id: string }> };

const notFound = () =>
  NextResponse.json({ error: 'Not found', message: 'No such note' }, { status: 404 });

const badRequest = (message: string) =>
  NextResponse.json({ error: 'Bad request', message }, { status: 400 });

export async function GET(req: NextRequest, { params }: RouteContext) {
  try {
    const identity = getSignedIdentity(req);
    if (identity instanceof NextResponse) return identity;

    const { id } = await params;
    if (!isValidNoteId(id)) return notFound();

    const note = await getNote(identity, id);
    return note ? NextResponse.json({ note }) : notFound();
  } catch (error) {
    console.error('Error loading a note:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: RouteContext) {
  try {
    const identity = getSignedIdentity(req);
    if (identity instanceof NextResponse) return identity;

    const { id } = await params;
    if (!isValidNoteId(id)) return notFound();

    const validated = validateUpdateNote(await req.json().catch(() => null));
    if (!validated.ok) return badRequest(validated.error);

    const updated = await updateNote(identity, id, validated.value);
    if (!updated) return notFound();

    const response: NoteWriteResponse = {
      note: updated.note,
      notification: await notifyAssignee(identity, updated.note, updated.previous.assigneeId),
    };
    return NextResponse.json(response);
  } catch (error) {
    if (error instanceof NoteRequestError) return badRequest(error.message);
    console.error('Error updating a note:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: RouteContext) {
  try {
    const identity = getSignedIdentity(req);
    if (identity instanceof NextResponse) return identity;

    const { id } = await params;
    if (!isValidNoteId(id)) return notFound();

    return (await deleteNote(identity, id)) ? NextResponse.json({ deleted: true }) : notFound();
  } catch (error) {
    console.error('Error deleting a note:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
