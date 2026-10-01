// src/testing/fixtures.ts
//
// Made-up data shared by the view tests: a note, a team, and a paywall
// status computed the way the backend computes it.

import type { Note, TeamResponse } from "../types/notes";
import { resolvePaywall, type PaywallInput, type PaywallStatus } from "../types/paywall";

export const NOTE_ID = "11111111-1111-4111-8111-111111111111";
export const TASK_ID = "22222222-2222-4222-8222-222222222222";

export const makeNote = (overrides: Partial<Note> = {}): Note => ({
  id: NOTE_ID,
  objectType: "customer",
  objectId: "cus_123",
  customerId: "cus_123",
  objectLabel: "Jane Doe",
  customerLabel: "Jane Doe",
  body: "Called about a refund.",
  isTask: false,
  priority: "normal",
  status: "open",
  assigneeId: null,
  createdBy: "usr_alice",
  updatedBy: "usr_alice",
  resolvedAt: null,
  createdAt: "2026-09-30T09:00:00.000Z",
  updatedAt: "2026-09-30T09:00:00.000Z",
  ...overrides,
});

/** A task on one of the customer's invoices. */
export const makeTask = (overrides: Partial<Note> = {}): Note =>
  makeNote({
    id: TASK_ID,
    objectType: "invoice",
    objectId: "in_456",
    objectLabel: "ABC-0001",
    body: "Charged twice. Refund one.",
    isTask: true,
    priority: "urgent",
    assigneeId: "usr_bob",
    ...overrides,
  });

export const team = (me: string): TeamResponse => ({
  me,
  members: [
    { id: "usr_alice", name: "Alice Example", email: "alice@example.com", lastSeenAt: "2026-10-01T08:00:00.000Z" },
    { id: "usr_bob", name: "Bob Example", email: "bob@example.com", lastSeenAt: "2026-09-30T08:00:00.000Z" },
  ],
});

export const LIMITS = { trialDaysLimit: 90, trialCountLimit: 100 };

export const statusFor = (overrides: Partial<PaywallInput> = {}): PaywallStatus =>
  resolvePaywall({
    mode: "live",
    limits: LIMITS,
    trial: null,
    subscription: null,
    ...overrides,
  });

export const TEST_MODE = statusFor({ mode: "test" });

// Providers fetch in effects; let the mocked promises resolve before asserting.
export const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
