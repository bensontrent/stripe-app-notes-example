// components/NoteCard.tsx
//
// One note in a drawer list. Three faces:
//
//   reading    who wrote it and when, the text, and — for a task — its
//              priority, status and owner, with the one-press actions people
//              use most ("Resolve", "Make it a task")
//   editing    the NoteForm, with everything changeable at once
//   deleting   an "are you sure" step; deleting can't be undone
//
// Everyone in the Stripe account may edit and delete every note, so the card
// offers the same actions whoever wrote it.

import {
  Badge,
  Box,
  Button,
  Inline,
  Link,
} from "@stripe/ui-extension-sdk/ui";
import { useState } from "react";
import { useTeam } from "../hooks/useTeam";
import {
  dashboardRouteFor,
  formatDateTime,
  objectPhrase,
  PRIORITY_BADGES,
  STATUS_BADGES,
} from "../notes/display";
import {
  PRIORITY_LABELS,
  STATUS_LABELS,
  type Note,
  type UpdateNoteBody,
} from "../types/notes";
import { NoteForm, type NoteFormValues } from "./NoteForm";

/** The UpdateNoteBody that turns `note` into what the form holds: changed keys only. */
export function changesFrom(note: Note, values: NoteFormValues): UpdateNoteBody {
  const changes: UpdateNoteBody = {};
  if (values.body !== note.body) changes.body = values.body;
  if (values.isTask !== note.isTask) changes.isTask = values.isTask;
  if (values.isTask) {
    if (values.priority !== note.priority) changes.priority = values.priority;
    if (values.status !== note.status) changes.status = values.status;
    if (values.assigneeId !== note.assigneeId) changes.assigneeId = values.assigneeId;
  }
  return changes;
}

export type NoteCardProps = {
  note: Note;
  /**
   * True when the note was written on another object than the one this list
   * is open on (a customer's list also shows notes from their invoices and
   * payments): the card then says where, with a link.
   */
  showOrigin?: boolean;
  /** A change or delete for this note is in flight. */
  busy?: boolean;
  /** Resolve true when the change was saved. */
  onUpdate: (changes: UpdateNoteBody) => Promise<boolean>;
  onDelete: () => Promise<boolean>;
};

type Mode = "reading" | "editing" | "deleting";

export function NoteCard({ note, showOrigin = false, busy = false, onUpdate, onDelete }: NoteCardProps) {
  const { nameOf, me } = useTeam();
  const [mode, setMode] = useState<Mode>("reading");

  const edited = note.updatedAt !== note.createdAt;
  // '' = written by a caller without a Dashboard user (a platform context).
  const author = note.createdBy ? nameOf(note.createdBy) : "Someone";
  const assignee = note.assigneeId === me ? "you" : nameOf(note.assigneeId);

  return (
    <Box
      css={{
        stack: "y",
        gap: "small",
        padding: "medium",
        backgroundColor: "container",
        borderRadius: "medium",
      }}
    >
      {note.isTask && (
        <Box css={{ stack: "x", gap: "xsmall", alignY: "center", wrap: "wrap" }}>
          <Badge type={STATUS_BADGES[note.status]}>{STATUS_LABELS[note.status]}</Badge>
          <Badge type={PRIORITY_BADGES[note.priority]}>
            {PRIORITY_LABELS[note.priority]} priority
          </Badge>
          <Inline css={{ font: "caption", color: "secondary" }}>
            {note.assigneeId ? `Assigned to ${assignee}` : "Unassigned"}
          </Inline>
        </Box>
      )}

      {mode === "editing" ? (
        <NoteForm
          initial={{
            body: note.body,
            isTask: note.isTask,
            priority: note.priority,
            status: note.status,
            assigneeId: note.assigneeId,
          }}
          showStatus
          submitLabel="Save"
          onCancel={() => setMode("reading")}
          onSubmit={async (values) => {
            const changes = changesFrom(note, values);
            const saved = Object.keys(changes).length === 0 || (await onUpdate(changes));
            if (saved) setMode("reading");
            return saved;
          }}
        />
      ) : (
        <Box css={{ stack: "y", gap: "xsmall" }}>
          {note.body.split("\n").map((line, index) => (
            // Blank lines keep their height so paragraphs stay apart.
            <Box key={index}>{line || " "}</Box>
          ))}
        </Box>
      )}

      <Box css={{ font: "caption", color: "secondary" }}>
        {author} · {formatDateTime(note.createdAt)}
        {edited && ` · edited ${formatDateTime(note.updatedAt)}`}
      </Box>

      {showOrigin && (
        <Box css={{ font: "caption" }}>
          <Link href={dashboardRouteFor(note)}>Written on {objectPhrase(note)}</Link>
        </Box>
      )}

      {mode === "reading" && (
        <Box css={{ stack: "x", gap: "small", alignY: "center", wrap: "wrap" }}>
          {note.isTask ? (
            <Button
              size="small"
              disabled={busy}
              onPress={() =>
                onUpdate({ status: note.status === "resolved" ? "open" : "resolved" })
              }
            >
              {note.status === "resolved" ? "Reopen" : "Resolve"}
            </Button>
          ) : (
            <Button size="small" disabled={busy} onPress={() => onUpdate({ isTask: true })}>
              Make it a task
            </Button>
          )}
          <Button size="small" disabled={busy} onPress={() => setMode("editing")}>
            Edit
          </Button>
          <Button size="small" disabled={busy} onPress={() => setMode("deleting")}>
            Delete
          </Button>
        </Box>
      )}

      {mode === "deleting" && (
        <Box css={{ stack: "y", gap: "small" }}>
          <Inline css={{ fontWeight: "semibold" }}>
            Delete this {note.isTask ? "task" : "note"}? This can’t be undone.
          </Inline>
          <Box css={{ stack: "x", gap: "small" }}>
            <Button
              size="small"
              type="destructive"
              pending={busy}
              onPress={async () => {
                // On success the card is removed with the note; only a
                // failure leaves it here to go back to reading.
                if (!(await onDelete())) setMode("reading");
              }}
            >
              Delete
            </Button>
            <Button size="small" disabled={busy} onPress={() => setMode("reading")}>
              Keep it
            </Button>
          </Box>
        </Box>
      )}
    </Box>
  );
}
