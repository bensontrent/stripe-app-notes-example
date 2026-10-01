// src/pages/NoteDetail/index.tsx
//
// The `note` route (`/notes/:noteId`): one note or task in full — the page a
// row of the task queue opens. Everything about the note can be changed here
// (the same NoteForm the drawer uses), it can be resolved or deleted, and the
// side column links to the customer, invoice or payment it is about with a
// route descriptor, which keeps the user in the same account and mode.
//
// An id that doesn't exist — deleted meanwhile, from the other mode, or
// mistyped — gets a real page too rather than a blank one.

import type { ExtensionContextValue } from "@stripe/ui-extension-sdk/context";
import { useNavigation } from "@stripe/ui-extension-sdk/navigation";
import {
  Badge,
  Banner,
  Box,
  Button,
  DetailPage,
  Inline,
  Link,
  PageModule,
  PropertyList,
  PropertyListItem,
} from "@stripe/ui-extension-sdk/ui";
import { useEffect, useState } from "react";
import { deleteNote, getNote, updateNote } from "../../api/backend";
import { changesFrom } from "../../components/NoteCard";
import { NoteForm } from "../../components/NoteForm";
import { toNotesError, type NotesError } from "../../hooks/useNotes";
import { TeamProvider, useTeam } from "../../hooks/useTeam";
import {
  aboutLabel,
  dashboardRouteFor,
  formatDateTime,
  notificationText,
  objectPhrase,
  PRIORITY_BADGES,
  STATUS_BADGES,
} from "../../notes/display";
import {
  isValidNoteId,
  PRIORITY_LABELS,
  STATUS_LABELS,
  type Note,
  type UpdateNoteBody,
} from "../../types/notes";

type NoteDetailProps = {
  noteId: string;
  context: ExtensionContextValue;
};

type Loaded =
  | { state: "loading" }
  | { state: "missing" }
  | { state: "error"; error: NotesError }
  | { state: "ready"; note: Note };

type Mode = "reading" | "editing" | "deleting";

function NoteDetailPage({ noteId, context }: NoteDetailProps) {
  const { createAppRoute, navigateToAppRoute } = useNavigation();
  const { nameOf, me } = useTeam();

  const [fetched, setLoaded] = useState<Loaded>({ state: "loading" });
  // Not even shaped like an id: no need to ask the backend.
  const validId = isValidNoteId(noteId);
  const loaded: Loaded = validId ? fetched : { state: "missing" };
  const [mode, setMode] = useState<Mode>("reading");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<NotesError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!validId) return;
    let cancelled = false;
    getNote(context, noteId)
      .then((note) => {
        if (!cancelled) setLoaded(note ? { state: "ready", note } : { state: "missing" });
      })
      .catch((caught) => {
        if (!cancelled) setLoaded({ state: "error", error: toNotesError(caught) });
      });
    return () => {
      cancelled = true;
    };
  }, [context, noteId, validId]);

  const breadcrumbs = [
    { type: "link" as const, label: "Tasks", route: createAppRoute({ key: "home" }) },
  ];

  if (loaded.state === "loading") {
    return (
      <DetailPage
        title="Note"
        breadcrumbs={breadcrumbs}
        pending
        primaryColumn={<PageModule title="Note">{null}</PageModule>}
      />
    );
  }

  if (loaded.state === "missing" || loaded.state === "error") {
    const missing = loaded.state === "missing";
    return (
      <DetailPage
        title={missing ? "Note not found" : "Couldn't load the note"}
        breadcrumbs={breadcrumbs}
        primaryColumn={
          <PageModule title={missing ? "This note isn't here" : "Something went wrong"}>
            <Box css={{ stack: "y", gap: "medium" }}>
              <Box css={{ color: "secondary" }}>
                {missing
                  ? `It may have been deleted, or it was written in ${
                      context.environment.mode === "live" ? "test" : "live"
                    } mode: notes from one mode never show in the other.`
                  : loaded.error.message}
              </Box>
              {!missing && loaded.error.hint && (
                <Box css={{ font: "caption", color: "secondary" }}>{loaded.error.hint}</Box>
              )}
              <Box>
                <Button type="primary" href={createAppRoute({ key: "home" })}>
                  Back to the task queue
                </Button>
              </Box>
            </Box>
          </PageModule>
        }
      />
    );
  }

  const { note } = loaded;

  const save = async (changes: UpdateNoteBody): Promise<boolean> => {
    setBusy(true);
    setActionError(null);
    setNotice(null);
    try {
      const response = await updateNote(context, note.id, changes);
      setLoaded({ state: "ready", note: response.note });
      setNotice(notificationText(response.notification, nameOf(changes.assigneeId)));
      return true;
    } catch (caught) {
      setActionError(toNotesError(caught));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    setActionError(null);
    try {
      await deleteNote(context, note.id);
      navigateToAppRoute({ key: "home" });
    } catch (caught) {
      setActionError(toNotesError(caught));
      setMode("reading");
      setBusy(false);
    }
  };

  const assignee = note.assigneeId === me ? "You" : nameOf(note.assigneeId);

  return (
    <DetailPage
      title={note.isTask ? "Task" : "Note"}
      description={aboutLabel(note)}
      breadcrumbs={breadcrumbs}
      primaryColumn={
        <PageModule
          title={note.isTask ? "Task" : "Note"}
          extraActions={
            mode === "reading"
              ? [
                  { label: "Edit", onPress: () => setMode("editing"), disabled: busy },
                  {
                    label: "Delete",
                    type: "destructive",
                    onPress: () => setMode("deleting"),
                    disabled: busy,
                  },
                ]
              : undefined
          }
        >
          <Box css={{ stack: "y", gap: "medium" }}>
            {actionError && (
              <Banner
                type="critical"
                title="That didn't work"
                description={actionError.message}
                onDismiss={() => setActionError(null)}
              />
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
                  const saved = Object.keys(changes).length === 0 || (await save(changes));
                  if (saved) setMode("reading");
                  return saved;
                }}
              />
            ) : (
              <Box css={{ stack: "y", gap: "xsmall" }}>
                {note.body.split("\n").map((line, index) => (
                  <Box key={index}>{line || " "}</Box>
                ))}
              </Box>
            )}

            {notice && <Box css={{ font: "caption", color: "secondary" }}>{notice}</Box>}

            {mode === "reading" && (
              <Box css={{ stack: "x", gap: "small", wrap: "wrap" }}>
                {note.isTask ? (
                  <>
                    <Button
                      type="primary"
                      disabled={busy}
                      onPress={() =>
                        save({ status: note.status === "resolved" ? "open" : "resolved" })
                      }
                    >
                      {note.status === "resolved" ? "Reopen" : "Mark resolved"}
                    </Button>
                    {note.assigneeId !== me && me && (
                      <Button disabled={busy} onPress={() => save({ assigneeId: me })}>
                        Assign to me
                      </Button>
                    )}
                  </>
                ) : (
                  <Button disabled={busy} onPress={() => save({ isTask: true })}>
                    Make it a task
                  </Button>
                )}
              </Box>
            )}

            {mode === "deleting" && (
              <Box css={{ stack: "y", gap: "small" }}>
                <Inline css={{ fontWeight: "semibold" }}>
                  Delete this {note.isTask ? "task" : "note"}? This can’t be undone.
                </Inline>
                <Box css={{ stack: "x", gap: "small" }}>
                  <Button type="destructive" pending={busy} onPress={remove}>
                    Delete
                  </Button>
                  <Button disabled={busy} onPress={() => setMode("reading")}>
                    Keep it
                  </Button>
                </Box>
              </Box>
            )}
          </Box>
        </PageModule>
      }
      secondaryColumn={
        <PageModule title="Details">
          <PropertyList>
            {note.isTask && (
              <PropertyListItem
                label="Status"
                value={<Badge type={STATUS_BADGES[note.status]}>{STATUS_LABELS[note.status]}</Badge>}
              />
            )}
            {note.isTask && (
              <PropertyListItem
                label="Priority"
                value={
                  <Badge type={PRIORITY_BADGES[note.priority]}>{PRIORITY_LABELS[note.priority]}</Badge>
                }
              />
            )}
            {note.isTask && (
              <PropertyListItem
                label="Assigned to"
                value={note.assigneeId ? assignee : "Nobody yet"}
              />
            )}
            <PropertyListItem
              label="About"
              value={<Link href={dashboardRouteFor(note)}>Open the {objectPhrase(note)}</Link>}
            />
            {note.customerId && note.objectType !== "customer" && (
              <PropertyListItem
                label="Customer"
                value={
                  <Link
                    href={{ name: "customerDetails", params: { customerId: note.customerId } }}
                  >
                    {note.customerLabel ?? note.customerId}
                  </Link>
                }
              />
            )}
            <PropertyListItem
              label="Written by"
              value={note.createdBy ? nameOf(note.createdBy) : "Someone"}
            />
            <PropertyListItem label="Created" value={formatDateTime(note.createdAt)} />
            {note.updatedAt !== note.createdAt && (
              <PropertyListItem
                label="Last changed"
                value={`${formatDateTime(note.updatedAt)} by ${
                  note.updatedBy ? nameOf(note.updatedBy).replace(/^You$/, "you") : "someone"
                }`}
              />
            )}
            {note.resolvedAt && (
              <PropertyListItem label="Resolved" value={formatDateTime(note.resolvedAt)} />
            )}
          </PropertyList>
        </PageModule>
      }
    />
  );
}

export function NoteDetail(props: NoteDetailProps) {
  return (
    <TeamProvider context={props.context}>
      <NoteDetailPage {...props} />
    </TeamProvider>
  );
}
