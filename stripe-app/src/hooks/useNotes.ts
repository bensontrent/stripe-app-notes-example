// hooks/useNotes.ts
//
// ============================================================================
//  useNotes — one list of notes and everything you can do to it
// ============================================================================
//
//   const notes = useNotes(context, { objectType: "customer", objectId });
//   notes.items            the notes, as the backend ordered them
//   notes.create(body)     add one (the paid action — may answer "denied")
//   notes.update(id, …)    change one, optimistically
//   notes.remove(id)       delete one
//   notes.reload()         fetch the list again
//
// The list is whatever `query` asks the backend for: the notes on one object
// (drawer views) or the task queue (full-page view). Changing `query` loads
// the new list; pass a memoised object, or one built from primitives with
// useMemo, so it only changes when a filter does.
//
// Updates are optimistic: applyNoteChanges() from src/types/notes.ts — the
// same function the backend uses — predicts the result, the PATCH goes out,
// and the backend's answer replaces the prediction. If the PATCH fails the
// note is put back as it was and the error is reported through `actionError`
// rather than thrown, so event handlers can call the actions without a
// try/catch.

import type { ExtensionContextValue } from "@stripe/ui-extension-sdk/context";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BackendConnectionError,
  createNote,
  deleteNote,
  listNotes,
  updateNote,
} from "../api/backend";
import {
  applyNoteChanges,
  validateUpdateNote,
  type AssignmentNotification,
  type CreateNoteBody,
  type Note,
  type NoteListQuery,
  type UpdateNoteBody,
} from "../types/notes";
import type { PaywallStatus } from "../types/paywall";

export type NotesError = {
  message: string;
  hint?: string;
};

export const toNotesError = (error: unknown): NotesError => ({
  message: error instanceof Error ? error.message : String(error),
  hint: error instanceof BackendConnectionError ? error.hint : undefined,
});

/** What became of a create(): saved, refused by the paywall, or failed. */
export type CreateOutcome =
  | { result: "created"; note: Note; notification: AssignmentNotification; status: PaywallStatus }
  | { result: "denied"; status: PaywallStatus }
  | { result: "failed" };

export type NotesState = {
  /** 'loading' until the first fetch answers; 'error' if it failed. */
  status: "loading" | "ready" | "error";
  /** Why the list couldn't be loaded. */
  error: NotesError | null;
  items: Note[];
  /** True when the backend has more notes than this page holds. */
  hasMore: boolean;
  /** Ids of notes with a change or a delete in flight. */
  busyIds: ReadonlySet<string>;
  /** True while a create() is in flight. */
  creating: boolean;
  /** Why the most recent action failed. Cleared when the next one starts. */
  actionError: NotesError | null;
  create: (body: CreateNoteBody) => Promise<CreateOutcome>;
  update: (id: string, changes: UpdateNoteBody) => Promise<AssignmentNotification | null>;
  remove: (id: string) => Promise<boolean>;
  reload: () => Promise<void>;
  clearActionError: () => void;
};

export function useNotes(
  context: ExtensionContextValue,
  /** Null = nothing to load yet (e.g. the view isn't open on an object). */
  query: NoteListQuery | null,
): NotesState {
  // Which query the list on screen answers, and whether that load worked.
  // While it isn't the current query, the list is loading.
  const [loaded, setLoaded] = useState<{ query: NoteListQuery; ok: boolean } | null>(null);
  const [error, setError] = useState<NotesError | null>(null);
  const [items, setItems] = useState<Note[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(new Set());
  const [creating, setCreating] = useState(false);
  const [actionError, setActionError] = useState<NotesError | null>(null);

  // Don't set state after the view has closed (a slow request may still
  // answer), and don't let an answer for an old query overwrite a newer one.
  const mounted = useRef(true);
  const latestLoad = useRef(0);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    if (!query) return;
    const loadId = ++latestLoad.current;
    try {
      const response = await listNotes(context, query);
      if (!mounted.current || loadId !== latestLoad.current) return;
      setItems(response.notes);
      setHasMore(response.hasMore);
      setError(null);
      setLoaded({ query, ok: true });
    } catch (caught) {
      if (!mounted.current || loadId !== latestLoad.current) return;
      setError(toNotesError(caught));
      setLoaded({ query, ok: false });
    }
  }, [context, query]);

  useEffect(() => {
    void load();
  }, [load]);

  const status: NotesState["status"] =
    !query || (loaded?.query === query && loaded.ok)
      ? "ready"
      : loaded?.query === query
        ? "error"
        : "loading";

  const setBusy = useCallback((id: string, busy: boolean) => {
    setBusyIds((previous) => {
      const next = new Set(previous);
      if (busy) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const create = useCallback(
    async (body: CreateNoteBody): Promise<CreateOutcome> => {
      setCreating(true);
      setActionError(null);
      try {
        const outcome = await createNote(context, body);
        if (!outcome.created) return { result: "denied", status: outcome.status };
        // Newest first, which is how the object lists are ordered. A list
        // with another order (the task queue) reloads instead.
        if (mounted.current) setItems((previous) => [outcome.note, ...previous]);
        return {
          result: "created",
          note: outcome.note,
          notification: outcome.notification,
          status: outcome.status,
        };
      } catch (caught) {
        if (mounted.current) setActionError(toNotesError(caught));
        return { result: "failed" };
      } finally {
        if (mounted.current) setCreating(false);
      }
    },
    [context],
  );

  const update = useCallback(
    async (id: string, changes: UpdateNoteBody): Promise<AssignmentNotification | null> => {
      const before = items.find((note) => note.id === id);
      if (!before) return null;

      // The same check the backend runs, so a bad change is explained
      // without a round trip.
      const validated = validateUpdateNote(changes);
      if (!validated.ok) {
        setActionError({ message: validated.error });
        return null;
      }

      setActionError(null);
      setBusy(id, true);
      const predicted = applyNoteChanges(before, validated.value, new Date().toISOString());
      setItems((previous) => previous.map((note) => (note.id === id ? predicted : note)));

      try {
        const response = await updateNote(context, id, validated.value);
        if (mounted.current) {
          setItems((previous) => previous.map((note) => (note.id === id ? response.note : note)));
        }
        return response.notification;
      } catch (caught) {
        if (mounted.current) {
          setItems((previous) => previous.map((note) => (note.id === id ? before : note)));
          setActionError(toNotesError(caught));
        }
        return null;
      } finally {
        if (mounted.current) setBusy(id, false);
      }
    },
    [context, items, setBusy],
  );

  const remove = useCallback(
    async (id: string): Promise<boolean> => {
      setActionError(null);
      setBusy(id, true);
      try {
        await deleteNote(context, id);
        if (mounted.current) setItems((previous) => previous.filter((note) => note.id !== id));
        return true;
      } catch (caught) {
        // Already gone (someone else deleted it): that is what was asked for.
        if (caught instanceof BackendConnectionError && caught.status === 404) {
          if (mounted.current) setItems((previous) => previous.filter((note) => note.id !== id));
          return true;
        }
        if (mounted.current) setActionError(toNotesError(caught));
        return false;
      } finally {
        if (mounted.current) setBusy(id, false);
      }
    },
    [context, setBusy],
  );

  const clearActionError = useCallback(() => setActionError(null), []);

  return useMemo<NotesState>(
    () => ({
      status,
      error,
      items,
      hasMore,
      busyIds,
      creating,
      actionError,
      create,
      update,
      remove,
      reload: load,
      clearActionError,
    }),
    [status, error, items, hasMore, busyIds, creating, actionError, create, update, remove, load, clearActionError],
  );
}
