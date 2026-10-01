import { bareTarget, formatAmount, noteObjectTypeFor } from "../api/stripeObjects";
import type { Note } from "../types/notes";
import {
  aboutLabel,
  dashboardRouteFor,
  excerpt,
  notificationText,
  objectPhrase,
} from "./display";

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
  assigneeId: null,
  createdBy: "usr_alice",
  updatedBy: "usr_alice",
  resolvedAt: null,
  createdAt: "2026-09-30T09:00:00.000Z",
  updatedAt: "2026-09-30T09:00:00.000Z",
  ...overrides,
});

describe("labels", () => {
  it("names the object and, when it adds something, the customer", () => {
    expect(aboutLabel(note())).toBe("Invoice ABC-0001 · Jane Doe");
    expect(aboutLabel(note({ customerLabel: null }))).toBe("Invoice ABC-0001");
    expect(aboutLabel(note({ objectType: "customer", objectId: "cus_123", objectLabel: "Jane Doe" }))).toBe(
      "Customer Jane Doe",
    );
  });

  it("falls back to the id when no label was saved", () => {
    expect(aboutLabel(note({ objectLabel: null, customerLabel: null }))).toBe("Invoice in_123");
    expect(objectPhrase(note({ objectType: "payment", objectId: "pi_1", objectLabel: null }))).toBe(
      "payment pi_1",
    );
  });

  it("shortens a long note to one line", () => {
    expect(excerpt("First line.\n\nSecond   line.")).toBe("First line. Second line.");
    const long = excerpt("word ".repeat(100), 20);
    expect(long.length).toBeLessThanOrEqual(20);
    expect(long.endsWith("…")).toBe(true);
  });
});

describe("dashboardRouteFor", () => {
  it("links each kind of object to its own Dashboard page", () => {
    expect(dashboardRouteFor({ objectType: "customer", objectId: "cus_1" })).toEqual({
      name: "customerDetails",
      params: { customerId: "cus_1" },
    });
    expect(dashboardRouteFor({ objectType: "invoice", objectId: "in_1" })).toEqual({
      name: "invoiceDetails",
      params: { invoiceId: "in_1" },
    });
    expect(dashboardRouteFor({ objectType: "payment", objectId: "pi_1" })).toEqual({
      name: "paymentDetails",
      params: { paymentId: "pi_1" },
    });
  });
});

describe("notificationText", () => {
  it("says what became of the assignment email, and nothing when there was none", () => {
    expect(notificationText("sent", "Bob")).toBe("Bob was told by email.");
    expect(notificationText("opted_out", "Bob")).toContain("switched off");
    expect(notificationText("no_email", "Bob")).toContain("No email address");
    expect(notificationText("failed", "Bob")).toContain("could not be sent");
    expect(notificationText("none", "Bob")).toBeNull();
    expect(notificationText(null, "Bob")).toBeNull();
  });
});

describe("the object a drawer is open on", () => {
  it("treats payment intents and charges alike as payments", () => {
    expect(noteObjectTypeFor("customer")).toBe("customer");
    expect(noteObjectTypeFor("invoice")).toBe("invoice");
    expect(noteObjectTypeFor("payment_intent")).toBe("payment");
    expect(noteObjectTypeFor("charge")).toBe("payment");
    expect(noteObjectTypeFor("product")).toBeNull();
  });

  it("formats Stripe amounts, including currencies without cents", () => {
    expect(formatAmount(2000, "usd")).toContain("20.00");
    expect(formatAmount(2000, "jpy")).toContain("2,000");
    expect(formatAmount(2000, "jpy")).not.toContain("20.00");
  });

  it("can file a note without having read the object", () => {
    expect(bareTarget("customer", "cus_1")).toMatchObject({ customerId: "cus_1", objectLabel: null });
    // Without the read, an invoice's customer is unknown.
    expect(bareTarget("invoice", "in_1")).toMatchObject({ customerId: null });
  });
});
