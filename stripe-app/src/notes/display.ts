// src/notes/display.ts
//
// How a note is put into words and colours. Pure functions shared by the
// drawer views and the full-page app (and unit-tested in display.test.ts),
// so a note reads the same wherever it appears.

import type { RouteDescriptor } from "@stripe/ui-extension-sdk/ui";
import {
  OBJECT_TYPE_LABELS,
  type Note,
  type NotePriority,
  type NoteStatus,
} from "../types/notes";

type BadgeType = "neutral" | "urgent" | "warning" | "negative" | "positive" | "info";

export const PRIORITY_BADGES: Record<NotePriority, BadgeType> = {
  low: "neutral",
  normal: "info",
  high: "warning",
  urgent: "urgent",
};

export const STATUS_BADGES: Record<NoteStatus, BadgeType> = {
  open: "info",
  in_progress: "warning",
  resolved: "positive",
};

/** "Oct 1, 2026, 3:04 PM" in the viewer's locale. */
export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** The first `length` characters of a note on one line, for tables. */
export function excerpt(body: string, length = 90): string {
  const oneLine = body.replace(/\s+/g, " ").trim();
  return oneLine.length > length ? `${oneLine.slice(0, length - 1).trimEnd()}…` : oneLine;
}

/**
 * What a note is about, for lists: "Invoice ABC-0001 · Jane Doe",
 * "Customer Jane Doe", or the bare id when no label was saved.
 */
export function aboutLabel(note: Note): string {
  const kind = OBJECT_TYPE_LABELS[note.objectType];
  const name = note.objectLabel ?? note.objectId;
  if (note.objectType === "customer") return `${kind} ${name}`;
  return note.customerLabel ? `${kind} ${name} · ${note.customerLabel}` : `${kind} ${name}`;
}

/** "invoice ABC-0001" — the object alone, for "Written on …" lines. */
export function objectPhrase(note: Note): string {
  return `${OBJECT_TYPE_LABELS[note.objectType].toLowerCase()} ${note.objectLabel ?? note.objectId}`;
}

/**
 * The Dashboard page of the object a note is attached to, as a route
 * descriptor: a link built from it stays in the same account, mode and
 * session, and that page's drawer shows the note.
 */
export function dashboardRouteFor(note: Pick<Note, "objectType" | "objectId">): RouteDescriptor {
  switch (note.objectType) {
    case "customer":
      return { name: "customerDetails", params: { customerId: note.objectId } };
    case "invoice":
      return { name: "invoiceDetails", params: { invoiceId: note.objectId } };
    case "payment":
      return { name: "paymentDetails", params: { paymentId: note.objectId } };
  }
}

/** What to tell the person who just assigned a task, or null for nothing. */
export function notificationText(
  notification: string | null | undefined,
  assigneeName: string,
): string | null {
  switch (notification) {
    case "sent":
      return `${assigneeName} was told by email.`;
    case "opted_out":
      return `${assigneeName} has assignment emails switched off, so no email was sent.`;
    case "no_email":
      return `No email address is on file for ${assigneeName}, so no email was sent.`;
    case "not_configured":
      return "Assignment emails are not set up on the backend yet, so no email was sent.";
    case "failed":
      return `The task was saved, but the email to ${assigneeName} could not be sent.`;
    default:
      return null;
  }
}
