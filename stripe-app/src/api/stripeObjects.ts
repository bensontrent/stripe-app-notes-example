// src/api/stripeObjects.ts
//
// ============================================================================
//  What is this note about? — reading the object the drawer is open on
// ============================================================================
//
// The Dashboard tells a drawer view which object it is open on
// (`environment.objectContext`: an id and a type). To file a note properly
// the app needs two more things, which it reads from the Stripe API through
// the Dashboard session (no API key — see createHttpClient):
//
//   • the CUSTOMER the object belongs to, so a note on an invoice or a
//     payment also shows up on that customer's page
//   • a LABEL for lists and emails ("ABC-0001", "$20.00", "Jane Doe")
//
// These reads are what the app's permissions are for (stripe-app.json):
// customer_read, invoice_read, payment_intent_read, charge_read. Nothing is
// ever written to Stripe.
//
// The backend never reads the installing account's Stripe data; it stores
// the labels the app sends with the note. That keeps the backend free of
// per-account Stripe credentials, at the price that a label is a snapshot:
// renaming a customer later doesn't rename old notes.
// ============================================================================

import {
  createHttpClient,
  STRIPE_API_KEY,
} from "@stripe/ui-extension-sdk/http_client";
import Stripe from "stripe";
import type { NoteObjectType } from "../types/notes";

const stripe = new Stripe(STRIPE_API_KEY, {
  httpClient: createHttpClient(),
});

/** Everything about the current object that a new note is filed under. */
export type NoteTarget = {
  objectType: NoteObjectType;
  objectId: string;
  /** The customer it belongs to, when there is one and it could be read. */
  customerId: string | null;
  objectLabel: string | null;
  customerLabel: string | null;
};

/**
 * Which kind of note target a Dashboard object is. The payment page is
 * about a PaymentIntent, or about a bare Charge for payments made without
 * one; both are a "payment" here.
 */
export function noteObjectTypeFor(dashboardObject: string): NoteObjectType | null {
  switch (dashboardObject) {
    case "customer":
      return "customer";
    case "invoice":
      return "invoice";
    case "payment_intent":
    case "charge":
      return "payment";
    default:
      return null;
  }
}

// Currencies whose amounts Stripe gives in whole units rather than cents.
const ZERO_DECIMAL_CURRENCIES = new Set([
  "bif", "clp", "djf", "gnf", "jpy", "kmf", "krw", "mga", "pyg", "rwf",
  "ugx", "vnd", "vuv", "xaf", "xof", "xpf",
]);

/** "$20.00" from Stripe's (2000, "usd"). */
export function formatAmount(amount: number, currency: string): string {
  const code = currency.toLowerCase();
  const value = ZERO_DECIMAL_CURRENCIES.has(code) ? amount : amount / 100;
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: code.toUpperCase(),
    }).format(value);
  } catch {
    // A currency code Intl doesn't know (some stablecoins, say).
    return `${value} ${code.toUpperCase()}`;
  }
}

type CustomerRef = string | Stripe.Customer | Stripe.DeletedCustomer | null;

const customerIdOf = (customer: CustomerRef): string | null =>
  typeof customer === "string" ? customer : customer?.id ?? null;

/** A name for a customer: their name, else their email. */
function customerLabelOf(customer: CustomerRef): string | null {
  if (!customer || typeof customer === "string" || customer.deleted) return null;
  return customer.name || customer.email || null;
}

/**
 * Read the object from Stripe and describe it. Throws when the read fails
 * (the permission wasn't granted, the object is gone); the caller falls back
 * to bareTarget() so a note can still be written.
 */
export async function describeNoteTarget(
  dashboardObject: string,
  objectId: string,
): Promise<NoteTarget> {
  switch (dashboardObject) {
    case "customer": {
      const customer = await stripe.customers.retrieve(objectId);
      const label = customerLabelOf(customer);
      return {
        objectType: "customer",
        objectId,
        customerId: objectId,
        objectLabel: label,
        customerLabel: label,
      };
    }

    case "invoice": {
      const invoice = await stripe.invoices.retrieve(objectId);
      return {
        objectType: "invoice",
        objectId,
        customerId: customerIdOf(invoice.customer),
        objectLabel: invoice.number ?? null,
        customerLabel: invoice.customer_name || invoice.customer_email || null,
      };
    }

    case "payment_intent": {
      const intent = await stripe.paymentIntents.retrieve(objectId, {
        expand: ["customer"],
      });
      return {
        objectType: "payment",
        objectId,
        customerId: customerIdOf(intent.customer),
        objectLabel: formatAmount(intent.amount, intent.currency),
        customerLabel: customerLabelOf(intent.customer),
      };
    }

    case "charge": {
      const charge = await stripe.charges.retrieve(objectId, {
        expand: ["customer"],
      });
      return {
        objectType: "payment",
        objectId,
        customerId: customerIdOf(charge.customer),
        objectLabel: formatAmount(charge.amount, charge.currency),
        customerLabel:
          customerLabelOf(charge.customer) ||
          charge.billing_details?.name ||
          charge.billing_details?.email ||
          null,
      };
    }

    default:
      throw new Error(`Notes are not available on a ${dashboardObject}`);
  }
}

/**
 * The target when Stripe couldn't be asked: enough to save a note on the
 * object itself, without labels — and, for an invoice or payment, without
 * the link to its customer.
 */
export function bareTarget(objectType: NoteObjectType, objectId: string): NoteTarget {
  return {
    objectType,
    objectId,
    customerId: objectType === "customer" ? objectId : null,
    objectLabel: null,
    customerLabel: null,
  };
}
