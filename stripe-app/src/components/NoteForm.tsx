// components/NoteForm.tsx
//
// The one form for a note: its text, whether it needs follow-up (which makes
// it a task), and a task's priority, status and assignee. Used to add a note
// (drawer), to edit one in place (drawer) and on the note's page in the
// full-page app — so the rules read the same everywhere:
//
//   • a plain note is just text
//   • "This needs follow-up" reveals the task fields
//   • the assignee list is the team: everyone who has opened the app in this
//     Stripe account (see src/hooks/useTeam.tsx)
//
// The form only collects values. Saving — and everything that can go wrong
// with it — belongs to whoever passes onSubmit.

import {
  Box,
  Button,
  Select,
  Switch,
  TextArea,
} from "@stripe/ui-extension-sdk/ui";
import { useState } from "react";
import { useTeam } from "../hooks/useTeam";
import {
  DEFAULT_PRIORITY,
  DEFAULT_STATUS,
  MAX_NOTE_LENGTH,
  memberLabel,
  NOTE_PRIORITIES,
  NOTE_STATUSES,
  PRIORITY_LABELS,
  STATUS_LABELS,
  type NotePriority,
  type NoteStatus,
} from "../types/notes";

export type NoteFormValues = {
  body: string;
  isTask: boolean;
  priority: NotePriority;
  status: NoteStatus;
  assigneeId: string | null;
};

export const EMPTY_NOTE_FORM: NoteFormValues = {
  body: "",
  isTask: false,
  priority: DEFAULT_PRIORITY,
  status: DEFAULT_STATUS,
  assigneeId: null,
};

export type NoteFormProps = {
  /** What the form starts with. Read once, when the form mounts. */
  initial?: NoteFormValues;
  submitLabel: string;
  /** Label while isTask is on, e.g. "Add task". Defaults to submitLabel. */
  submitTaskLabel?: string;
  /**
   * Save the values. Resolve true when saved (a form without onCancel then
   * clears itself for the next note) and false when not.
   */
  onSubmit: (values: NoteFormValues) => Promise<boolean>;
  /** Shows a Cancel button. */
  onCancel?: () => void;
  /** Status only makes sense for a note that already exists. */
  showStatus?: boolean;
  placeholder?: string;
};

export function NoteForm({
  initial = EMPTY_NOTE_FORM,
  submitLabel,
  submitTaskLabel,
  onSubmit,
  onCancel,
  showStatus = false,
  placeholder = "What happened, or what needs doing?",
}: NoteFormProps) {
  const { members, me } = useTeam();
  const [values, setValues] = useState<NoteFormValues>(initial);
  const [saving, setSaving] = useState(false);

  const set = (patch: Partial<NoteFormValues>) =>
    setValues((previous) => ({ ...previous, ...patch }));

  const text = values.body.trim();
  const tooLong = text.length > MAX_NOTE_LENGTH;

  // An assignee who is on the note but not (or no longer) in the loaded team
  // still needs an option, or the Select would silently show someone else.
  const assigneeKnown =
    !values.assigneeId || members.some((member) => member.id === values.assigneeId);

  const submit = async () => {
    if (text.length === 0 || tooLong || saving) return;
    setSaving(true);
    try {
      const saved = await onSubmit({ ...values, body: text });
      if (saved && !onCancel) setValues(EMPTY_NOTE_FORM);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Box css={{ stack: "y", gap: "medium" }}>
      <TextArea
        label="Note"
        hiddenElements={["label"]}
        placeholder={placeholder}
        rows={4}
        value={values.body}
        error={tooLong ? `A note can be at most ${MAX_NOTE_LENGTH} characters.` : undefined}
        onChange={(event) => set({ body: event.target.value })}
      />

      <Switch
        label="This needs follow-up"
        description="Makes it a task with a priority and an owner."
        checked={values.isTask}
        onChange={(event) => set({ isTask: event.target.checked })}
      />

      {values.isTask && (
        <Box css={{ stack: "y", gap: "small" }}>
          <Select
            label="Priority"
            value={values.priority}
            onChange={(event) => set({ priority: event.target.value as NotePriority })}
          >
            {NOTE_PRIORITIES.map((priority) => (
              <option key={priority} value={priority}>
                {PRIORITY_LABELS[priority]}
              </option>
            ))}
          </Select>

          {showStatus && (
            <Select
              label="Status"
              value={values.status}
              onChange={(event) => set({ status: event.target.value as NoteStatus })}
            >
              {NOTE_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {STATUS_LABELS[status]}
                </option>
              ))}
            </Select>
          )}

          <Select
            label="Assigned to"
            description="Teammates appear here once they have opened the app."
            value={values.assigneeId ?? ""}
            onChange={(event) => set({ assigneeId: event.target.value || null })}
          >
            <option value="">Nobody yet</option>
            {members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.id === me ? `${memberLabel(member, "Me")} (you)` : memberLabel(member)}
              </option>
            ))}
            {!assigneeKnown && values.assigneeId && (
              <option value={values.assigneeId}>A teammate</option>
            )}
          </Select>
        </Box>
      )}

      <Box css={{ stack: "x", gap: "small" }}>
        <Button
          type="primary"
          disabled={text.length === 0 || tooLong}
          pending={saving}
          onPress={submit}
        >
          {values.isTask ? submitTaskLabel ?? submitLabel : submitLabel}
        </Button>
        {onCancel && (
          <Button disabled={saving} onPress={onCancel}>
            Cancel
          </Button>
        )}
      </Box>
    </Box>
  );
}
