// types/notes.ts
//
// ============================================================================
//  Notes and tasks — the single definition of what a note is
// ============================================================================
//
// IDENTICAL copies of this file live in both projects:
//
//   stripe-app-nextjs-backend/src/types/notes.ts   (validates and stores)
//   stripe-app/src/types/notes.ts                  (renders and sends)
//
// Keep them in sync — same arrangement as src/types/settings.ts and
// src/types/paywall.ts. The only import is a type from the paywall file next
// to it, which both projects have, so the file compiles in both.
//
// The model, in one paragraph: a NOTE is a piece of text attached to one
// Stripe object — a customer, an invoice or a payment — inside one Stripe
// account and one mode (test notes and live notes never mix). A note can be
// turned into a TASK, which adds a priority, a status and an optional
// assignee; turning it back into a plain note drops them. Everyone who uses
// the app in the account sees and may change every note. An assignee is a
// TEAM MEMBER: a Dashboard user of the same account who has opened the app
// at least once (Stripe gives apps no team list, so that is how the app
// learns who exists).
// ============================================================================

import type { PaywallStatus } from './paywall';

export type NoteObjectType = 'customer' | 'invoice' | 'payment';
export type NotePriority = 'low' | 'normal' | 'high' | 'urgent';
export type NoteStatus = 'open' | 'in_progress' | 'resolved';

export const NOTE_OBJECT_TYPES: readonly NoteObjectType[] = ['customer', 'invoice', 'payment'];
/** Least urgent first. The database stores the position + 1 (1 = low … 4 = urgent). */
export const NOTE_PRIORITIES: readonly NotePriority[] = ['low', 'normal', 'high', 'urgent'];
export const NOTE_STATUSES: readonly NoteStatus[] = ['open', 'in_progress', 'resolved'];

export const DEFAULT_PRIORITY: NotePriority = 'normal';
export const DEFAULT_STATUS: NoteStatus = 'open';

export const PRIORITY_LABELS: Record<NotePriority, string> = {
  low: 'Low',
  normal: 'Normal',
  high: 'High',
  urgent: 'Urgent',
};

export const STATUS_LABELS: Record<NoteStatus, string> = {
  open: 'Open',
  in_progress: 'In progress',
  resolved: 'Resolved',
};

export const OBJECT_TYPE_LABELS: Record<NoteObjectType, string> = {
  customer: 'Customer',
  invoice: 'Invoice',
  payment: 'Payment',
};

export const MAX_NOTE_LENGTH = 5000;
export const MAX_LABEL_LENGTH = 200;

/** A note as both sides of the API see it. */
export type Note = {
  id: string;
  objectType: NoteObjectType;
  /** cus_…, in_…, or pi_… / ch_… for a payment. */
  objectId: string;
  /** The customer the object belongs to (itself, for a customer note), or null. */
  customerId: string | null;
  /** What to call the object in a list, saved when the note was written. */
  objectLabel: string | null;
  customerLabel: string | null;
  body: string;
  isTask: boolean;
  /** Only meaningful while isTask is true. */
  priority: NotePriority;
  status: NoteStatus;
  /** A team member's usr_… id, or null for nobody. */
  assigneeId: string | null;
  /** usr_… of the author; '' when the caller had no Dashboard user. */
  createdBy: string;
  updatedBy: string;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

/** Someone who has opened the app in this Stripe account. */
export type TeamMember = {
  /** usr_… */
  id: string;
  name: string | null;
  email: string | null;
  lastSeenAt: string;
};

/** POST /api/stripe-app/team — "I'm here", answered with the whole team. */
export type TeamCheckInBody = {
  name?: string | null;
  email?: string | null;
};

export type TeamResponse = {
  /** The caller's own usr_… id ('' when there is none). */
  me: string;
  members: TeamMember[];
};

// ---------------------------------------------------------------------------
//  Listing
// ---------------------------------------------------------------------------

export type AssigneeFilter = 'anyone' | 'me' | 'unassigned';
/** 'active' = open or in progress; 'any' = no filter. */
export type StatusFilter = NoteStatus | 'active' | 'any';
/** 'priority' = most urgent first, then oldest; 'newest' = latest first. */
export type NoteSort = 'priority' | 'newest';

export const ASSIGNEE_FILTERS: readonly AssigneeFilter[] = ['anyone', 'me', 'unassigned'];
export const STATUS_FILTERS: readonly StatusFilter[] = ['active', 'open', 'in_progress', 'resolved', 'any'];
export const NOTE_SORTS: readonly NoteSort[] = ['priority', 'newest'];

/** GET /api/stripe-app/notes query, before it becomes a query string. */
export type NoteListQuery = {
  /**
   * The notes on one object. For a customer this also returns the notes on
   * that customer's invoices and payments.
   */
  objectType?: NoteObjectType;
  objectId?: string;
  /** Only notes that are tasks. */
  tasksOnly?: boolean;
  assignee?: AssigneeFilter;
  status?: StatusFilter;
  sort?: NoteSort;
  limit?: number;
  offset?: number;
};

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 100;

export type NoteListResponse = {
  notes: Note[];
  /** True when another page exists after these. */
  hasMore: boolean;
};

/** GET /api/stripe-app/notes/summary — the numbers above the task queue. */
export type TaskSummary = {
  open: number;
  inProgress: number;
  /** Open or in progress, assigned to the caller. */
  assignedToMe: number;
  /** Open or in progress, assigned to nobody. */
  unassigned: number;
  /** Open or in progress, priority urgent. */
  urgent: number;
};

// ---------------------------------------------------------------------------
//  Writing
// ---------------------------------------------------------------------------

/** POST /api/stripe-app/notes */
export type CreateNoteBody = {
  objectType: NoteObjectType;
  objectId: string;
  customerId?: string | null;
  objectLabel?: string | null;
  customerLabel?: string | null;
  body: string;
  isTask?: boolean;
  priority?: NotePriority;
  assigneeId?: string | null;
};

/** PATCH /api/stripe-app/notes/:id — send only what changes. */
export type UpdateNoteBody = {
  body?: string;
  isTask?: boolean;
  priority?: NotePriority;
  status?: NoteStatus;
  assigneeId?: string | null;
};

/**
 * What happened to the "you were assigned a task" email:
 *
 *   none            nobody to tell (not a task, no assignee, the assignee
 *                   didn't change, or people assigned it to themselves)
 *   sent            emailed
 *   no_email        the assignee has no email address on record
 *   opted_out       the assignee switched these emails off
 *   not_configured  the backend has no email provider set up
 *   failed          the provider refused it (the save still succeeded)
 */
export type AssignmentNotification =
  | 'none'
  | 'sent'
  | 'no_email'
  | 'opted_out'
  | 'not_configured'
  | 'failed';

/** POST and PATCH answer with the saved note and what became of the email. */
export type NoteWriteResponse = {
  note: Note;
  notification: AssignmentNotification;
};

/**
 * Creating a note is the paid feature, so POST also reports where the
 * account's trial stands after this note was counted. (When the paywall says
 * no, the answer is a 402 with a PaywallDeniedBody instead.)
 */
export type CreateNoteResponse = NoteWriteResponse & { status: PaywallStatus };

// ---------------------------------------------------------------------------
//  Validation — the backend runs these on every write; the app can run them
//  first to explain a problem without a round trip.
// ---------------------------------------------------------------------------

const OBJECT_ID_PATTERNS: Record<NoteObjectType, RegExp> = {
  customer: /^cus_[A-Za-z0-9]{1,250}$/,
  invoice: /^in_[A-Za-z0-9]{1,250}$/,
  // The Dashboard's payment page is about a PaymentIntent, or about a bare
  // charge for payments made without one.
  payment: /^(pi|ch|py)_[A-Za-z0-9]{1,250}$/,
};

const CUSTOMER_ID_PATTERN = OBJECT_ID_PATTERNS.customer;
const USER_ID_PATTERN = /^usr_[A-Za-z0-9]{1,250}$/;
const NOTE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isNoteObjectType(value: unknown): value is NoteObjectType {
  return typeof value === 'string' && (NOTE_OBJECT_TYPES as readonly string[]).includes(value);
}

export function isNotePriority(value: unknown): value is NotePriority {
  return typeof value === 'string' && (NOTE_PRIORITIES as readonly string[]).includes(value);
}

export function isNoteStatus(value: unknown): value is NoteStatus {
  return typeof value === 'string' && (NOTE_STATUSES as readonly string[]).includes(value);
}

export function isValidObjectId(objectType: NoteObjectType, value: unknown): value is string {
  return typeof value === 'string' && OBJECT_ID_PATTERNS[objectType].test(value);
}

export function isValidNoteId(value: unknown): value is string {
  return typeof value === 'string' && NOTE_ID_PATTERN.test(value);
}

export type Validated<T> = { ok: true; value: T } | { ok: false; error: string };

function invalid<T>(error: string): Validated<T> {
  return { ok: false, error };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The note's text: trimmed, not empty, not longer than MAX_NOTE_LENGTH. */
function readBody(value: unknown): Validated<string> {
  if (typeof value !== 'string') return invalid('body must be text');
  const body = value.trim();
  if (body.length === 0) return invalid('A note needs some text');
  if (body.length > MAX_NOTE_LENGTH) {
    return invalid(`A note can be at most ${MAX_NOTE_LENGTH} characters`);
  }
  return { ok: true, value: body };
}

/** An optional display label: trimmed and cut to MAX_LABEL_LENGTH, or null. */
function readLabel(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const label = value.trim();
  return label.length === 0 ? null : label.slice(0, MAX_LABEL_LENGTH);
}

function readAssignee(value: unknown): Validated<string | null> {
  if (value === null || value === undefined || value === '') return { ok: true, value: null };
  if (typeof value !== 'string' || !USER_ID_PATTERN.test(value)) {
    return invalid('assigneeId must be a Dashboard user id (usr_…) or null');
  }
  return { ok: true, value };
}

/** A CreateNoteBody with every optional field filled in. */
export type NewNote = {
  objectType: NoteObjectType;
  objectId: string;
  customerId: string | null;
  objectLabel: string | null;
  customerLabel: string | null;
  body: string;
  isTask: boolean;
  priority: NotePriority;
  assigneeId: string | null;
};

export function validateCreateNote(input: unknown): Validated<NewNote> {
  if (!isRecord(input)) return invalid('The request body must be an object');

  if (!isNoteObjectType(input.objectType)) {
    return invalid(`objectType must be one of ${NOTE_OBJECT_TYPES.join(', ')}`);
  }
  const objectType = input.objectType;
  if (!isValidObjectId(objectType, input.objectId)) {
    return invalid(`objectId is not a ${objectType} id`);
  }
  const objectId = input.objectId;

  // A customer note is about that customer; anything else may name the
  // customer it belongs to.
  let customerId: string | null = null;
  if (objectType === 'customer') {
    customerId = objectId;
  } else if (input.customerId !== null && input.customerId !== undefined && input.customerId !== '') {
    if (typeof input.customerId !== 'string' || !CUSTOMER_ID_PATTERN.test(input.customerId)) {
      return invalid('customerId must be a customer id (cus_…) or null');
    }
    customerId = input.customerId;
  }

  const body = readBody(input.body);
  if (!body.ok) return body;

  if (input.isTask !== undefined && typeof input.isTask !== 'boolean') {
    return invalid('isTask must be true or false');
  }
  const isTask = input.isTask === true;

  if (input.priority !== undefined && !isNotePriority(input.priority)) {
    return invalid(`priority must be one of ${NOTE_PRIORITIES.join(', ')}`);
  }
  const assignee = readAssignee(input.assigneeId);
  if (!assignee.ok) return assignee;

  const objectLabel = readLabel(input.objectLabel);
  const customerLabel = readLabel(input.customerLabel);

  return {
    ok: true,
    value: {
      objectType,
      objectId,
      customerId,
      objectLabel,
      customerLabel: objectType === 'customer' ? customerLabel ?? objectLabel : customerLabel,
      body: body.value,
      isTask,
      // A plain note carries the defaults, so turning it into a task later
      // starts from a clean slate.
      priority: isTask && input.priority !== undefined ? input.priority : DEFAULT_PRIORITY,
      assigneeId: isTask ? assignee.value : null,
    },
  };
}

/** An UpdateNoteBody that passed validation: only the keys that were sent. */
export type NoteChanges = {
  body?: string;
  isTask?: boolean;
  priority?: NotePriority;
  status?: NoteStatus;
  assigneeId?: string | null;
};

export function validateUpdateNote(input: unknown): Validated<NoteChanges> {
  if (!isRecord(input)) return invalid('The request body must be an object');

  const changes: NoteChanges = {};

  if (input.body !== undefined) {
    const body = readBody(input.body);
    if (!body.ok) return body;
    changes.body = body.value;
  }
  if (input.isTask !== undefined) {
    if (typeof input.isTask !== 'boolean') return invalid('isTask must be true or false');
    changes.isTask = input.isTask;
  }
  if (input.priority !== undefined) {
    if (!isNotePriority(input.priority)) {
      return invalid(`priority must be one of ${NOTE_PRIORITIES.join(', ')}`);
    }
    changes.priority = input.priority;
  }
  if (input.status !== undefined) {
    if (!isNoteStatus(input.status)) {
      return invalid(`status must be one of ${NOTE_STATUSES.join(', ')}`);
    }
    changes.status = input.status;
  }
  if (input.assigneeId !== undefined) {
    const assignee = readAssignee(input.assigneeId);
    if (!assignee.ok) return assignee;
    changes.assigneeId = assignee.value;
  }

  if (Object.keys(changes).length === 0) return invalid('Nothing to change');
  return { ok: true, value: changes };
}

/**
 * The note after `changes` are applied — the rules that tie the task fields
 * together, in one place so the backend's write and the app's optimistic
 * update can't disagree:
 *
 *   • turning a task back into a note drops its priority, status and assignee
 *   • priority, status and assignee can't be set on a plain note
 *   • resolvedAt follows the status
 */
export function applyNoteChanges(note: Note, changes: NoteChanges, now: string): Note {
  const isTask = changes.isTask ?? note.isTask;

  if (!isTask) {
    return {
      ...note,
      body: changes.body ?? note.body,
      isTask: false,
      priority: DEFAULT_PRIORITY,
      status: DEFAULT_STATUS,
      assigneeId: null,
      resolvedAt: null,
      updatedAt: now,
    };
  }

  const status = changes.status ?? note.status;
  return {
    ...note,
    body: changes.body ?? note.body,
    isTask: true,
    priority: changes.priority ?? note.priority,
    status,
    assigneeId: changes.assigneeId === undefined ? note.assigneeId : changes.assigneeId,
    resolvedAt: status === 'resolved' ? note.resolvedAt ?? now : null,
    updatedAt: now,
  };
}

// ---------------------------------------------------------------------------
//  Display helpers
// ---------------------------------------------------------------------------

/** "Jane Doe", else her email, else a stand-in for someone we know nothing about. */
export function memberLabel(member: TeamMember | null | undefined, fallback = 'A teammate'): string {
  return member?.name?.trim() || member?.email?.trim() || fallback;
}

/** Position of a priority, for sorting: urgent is highest. */
export function priorityRank(priority: NotePriority): number {
  return NOTE_PRIORITIES.indexOf(priority) + 1;
}

/** The task queue's order: most urgent first, then the oldest. */
export function compareTasks(a: Note, b: Note): number {
  const byPriority = priorityRank(b.priority) - priorityRank(a.priority);
  if (byPriority !== 0) return byPriority;
  return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
}
