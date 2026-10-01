// lib/billing.ts
//
// ============================================================================
//  Billing — charging app users for the app itself
// ============================================================================
//
// Who pays whom: the people who install your Stripe App are YOUR customers.
// They subscribe on this backend's website (/billing), and the subscription
// lives in your own Stripe account — the "billing" account of
// src/lib/stripe.ts, which falls back to the app account when you use a
// single account for both. Nothing here touches the connected accounts the
// app is installed into.
//
// The moving parts, all Stripe-hosted so there is no card form to build:
//
//   Checkout        createCheckoutSession() → the user picks a plan on
//                   /billing and pays on a Stripe-hosted page
//   Customer portal createPortalSession() → change plan, update the card,
//                   cancel, download invoices
//   Sync            syncSubscription() copies a Stripe subscription into the
//                   `subscriptions` table. It runs from three places, so the
//                   table is right even when one of them is missing:
//                     1. the webhook (/api/webhooks/billing)
//                     2. every load of /billing (syncCustomerSubscriptions)
//                     3. "Recheck my plan" in the Stripe App
//
// Identity: a subscription belongs to a Better Auth user (`users`), whose
// Customer id is stored per mode in stripe_customer_id_live / _test. Which
// Stripe accounts that subscription covers is decided in src/lib/paywall.ts.
//
// Which mode the website bills in is BILLING_ENVIRONMENT ('test' unless set
// to 'live'). Test-mode subscriptions use Stripe's test cards (4242 4242
// 4242 4242) and never move money.
// ============================================================================

import type Stripe from 'stripe';
import { loadPlans, planNameFor, unavailablePlans, type Plan } from './plans';
import { getStripeClient, type BillingEnvironment } from './stripe';
import { getSupabase } from './supabase';
import type { SubscriptionStatus } from '@/types/paywall';

/** The mode the website's billing runs in. Anything but 'live' is test. */
export function billingEnvironment(): BillingEnvironment {
  return process.env.BILLING_ENVIRONMENT === 'live' ? 'live' : 'test';
}

/** The `users` column holding the Customer id for a mode. */
export function customerColumn(environment: BillingEnvironment) {
  return environment === 'live' ? 'stripe_customer_id_live' : 'stripe_customer_id_test';
}

/** The Better Auth user being billed. */
export type BillingUser = {
  id: string;
  email: string;
  name?: string | null;
};

/** A row of the `subscriptions` table (the columns this file reads). */
export type SubscriptionRow = {
  id: string;
  user_id: string;
  stripe_customer_id: string;
  livemode: boolean;
  status: SubscriptionStatus;
  price_id: string | null;
  price_lookup_key: string | null;
  cancel_at_period_end: boolean;
  current_period_end: string | null;
  cancel_at: string | null;
  created_at: string;
};

export const SUBSCRIPTION_COLUMNS =
  'id, user_id, stripe_customer_id, livemode, status, price_id, price_lookup_key, cancel_at_period_end, current_period_end, cancel_at, created_at';

// ---------------------------------------------------------------------------
//  Choosing the subscription that counts
// ---------------------------------------------------------------------------

// A customer can have several subscription rows over time (a cancelled one,
// then a new one). The one that decides access is the healthiest: a paid-up
// subscription beats a past-due one, which beats anything that has ended.
const STATUS_RANK: Partial<Record<SubscriptionStatus, number>> = {
  active: 3,
  trialing: 2,
  past_due: 1,
};

/** The statuses worth showing as "the current plan". */
export const CURRENT_STATUSES: SubscriptionStatus[] = ['active', 'trialing', 'past_due'];

/** The healthiest current subscription, newest first among equals; null if none. */
export function pickCurrentSubscription<T extends Pick<SubscriptionRow, 'status' | 'created_at'>>(
  rows: T[],
): T | null {
  const current = rows.filter((row) => STATUS_RANK[row.status] !== undefined);
  current.sort(
    (a, b) =>
      (STATUS_RANK[b.status] ?? 0) - (STATUS_RANK[a.status] ?? 0) ||
      b.created_at.localeCompare(a.created_at),
  );
  return current[0] ?? null;
}

// ---------------------------------------------------------------------------
//  Customers
// ---------------------------------------------------------------------------

/** The user's Customer id in this mode, or null before their first checkout. */
export async function getCustomerId(
  userId: string,
  environment: BillingEnvironment,
): Promise<string | null> {
  const column = customerColumn(environment);
  const { data, error } = await getSupabase()
    .from('users')
    .select(column)
    .eq('id', userId)
    .maybeSingle<Record<string, string | null>>();
  if (error) throw error;
  return data?.[column] ?? null;
}

/**
 * The user's Customer in the billing account, created on first use.
 *
 * The idempotency key makes the create safe to repeat: if two requests race
 * (a double-clicked "Subscribe"), Stripe returns the same Customer to both
 * instead of creating two.
 */
export async function getOrCreateCustomer(
  user: BillingUser,
  environment: BillingEnvironment,
): Promise<string> {
  const existing = await getCustomerId(user.id, environment);
  if (existing) return existing;

  const stripe = getStripeClient(environment, 'billing');
  const customer = await stripe.customers.create(
    {
      email: user.email,
      name: user.name ?? undefined,
      // Lets you find the app user from the Stripe Dashboard.
      metadata: { user_id: user.id },
    },
    { idempotencyKey: `customer-${environment}-${user.id}` },
  );

  const { error } = await getSupabase()
    .from('users')
    .update({ [customerColumn(environment)]: customer.id })
    .eq('id', user.id);
  if (error) throw error;

  return customer.id;
}

// ---------------------------------------------------------------------------
//  Sync: Stripe subscription → subscriptions table
// ---------------------------------------------------------------------------

// Stripe sends unix-second timestamps; Postgres wants ISO strings.
function toTimestamp(seconds: number | null | undefined): string | null {
  return seconds ? new Date(seconds * 1000).toISOString() : null;
}

function customerIdOf(subscription: Stripe.Subscription): string {
  return typeof subscription.customer === 'string'
    ? subscription.customer
    : subscription.customer.id;
}

/** The app user a Customer id belongs to, or null for a customer we don't know. */
async function findUserIdByCustomer(
  customerId: string,
  livemode: boolean,
): Promise<string | null> {
  const { data, error } = await getSupabase()
    .from('users')
    .select('id')
    .eq(customerColumn(livemode ? 'live' : 'test'), customerId)
    .maybeSingle<{ id: string }>();
  if (error) throw error;
  return data?.id ?? null;
}

/**
 * Copy one Stripe subscription into the `subscriptions` table (upsert on
 * the sub_… id). Returns false when the subscription's customer isn't one
 * of our users — e.g. a subscription created by hand in the Dashboard —
 * in which case nothing is written.
 *
 * Idempotent and order-independent enough for webhooks: every call writes
 * the full current state of the subscription it was handed.
 */
export async function syncSubscription(
  subscription: Stripe.Subscription,
  knownUserId?: string,
): Promise<boolean> {
  const customerId = customerIdOf(subscription);
  const userId =
    knownUserId ?? (await findUserIdByCustomer(customerId, subscription.livemode));
  if (!userId) return false;

  // This example sells one price per subscription; the first item is the plan.
  const item = subscription.items.data[0];

  const { error } = await getSupabase()
    .from('subscriptions')
    .upsert(
      {
        id: subscription.id,
        user_id: userId,
        stripe_customer_id: customerId,
        livemode: subscription.livemode,
        status: subscription.status,
        price_id: item?.price.id ?? null,
        price_lookup_key: item?.price.lookup_key ?? null,
        quantity: item?.quantity ?? null,
        cancel_at_period_end: subscription.cancel_at_period_end,
        current_period_start: toTimestamp(item?.current_period_start),
        current_period_end: toTimestamp(item?.current_period_end),
        ended_at: toTimestamp(subscription.ended_at),
        cancel_at: toTimestamp(subscription.cancel_at),
        canceled_at: toTimestamp(subscription.canceled_at),
        trial_start: toTimestamp(subscription.trial_start),
        trial_end: toTimestamp(subscription.trial_end),
        metadata: subscription.metadata,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'id' },
    );
  if (error) throw error;
  return true;
}

/**
 * Ask Stripe for the customer's subscriptions and sync every one. This is
 * what keeps the table right without a webhook (local development without
 * `stripe listen`, or a webhook that was down for an hour). Returns the
 * Stripe objects, payment method expanded, so the caller needn't ask again.
 */
export async function syncCustomerSubscriptions(
  userId: string,
  customerId: string,
  environment: BillingEnvironment,
): Promise<Stripe.Subscription[]> {
  const stripe = getStripeClient(environment, 'billing');
  const { data: subscriptions } = await stripe.subscriptions.list({
    customer: customerId,
    status: 'all',
    limit: 20,
    expand: ['data.default_payment_method'],
  });
  await Promise.all(
    subscriptions.map((subscription) => syncSubscription(subscription, userId)),
  );
  return subscriptions;
}

// ---------------------------------------------------------------------------
//  Checkout and the customer portal
// ---------------------------------------------------------------------------

export class BillingError extends Error {
  constructor(
    message: string,
    /** HTTP status the route should answer with. */
    readonly status: number,
  ) {
    super(message);
    this.name = 'BillingError';
  }
}

/**
 * Start a Stripe Checkout session for one plan and return its URL. The plan
 * is named by lookup key and resolved against the catalogue here, so the
 * browser can never ask to be charged for a price that isn't for sale.
 */
export async function createCheckoutSession(
  user: BillingUser,
  lookupKey: string,
  origin: string,
): Promise<string> {
  const environment = billingEnvironment();
  const stripe = getStripeClient(environment, 'billing');

  const plan = (await loadPlans(stripe)).find((candidate) => candidate.lookupKey === lookupKey);
  if (!plan) throw new BillingError(`Unknown plan "${lookupKey}"`, 400);
  if (!plan.priceId) {
    throw new BillingError(
      `No Stripe price has the lookup key "${lookupKey}" yet. Run \`npm run billing:seed\` ` +
        'or create the price in the Stripe Dashboard.',
      409,
    );
  }

  const customerId = await getOrCreateCustomer(user, environment);

  // One plan at a time: an existing subscription is changed in the portal,
  // not by buying a second one.
  const subscriptions = await syncCustomerSubscriptions(user.id, customerId, environment);
  if (subscriptions.some((subscription) => CURRENT_STATUSES.includes(subscription.status as SubscriptionStatus))) {
    throw new BillingError(
      'You already have a plan. Use "Manage plan" to change or cancel it.',
      409,
    );
  }

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    line_items: [{ price: plan.priceId, quantity: 1 }],
    // Copied onto the subscription, so it is searchable in the Dashboard.
    subscription_data: { metadata: { user_id: user.id } },
    success_url: `${origin}/billing?checkout=success`,
    cancel_url: `${origin}/billing?checkout=cancelled`,
  });
  if (!session.url) throw new BillingError('Stripe returned no checkout URL', 502);
  return session.url;
}

/**
 * Open the Stripe customer portal (change plan, payment method, cancel,
 * invoices) and return its URL.
 *
 * Stripe needs the portal configured once per mode before it will create
 * sessions: Dashboard → Settings → Billing → Customer portal → Save. Until
 * then Stripe answers with an error that says so; it is passed through.
 */
export async function createPortalSession(
  user: BillingUser,
  origin: string,
): Promise<string> {
  const environment = billingEnvironment();
  const customerId = await getCustomerId(user.id, environment);
  if (!customerId) {
    throw new BillingError('Nothing to manage yet — choose a plan first.', 409);
  }

  const session = await getStripeClient(environment, 'billing').billingPortal.sessions.create({
    customer: customerId,
    return_url: `${origin}/billing`,
  });
  return session.url;
}

// ---------------------------------------------------------------------------
//  The /billing page's data
// ---------------------------------------------------------------------------

export type PaymentMethodSummary = {
  /** 'card', 'us_bank_account', … */
  type: string;
  /** 'visa', 'mastercard', … for cards; the bank name for bank accounts. */
  label: string | null;
  last4: string | null;
  expMonth: number | null;
  expYear: number | null;
};

export type CurrentPlan = {
  subscriptionId: string;
  status: SubscriptionStatus;
  planName: string | null;
  priceLookupKey: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  /** Set when the plan is scheduled to end (cancelled, or a fixed end date). */
  cancelAt: string | null;
};

/** GET /api/protected/billing answers with this. */
export type BillingOverview = {
  environment: BillingEnvironment;
  plans: Plan[];
  currentPlan: CurrentPlan | null;
  paymentMethod: PaymentMethodSummary | null;
  /** The Stripe accounts this user's plan covers (their memberships). */
  coveredAccounts: { stripeAccountId: string; name: string | null }[];
  /** Set when Stripe couldn't be reached; the page shows it instead of failing. */
  notice: string | null;
};

function summarizePaymentMethod(
  paymentMethod: Stripe.PaymentMethod | string | null | undefined,
): PaymentMethodSummary | null {
  if (!paymentMethod || typeof paymentMethod === 'string') return null;
  if (paymentMethod.card) {
    return {
      type: 'card',
      label: paymentMethod.card.brand,
      last4: paymentMethod.card.last4,
      expMonth: paymentMethod.card.exp_month,
      expYear: paymentMethod.card.exp_year,
    };
  }
  if (paymentMethod.us_bank_account) {
    return {
      type: 'us_bank_account',
      label: paymentMethod.us_bank_account.bank_name,
      last4: paymentMethod.us_bank_account.last4,
      expMonth: null,
      expYear: null,
    };
  }
  return { type: paymentMethod.type, label: null, last4: null, expMonth: null, expYear: null };
}

async function loadCoveredAccounts(userId: string) {
  const { data, error } = await getSupabase()
    .from('memberships')
    .select('stripe_account_id, stripe_accounts ( name )')
    .eq('user_id', userId)
    .returns<Array<{ stripe_account_id: string; stripe_accounts: { name: string | null } | null }>>();
  if (error) throw error;
  return data.map((membership) => ({
    stripeAccountId: membership.stripe_account_id,
    name: membership.stripe_accounts?.name ?? null,
  }));
}

/**
 * Everything the /billing page shows. Syncs the user's subscriptions from
 * Stripe on the way, so the page (and the paywall) is current the moment
 * the user returns from Checkout — webhook or no webhook.
 *
 * Degrades instead of failing: with no Stripe key configured, the page
 * still renders the catalogue and says what is missing.
 */
export async function loadBillingOverview(user: BillingUser): Promise<BillingOverview> {
  const environment = billingEnvironment();
  const coveredAccounts = await loadCoveredAccounts(user.id);

  try {
    const stripe = getStripeClient(environment, 'billing');
    const customerId = await getCustomerId(user.id, environment);

    const [plans, subscriptions] = await Promise.all([
      loadPlans(stripe),
      customerId ? syncCustomerSubscriptions(user.id, customerId, environment) : [],
    ]);

    const current = pickCurrentSubscription(
      subscriptions.map((subscription) => ({
        subscription,
        status: subscription.status as SubscriptionStatus,
        created_at: new Date(subscription.created * 1000).toISOString(),
      })),
    )?.subscription;

    if (!current) {
      return { environment, plans, currentPlan: null, paymentMethod: null, coveredAccounts, notice: null };
    }

    const item = current.items.data[0];
    const lookupKey = item?.price.lookup_key ?? null;
    return {
      environment,
      plans,
      currentPlan: {
        subscriptionId: current.id,
        status: current.status as SubscriptionStatus,
        planName: planNameFor(lookupKey),
        priceLookupKey: lookupKey,
        currentPeriodEnd: toTimestamp(item?.current_period_end),
        cancelAtPeriodEnd: current.cancel_at_period_end,
        cancelAt: toTimestamp(current.cancel_at),
      },
      paymentMethod: summarizePaymentMethod(current.default_payment_method),
      coveredAccounts,
      notice: null,
    };
  } catch (error) {
    console.error('[billing] Could not load billing data from Stripe:', error);
    return {
      environment,
      plans: unavailablePlans(),
      currentPlan: null,
      paymentMethod: null,
      coveredAccounts,
      notice: error instanceof Error ? error.message : 'Stripe could not be reached.',
    };
  }
}
