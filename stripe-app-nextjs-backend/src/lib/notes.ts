// lib/notes.ts
//
// ============================================================================
//  Notes and tasks — the database half
// ============================================================================
//
// src/types/notes.ts (identical copy in the Stripe App) says what a note is
// and validates what comes in; this file reads and writes the `notes` table
// (migrations/20261001150000_notes_and_account_users.sql). The routes under
// /api/stripe-app/notes are thin wrappers around the functions here.
//
// THE RULE THAT MATTERS: every query is scoped by the signed identity — the
// Stripe account the request was signed for, and the mode it runs in. A note
// id alone never selects a row; `scoped()` adds the account and the mode to
// every statement, so one account can't read or change another's notes by
// guessing an id, and test-mode notes never show up in live mode.
// ============================================================================

import { ensureStripeAccount, findTeamMember } from './account-users';
import type { SignedIdentity } from './signed-request';
import { getSupabase } from './supabase';
import {
  applyNoteChanges,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  NOTE_PRIORITIES,
  priorityRank,
  type NewNote,
  type Note,
  type NoteChanges,
  type NoteListQuery,
  type NoteListResponse,
  type NoteObjectType,
  type NotePriority,
  type NoteStatus,
  type TaskSummary,
} from '@/types/notes';

type NoteRow = {
  id: string;
  object_type: NoteObjectType;
  object_id: string;
  customer_id: string | null;
  object_label: string | null;
  customer_label: string | null;
  body: string;
  is_task: boolean;
  priority: number;
  status: NoteStatus;
  assignee_stripe_user_id: string | null;
  created_by: string;
  updated_by: string;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
};

const NOTE_COLUMNS =
  'id, object_type, object_id, customer_id, object_label, customer_label, body, is_task, ' +
  'priority, status, assignee_stripe_user_id, created_by, updated_by, resolved_at, created_at, updated_at';

const ACTIVE_STATUSES: NoteStatus[] = ['open', 'in_progress'];

/** 1 = low … 4 = urgent, as stored. Anything unexpected reads as normal. */
const toPriority = (rank: number): NotePriority => NOTE_PRIORITIES[rank - 1] ?? 'normal';

const toNote = (row: NoteRow): Note => ({
  id: row.id,
  objectType: row.object_type,
  objectId: row.object_id,
  customerId: row.customer_id,
  objectLabel: row.object_label,
  customerLabel: row.customer_label,
  body: row.body,
  isTask: row.is_task,
  priority: toPriority(row.priority),
  status: row.status,
  assigneeId: row.assignee_stripe_user_id,
  createdBy: row.created_by,
  updatedBy: row.updated_by,
  resolvedAt: row.resolved_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

/** The two filters every statement on `notes` starts with. */
function scope(identity: SignedIdentity) {
  return {
    stripe_account_id: identity.stripeAccountId,
    livemode: identity.mode === 'live',
  };
}

/** Thrown for a request that is well-formed but can't be carried out (→ 400). */
export class NoteRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NoteRequestError';
  }
}

/**
 * An assignee has to be someone who has opened the app in this account.
 * Throws NoteRequestError otherwise. The create route calls this BEFORE the
 * paywall gate, so a request that is going to be refused never uses up trial
 * allowance.
 */
export async function assertAssignable(identity: SignedIdentity, assigneeId: string | null): Promise<void> {
  if (!assigneeId) return;
  const member = await findTeamMember(identity.stripeAccountId, assigneeId);
  if (!member) {
    throw new NoteRequestError(
      'That person has not opened the app in this Stripe account yet, so a task can’t be assigned to them.',
    );
  }
}

// ---------------------------------------------------------------------------
//  Reading
// ---------------------------------------------------------------------------

/** GET /api/stripe-app/notes */
export async function listNotes(
  identity: SignedIdentity,
  query: NoteListQuery,
): Promise<NoteListResponse> {
  const limit = Math.min(Math.max(1, query.limit ?? DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE);
  const offset = Math.max(0, query.offset ?? 0);

  let statement = getSupabase().from('notes').select(NOTE_COLUMNS).match(scope(identity));

  if (query.objectType && query.objectId) {
    // A customer's page shows everything about that customer: customer notes
    // carry their own id in customer_id, and so do the notes on the
    // customer's invoices and payments.
    statement =
      query.objectType === 'customer'
        ? statement.eq('customer_id', query.objectId)
        : statement.eq('object_type', query.objectType).eq('object_id', query.objectId);
  }

  if (query.tasksOnly) statement = statement.eq('is_task', true);

  if (query.assignee === 'me') {
    statement = statement.eq('assignee_stripe_user_id', identity.stripeUserId);
  } else if (query.assignee === 'unassigned') {
    statement = statement.is('assignee_stripe_user_id', null);
  }

  if (query.status === 'active') {
    statement = statement.in('status', ACTIVE_STATUSES);
  } else if (query.status && query.status !== 'any') {
    statement = statement.eq('status', query.status);
  }

  const ordered =
    query.sort === 'priority'
      ? statement.order('priority', { ascending: false }).order('created_at', { ascending: true })
      : statement.order('created_at', { ascending: false });

  // One row more than asked for: its presence says another page exists.
  const { data, error } = await ordered
    .order('id', { ascending: true })
    .range(offset, offset + limit)
    .returns<NoteRow[]>();
  if (error) throw error;

  return {
    notes: data.slice(0, limit).map(toNote),
    hasMore: data.length > limit,
  };
}

/** One note of the caller's account and mode, or null. */
export async function getNote(identity: SignedIdentity, id: string): Promise<Note | null> {
  const { data, error } = await getSupabase()
    .from('notes')
    .select(NOTE_COLUMNS)
    .match(scope(identity))
    .eq('id', id)
    .maybeSingle<NoteRow>();
  if (error) throw error;
  return data ? toNote(data) : null;
}

/** GET /api/stripe-app/notes/summary — five counts, no rows. */
export async function summarizeTasks(identity: SignedIdentity): Promise<TaskSummary> {
  const tasks = () =>
    getSupabase()
      .from('notes')
      .select('id', { count: 'exact', head: true })
      .match(scope(identity))
      .eq('is_task', true);

  const [open, inProgress, assignedToMe, unassigned, urgent] = await Promise.all([
    tasks().eq('status', 'open'),
    tasks().eq('status', 'in_progress'),
    tasks().in('status', ACTIVE_STATUSES).eq('assignee_stripe_user_id', identity.stripeUserId),
    tasks().in('status', ACTIVE_STATUSES).is('assignee_stripe_user_id', null),
    tasks().in('status', ACTIVE_STATUSES).eq('priority', priorityRank('urgent')),
  ]);

  for (const result of [open, inProgress, assignedToMe, unassigned, urgent]) {
    if (result.error) throw result.error;
  }

  return {
    open: open.count ?? 0,
    inProgress: inProgress.count ?? 0,
    assignedToMe: assignedToMe.count ?? 0,
    unassigned: unassigned.count ?? 0,
    urgent: urgent.count ?? 0,
  };
}

// ---------------------------------------------------------------------------
//  Writing
// ---------------------------------------------------------------------------

/**
 * POST /api/stripe-app/notes — `note` has been through validateCreateNote()
 * and assertAssignable(). The paywall check (recordFeatureUse) belongs to
 * the route and runs before this.
 */
export async function createNote(identity: SignedIdentity, note: NewNote): Promise<Note> {
  // notes.stripe_account_id references stripe_accounts; in test mode nothing
  // else may have created that row yet.
  await ensureStripeAccount(identity.stripeAccountId);

  const { data, error } = await getSupabase()
    .from('notes')
    .insert({
      ...scope(identity),
      object_type: note.objectType,
      object_id: note.objectId,
      customer_id: note.customerId,
      object_label: note.objectLabel,
      customer_label: note.customerLabel,
      body: note.body,
      is_task: note.isTask,
      priority: priorityRank(note.priority),
      assignee_stripe_user_id: note.assigneeId,
      created_by: identity.stripeUserId,
      updated_by: identity.stripeUserId,
    })
    .select(NOTE_COLUMNS)
    .single<NoteRow>();
  if (error) throw error;
  return toNote(data);
}

export type UpdatedNote = {
  note: Note;
  /** The note as it was, so the caller can tell what changed (e.g. the assignee). */
  previous: Note;
};

/**
 * PATCH /api/stripe-app/notes/:id — `changes` has been through
 * validateUpdateNote(). Null when the note doesn't exist in the caller's
 * account and mode.
 */
export async function updateNote(
  identity: SignedIdentity,
  id: string,
  changes: NoteChanges,
): Promise<UpdatedNote | null> {
  const previous = await getNote(identity, id);
  if (!previous) return null;

  if (changes.assigneeId && changes.assigneeId !== previous.assigneeId) {
    await assertAssignable(identity, changes.assigneeId);
  }

  // applyNoteChanges() holds the rules that tie the task fields together
  // (a plain note has no assignee, resolved_at follows the status, …).
  const next = applyNoteChanges(previous, changes, new Date().toISOString());

  const { data, error } = await getSupabase()
    .from('notes')
    .update({
      body: next.body,
      is_task: next.isTask,
      priority: priorityRank(next.priority),
      status: next.status,
      assignee_stripe_user_id: next.assigneeId,
      resolved_at: next.resolvedAt,
      updated_by: identity.stripeUserId,
      updated_at: next.updatedAt,
    })
    .match(scope(identity))
    .eq('id', id)
    .select(NOTE_COLUMNS)
    .maybeSingle<NoteRow>();
  if (error) throw error;

  // Deleted by someone else between the read and the write.
  return data ? { note: toNote(data), previous } : null;
}

/** DELETE /api/stripe-app/notes/:id — false when there was nothing to delete. */
export async function deleteNote(identity: SignedIdentity, id: string): Promise<boolean> {
  const { data, error } = await getSupabase()
    .from('notes')
    .delete()
    .match(scope(identity))
    .eq('id', id)
    .select('id')
    .returns<Array<{ id: string }>>();
  if (error) throw error;
  return data.length > 0;
}
