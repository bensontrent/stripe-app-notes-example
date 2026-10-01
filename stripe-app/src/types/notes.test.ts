// Unit tests for the note model: what the backend accepts, and the rules
// that tie a task's fields together. The backend runs the same file, so
// these are the rules both sides live by.

import {
  applyNoteChanges,
  compareTasks,
  MAX_NOTE_LENGTH,
  memberLabel,
  validateCreateNote,
  validateUpdateNote,
  type Note,
} from "./notes";

const NOW = "2026-10-01T12:00:00.000Z";

const note = (overrides: Partial<Note> = {}): Note => ({
  id: "00000000-0000-4000-8000-000000000001",
  objectType: "invoice",
  objectId: "in_123",
  customerId: "cus_123",
  objectLabel: "ABC-0001",
  customerLabel: "Jane Doe",
  body: "Charged twice.",
  isTask: true,
  priority: "high",
  status: "open",
  assigneeId: "usr_bob",
  createdBy: "usr_alice",
  updatedBy: "usr_alice",
  resolvedAt: null,
  createdAt: "2026-09-30T09:00:00.000Z",
  updatedAt: "2026-09-30T09:00:00.000Z",
  ...overrides,
});

describe("validateCreateNote", () => {
  it("fills in the defaults of a plain note and trims its text", () => {
    expect(
      validateCreateNote({ objectType: "invoice", objectId: "in_123", body: "  Hello  " }),
    ).toEqual({
      ok: true,
      value: {
        objectType: "invoice",
        objectId: "in_123",
        customerId: null,
        objectLabel: null,
        customerLabel: null,
        body: "Hello",
        isTask: false,
        priority: "normal",
        assigneeId: null,
      },
    });
  });

  it("files a customer note under that customer, whatever customerId says", () => {
    const result = validateCreateNote({
      objectType: "customer",
      objectId: "cus_123",
      customerId: "cus_other",
      objectLabel: "Jane Doe",
      body: "x",
    });
    expect(result).toMatchObject({
      ok: true,
      value: { customerId: "cus_123", customerLabel: "Jane Doe" },
    });
  });

  it("keeps priority and assignee only on a task", () => {
    const fields = { objectType: "customer", objectId: "cus_1", body: "x", priority: "urgent", assigneeId: "usr_bob" };
    expect(validateCreateNote(fields)).toMatchObject({
      ok: true,
      value: { isTask: false, priority: "normal", assigneeId: null },
    });
    expect(validateCreateNote({ ...fields, isTask: true })).toMatchObject({
      ok: true,
      value: { isTask: true, priority: "urgent", assigneeId: "usr_bob" },
    });
  });

  it("accepts both kinds of payment id", () => {
    expect(validateCreateNote({ objectType: "payment", objectId: "pi_123", body: "x" }).ok).toBe(true);
    expect(validateCreateNote({ objectType: "payment", objectId: "ch_123", body: "x" }).ok).toBe(true);
  });

  it("rejects what it should", () => {
    const valid = { objectType: "invoice", objectId: "in_123", body: "x" };
    expect(validateCreateNote(null).ok).toBe(false);
    expect(validateCreateNote([]).ok).toBe(false);
    expect(validateCreateNote({ ...valid, objectType: "subscription" }).ok).toBe(false);
    // An id of another kind, or one that could smuggle a filter into a query.
    expect(validateCreateNote({ ...valid, objectId: "cus_123" }).ok).toBe(false);
    expect(validateCreateNote({ ...valid, objectId: "in_123,or(x)" }).ok).toBe(false);
    expect(validateCreateNote({ ...valid, customerId: "in_123" }).ok).toBe(false);
    expect(validateCreateNote({ ...valid, body: "   " }).ok).toBe(false);
    expect(validateCreateNote({ ...valid, body: "x".repeat(MAX_NOTE_LENGTH + 1) }).ok).toBe(false);
    expect(validateCreateNote({ ...valid, isTask: "yes" }).ok).toBe(false);
    expect(validateCreateNote({ ...valid, isTask: true, priority: "asap" }).ok).toBe(false);
    expect(validateCreateNote({ ...valid, isTask: true, assigneeId: "bob" }).ok).toBe(false);
  });

  it("cuts labels to a sane length instead of refusing the note", () => {
    const result = validateCreateNote({
      objectType: "invoice",
      objectId: "in_1",
      body: "x",
      objectLabel: "y".repeat(500),
    });
    expect(result.ok && result.value.objectLabel?.length).toBe(200);
  });
});

describe("validateUpdateNote", () => {
  it("keeps only the keys that were sent", () => {
    expect(validateUpdateNote({ status: "resolved" })).toEqual({
      ok: true,
      value: { status: "resolved" },
    });
    expect(validateUpdateNote({ assigneeId: null })).toEqual({
      ok: true,
      value: { assigneeId: null },
    });
  });

  it("rejects an empty change and bad values", () => {
    expect(validateUpdateNote({}).ok).toBe(false);
    expect(validateUpdateNote({ unknown: 1 }).ok).toBe(false);
    expect(validateUpdateNote({ status: "done" }).ok).toBe(false);
    expect(validateUpdateNote({ body: "" }).ok).toBe(false);
    expect(validateUpdateNote({ assigneeId: 42 }).ok).toBe(false);
  });
});

describe("applyNoteChanges", () => {
  it("stamps resolvedAt when a task is resolved and clears it when reopened", () => {
    const resolved = applyNoteChanges(note(), { status: "resolved" }, NOW);
    expect(resolved).toMatchObject({ status: "resolved", resolvedAt: NOW, updatedAt: NOW });

    const reopened = applyNoteChanges(resolved, { status: "in_progress" }, NOW);
    expect(reopened).toMatchObject({ status: "in_progress", resolvedAt: null });
  });

  it("keeps the original resolvedAt when a resolved task is edited", () => {
    const resolved = note({ status: "resolved", resolvedAt: "2026-09-30T10:00:00.000Z" });
    expect(applyNoteChanges(resolved, { body: "Edited." }, NOW).resolvedAt).toBe(
      "2026-09-30T10:00:00.000Z",
    );
  });

  it("drops the task fields when a task becomes a plain note", () => {
    expect(applyNoteChanges(note({ status: "resolved", resolvedAt: NOW }), { isTask: false }, NOW)).toMatchObject({
      isTask: false,
      priority: "normal",
      status: "open",
      assigneeId: null,
      resolvedAt: null,
    });
  });

  it("ignores task fields sent for a plain note", () => {
    const plain = note({ isTask: false, priority: "normal", assigneeId: null });
    expect(applyNoteChanges(plain, { priority: "urgent", assigneeId: "usr_bob" }, NOW)).toMatchObject({
      isTask: false,
      priority: "normal",
      assigneeId: null,
    });
  });

  it("can unassign without touching anything else", () => {
    expect(applyNoteChanges(note(), { assigneeId: null }, NOW)).toMatchObject({
      assigneeId: null,
      priority: "high",
      status: "open",
    });
  });
});

describe("compareTasks", () => {
  it("orders by priority, then oldest first", () => {
    const tasks = [
      note({ id: "low", priority: "low" }),
      note({ id: "urgent-new", priority: "urgent", createdAt: "2026-10-01T00:00:00.000Z" }),
      note({ id: "urgent-old", priority: "urgent", createdAt: "2026-09-01T00:00:00.000Z" }),
      note({ id: "normal", priority: "normal" }),
    ];
    expect(tasks.sort(compareTasks).map((task) => task.id)).toEqual([
      "urgent-old",
      "urgent-new",
      "normal",
      "low",
    ]);
  });
});

describe("memberLabel", () => {
  it("prefers the name, then the email, then a stand-in", () => {
    const member = { id: "usr_1", name: "Jane", email: "jane@example.com", lastSeenAt: NOW };
    expect(memberLabel(member)).toBe("Jane");
    expect(memberLabel({ ...member, name: null })).toBe("jane@example.com");
    expect(memberLabel({ ...member, name: " ", email: null })).toBe("A teammate");
    expect(memberLabel(undefined)).toBe("A teammate");
  });
});
