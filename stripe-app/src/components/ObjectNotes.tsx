// components/ObjectNotes.tsx
//
// ============================================================================
//  The notes drawer — what opens on a customer, invoice or payment page
// ============================================================================
//
// The three drawer views (src/views/CustomerNotes.tsx, InvoiceNotes.tsx,
// PaymentNotes.tsx) all render this. It reads which object the Dashboard is
// showing from `environment.objectContext` and shows:
//
//   1. the form to add a note — the paid feature, so it sits inside
//      <Paywall>: during a trial it shows what is left, and when the trial
//      has run out it shows how to subscribe instead
//   2. the notes already on the object, newest first. On a customer that
//      includes the notes written on the customer's invoices and payments.
//      The list is NOT behind the paywall: what was written stays readable
//      and editable.
//
// Three providers wrap the panel: the paywall status, the team (the check-in
// that makes this user assignable, and the names of everyone else), and the
// navigation context every view shares (see providers/withNavigation.tsx),
// which is what lets the drawer link to the task queue in the full-page app.

import type { ExtensionContextValue } from "@stripe/ui-extension-sdk/context";
import { useNavigation } from "@stripe/ui-extension-sdk/navigation";
import {
  Banner,
  Box,
  Button,
  ContextView,
  Divider,
  Inline,
  Spinner,
} from "@stripe/ui-extension-sdk/ui";
import { useMemo, useState } from "react";
import { docsPageUrl } from "../api/backend";
import type { NoteTarget } from "../api/stripeObjects";
import { useNotes } from "../hooks/useNotes";
import { useNoteTarget } from "../hooks/useNoteTarget";
import { PaywallProvider, usePaywall } from "../hooks/usePaywall";
import { TeamProvider, useTeam } from "../hooks/useTeam";
import { notificationText } from "../notes/display";
import { OBJECT_TYPE_LABELS, type NoteListQuery } from "../types/notes";
import BrandIcon from "../views/brand_icon.svg";
import { NoteCard } from "./NoteCard";
import { NoteForm, type NoteFormValues } from "./NoteForm";
import Paywall from "./Paywall";

export const BRAND_COLOR = "#334";

type PanelProps = {
  context: ExtensionContextValue;
  target: NoteTarget;
  /** 'failed' = the object couldn't be read from Stripe (see useNoteTarget). */
  lookup: "loading" | "ready" | "failed";
};

function NotesPanel({ context, target, lookup }: PanelProps) {
  const { applyStatus } = usePaywall();
  const { nameOf } = useTeam();
  const [notice, setNotice] = useState<string | null>(null);

  const query = useMemo<NoteListQuery>(
    () => ({ objectType: target.objectType, objectId: target.objectId }),
    [target.objectType, target.objectId],
  );
  const notes = useNotes(context, query);

  const addNote = async (values: NoteFormValues): Promise<boolean> => {
    setNotice(null);
    const outcome = await notes.create({
      objectType: target.objectType,
      objectId: target.objectId,
      customerId: target.customerId,
      objectLabel: target.objectLabel,
      customerLabel: target.customerLabel,
      body: values.body,
      isTask: values.isTask,
      priority: values.priority,
      assigneeId: values.assigneeId,
    });
    if (outcome.result === "failed") return false;

    // Either way the backend said where the trial stands now: the counter
    // moves on, or the paywall takes the form's place.
    applyStatus(outcome.status);
    if (outcome.result === "denied") return false;

    setNotice(notificationText(outcome.notification, nameOf(outcome.note.assigneeId)));
    return true;
  };

  const kind = OBJECT_TYPE_LABELS[target.objectType].toLowerCase();

  return (
    <Box css={{ stack: "y", gap: "large" }}>
      {lookup === "failed" && target.objectType !== "customer" && (
        <Banner
          type="caution"
          title={`Couldn't read this ${kind} from Stripe`}
          description={`You can still add notes here, but they won't appear on the customer's page.`}
        />
      )}

      <Paywall context={context} unit="note">
        <Box css={{ stack: "y", gap: "small" }}>
          <NoteForm
            key={target.objectId}
            submitLabel="Add note"
            submitTaskLabel="Add task"
            onSubmit={addNote}
          />
          {notice && <Box css={{ font: "caption", color: "secondary" }}>{notice}</Box>}
        </Box>
      </Paywall>

      {notes.actionError && (
        <Banner
          type="critical"
          title="That didn't work"
          description={notes.actionError.message}
          onDismiss={notes.clearActionError}
        />
      )}

      <Divider />

      <Box css={{ stack: "y", gap: "medium" }}>
        <Inline css={{ font: "heading" }}>
          {notes.status === "ready" ? `Notes (${notes.items.length}${notes.hasMore ? "+" : ""})` : "Notes"}
        </Inline>

        {notes.status === "loading" && <Spinner size="small" />}

        {notes.status === "error" && (
          <Box css={{ stack: "y", gap: "xsmall" }}>
            <Banner
              type="critical"
              title="Couldn't load the notes"
              description={notes.error?.message ?? "Unknown error"}
              actions={<Button onPress={notes.reload}>Try again</Button>}
            />
            {notes.error?.hint && (
              <Box css={{ font: "caption", color: "secondary" }}>{notes.error.hint}</Box>
            )}
          </Box>
        )}

        {notes.status === "ready" && notes.items.length === 0 && (
          <Box css={{ color: "secondary" }}>
            No notes on this {kind} yet.
            {target.objectType === "customer" &&
              " Notes on this customer’s invoices and payments will show up here too."}
          </Box>
        )}

        {notes.status === "ready" &&
          notes.items.map((note) => (
            <NoteCard
              key={note.id}
              note={note}
              showOrigin={note.objectId !== target.objectId}
              busy={notes.busyIds.has(note.id)}
              onUpdate={async (changes) => {
                setNotice(null);
                const notification = await notes.update(note.id, changes);
                if (notification === null) return false;
                setNotice(notificationText(notification, nameOf(changes.assigneeId)));
                return true;
              }}
              onDelete={() => notes.remove(note.id)}
            />
          ))}

        {notes.status === "ready" && notes.hasMore && (
          <Box css={{ font: "caption", color: "secondary" }}>
            Showing the {notes.items.length} most recent notes.
          </Box>
        )}
      </Box>
    </Box>
  );
}

/**
 * The drawer for the object the Dashboard is showing. Render it from a view
 * registered on a customer, invoice or payment detail viewport, wrapped in
 * withNavigation().
 */
export function ObjectNotes({ context }: { context: ExtensionContextValue }) {
  const { createAppRoute } = useNavigation();
  const { target, lookup } = useNoteTarget(context.environment.objectContext);

  const taskQueue = (
    <Button href={createAppRoute({ key: "home" })}>Open the task queue</Button>
  );
  const help = { label: "How notes and tasks work", href: docsPageUrl() };

  if (!target) {
    return (
      <ContextView
        title="Notes"
        brandColor={BRAND_COLOR}
        brandIcon={BrandIcon}
        actions={taskQueue}
        externalLink={help}
      >
        <Banner
          title="Open a customer, invoice or payment"
          description="Notes are attached to one of those. Open its page, then open this app again."
        />
      </ContextView>
    );
  }

  return (
    <ContextView
      title="Notes"
      description={target.objectLabel ?? undefined}
      brandColor={BRAND_COLOR}
      brandIcon={BrandIcon}
      actions={taskQueue}
      externalLink={help}
    >
      <PaywallProvider context={context}>
        <TeamProvider context={context}>
          <NotesPanel context={context} target={target} lookup={lookup} />
        </TeamProvider>
      </PaywallProvider>
    </ContextView>
  );
}
