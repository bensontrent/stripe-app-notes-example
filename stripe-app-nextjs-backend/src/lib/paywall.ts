// lib/paywall.ts
//
// ============================================================================
//  Paywall — the database and configuration half
// ============================================================================
//
// "May this Stripe account use the paid features?" is answered in two steps:
//
//   1. This file gathers the facts: the limits from the environment, the
//      account's trial (two columns on its account_settings row), and the
//      subscription that covers the account.
//   2. resolvePaywall() in src/types/paywall.ts (identical copy in the
//      Stripe App) turns the facts into a PaywallStatus.
//
// The routes under /api/stripe-app/paywall are thin wrappers around the
// functions exported here.
//
// Configuration (all optional, read on every request so a changed value
// needs no rebuild):
//
//   TRIAL_DAYS_LIMIT               days a trial lasts once started.
//                                  Default 90. 0 = no time limit.
//   TRIAL_COUNT_LIMIT              notes a trial includes (creating a note is
//                                  the paid feature). Default 100. 0 = no cap.
//   PAYWALL_ENFORCE_IN_TEST_MODE   'true' applies the paywall in test mode
//                                  too. For rehearsing the flow locally —
//                                  leave it unset in production, where test
//                                  mode is always free.
//
// Three things worth copying into your own app:
//
//   • THE BACKEND IS THE GATE. The Stripe App hides the feature when access
//     is denied, but a UI can be bypassed; the route that does the paid work
//     must check for itself. recordFeatureUse() is that check — call it at
//     the top of every route that does something worth paying for (see
//     POST /api/stripe-app/notes for the pattern).
//
//   • Counting is atomic. record_trial_usage() (setup.sql) checks the cap
//     and increments in one UPDATE, so two simultaneous requests can't both
//     take the last free use.
//
//   • The trial belongs to the Stripe account, the subscription to a user.
//     An account is covered when any of its members — users who logged in
//     from inside that account's Dashboard, see src/lib/stripe-app-session.ts
//     — has a subscription in good standing. One plan therefore covers every
//     Stripe account its owner works in. To sell per account instead, store
//     the acct_… id in the subscription's metadata at checkout and match on
//     it in findAccountSubscription().
// ============================================================================

import {
  CURRENT_STATUSES,
  customerColumn,
  pickCurrentSubscription,
  SUBSCRIPTION_COLUMNS,
  syncCustomerSubscriptions,
  type SubscriptionRow,
} from './billing';
import { planNameFor } from './plans';
import { getSupabase } from './supabase';
import {
  resolvePaywall,
  type PaywallInput,
  type PaywallLimits,
  type PaywallMode,
  type PaywallStatus,
  type PaywallSubscription,
  type StoredTrial,
} from '@/types/paywall';

// ---------------------------------------------------------------------------
//  Configuration
// ---------------------------------------------------------------------------

const DEFAULT_TRIAL_DAYS_LIMIT = 90;
const DEFAULT_TRIAL_COUNT_LIMIT = 100;

/** A limit from the environment: unset → the default, 0 → null (no limit). */
function readLimit(name: string, fallback: number): number | null {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;

  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(
      `[paywall] ${name} must be a whole number of 0 or more (0 switches the limit off), got "${raw}".`,
    );
  }
  return value === 0 ? null : value;
}

export type PaywallConfig = {
  limits: PaywallLimits;
  enforceInTestMode: boolean;
};

export function paywallConfig(): PaywallConfig {
  return {
    limits: {
      trialDaysLimit: readLimit('TRIAL_DAYS_LIMIT', DEFAULT_TRIAL_DAYS_LIMIT),
      trialCountLimit: readLimit('TRIAL_COUNT_LIMIT', DEFAULT_TRIAL_COUNT_LIMIT),
    },
    enforceInTestMode: process.env.PAYWALL_ENFORCE_IN_TEST_MODE === 'true',
  };
}

// ---------------------------------------------------------------------------
//  The facts
// ---------------------------------------------------------------------------

/** The account a paywall request is about, from the signed request. */
export type PaywallOwner = {
  /** acct_… — covered by the signature. */
  stripeAccountId: string;
  mode: PaywallMode;
};

// The trial lives on the account's account_settings row (setup.sql): the
// row may exist without a trial (settings were saved, the trial not yet
// started), in which case trial_started_at is NULL.
type TrialRow = { trial_started_at: string | null; trial_usage_count: number };

const TRIAL_COLUMNS = 'trial_started_at, trial_usage_count';

const toStoredTrial = (row: TrialRow | null): StoredTrial | null =>
  row?.trial_started_at
    ? { startedAt: row.trial_started_at, usageCount: row.trial_usage_count }
    : null;

async function loadTrial(owner: PaywallOwner): Promise<StoredTrial | null> {
  const { data, error } = await getSupabase()
    .from('account_settings')
    .select(TRIAL_COLUMNS)
    .eq('stripe_account_id', owner.stripeAccountId)
    .eq('livemode', owner.mode === 'live')
    .maybeSingle<TrialRow>();
  if (error) throw error;
  return toStoredTrial(data);
}

async function loadMemberIds(stripeAccountId: string): Promise<string[]> {
  const { data, error } = await getSupabase()
    .from('memberships')
    .select('user_id')
    .eq('stripe_account_id', stripeAccountId)
    .returns<Array<{ user_id: string }>>();
  if (error) throw error;
  return data.map((membership) => membership.user_id);
}

/**
 * The subscription that covers the account: the healthiest current
 * subscription of any of its members, in the same mode the app runs in
 * (live app → live subscriptions). Null when nobody has one.
 */
export async function findAccountSubscription(
  owner: PaywallOwner,
): Promise<PaywallSubscription | null> {
  const memberIds = await loadMemberIds(owner.stripeAccountId);
  if (memberIds.length === 0) return null;

  const { data, error } = await getSupabase()
    .from('subscriptions')
    .select(SUBSCRIPTION_COLUMNS)
    .in('user_id', memberIds)
    .eq('livemode', owner.mode === 'live')
    .in('status', CURRENT_STATUSES)
    .returns<SubscriptionRow[]>();
  if (error) throw error;

  const current = pickCurrentSubscription(data);
  if (!current) return null;

  return {
    status: current.status,
    planName: planNameFor(current.price_lookup_key),
    currentPeriodEnd: current.current_period_end,
    cancelAtPeriodEnd: current.cancel_at_period_end,
  };
}

/** Everything resolvePaywall() needs, for one account in one mode. */
async function loadPaywallInput(owner: PaywallOwner): Promise<PaywallInput> {
  const { limits, enforceInTestMode } = paywallConfig();

  // Test mode is free: answer without touching the database. (This also
  // means the paywall can't break the app for someone who is only testing.)
  if (owner.mode === 'test' && !enforceInTestMode) {
    return { mode: owner.mode, enforceInTestMode, limits, trial: null, subscription: null };
  }

  const [trial, subscription] = await Promise.all([
    loadTrial(owner),
    findAccountSubscription(owner),
  ]);
  return { mode: owner.mode, enforceInTestMode, limits, trial, subscription };
}

// ---------------------------------------------------------------------------
//  The operations (one per route)
// ---------------------------------------------------------------------------

/** GET /api/stripe-app/paywall — the account's current status. */
export async function loadPaywallStatus(owner: PaywallOwner): Promise<PaywallStatus> {
  return resolvePaywall(await loadPaywallInput(owner));
}

/**
 * POST /api/stripe-app/paywall/trial — start the account's free trial.
 * Idempotent: a trial that already exists is left exactly as it is.
 */
export async function startTrial(owner: PaywallOwner): Promise<PaywallStatus> {
  const input = await loadPaywallInput(owner);
  // Nothing to start where the paywall doesn't apply.
  if (owner.mode === 'test' && !input.enforceInTestMode) return resolvePaywall(input);

  const { data, error } = await getSupabase()
    .rpc('start_account_trial', {
      p_account_id: owner.stripeAccountId,
      p_livemode: owner.mode === 'live',
    })
    .single<TrialRow>();
  if (error) throw error;

  return resolvePaywall({ ...input, trial: toStoredTrial(data) });
}

export type FeatureUse = {
  /** True when the caller may go ahead with the paid work. */
  allowed: boolean;
  /** The status after this use was counted (or refused). */
  status: PaywallStatus;
};

/**
 * THE GATE. Call this at the top of any route that does paid work:
 *
 *   const use = await recordFeatureUse(owner);
 *   if (!use.allowed) return paymentRequired(use.status);   // HTTP 402
 *   // … do the work …
 *
 * It checks access and, during a trial, counts the use against the
 * allowance. Subscribers and test mode pass through uncounted.
 */
export async function recordFeatureUse(owner: PaywallOwner): Promise<FeatureUse> {
  const input = await loadPaywallInput(owner);
  const status = resolvePaywall(input);

  if (status.access === 'denied') return { allowed: false, status };
  if (status.reason !== 'trialing') return { allowed: true, status };

  const { data: usageCount, error } = await getSupabase().rpc('record_trial_usage', {
    p_account_id: owner.stripeAccountId,
    p_livemode: owner.mode === 'live',
    p_limit: input.limits.trialCountLimit,
  });
  if (error) throw error;

  // NULL = nothing was counted: another request took the last free use
  // between our read and the UPDATE. Re-read and refuse.
  if (usageCount === null) {
    return { allowed: false, status: await loadPaywallStatus(owner) };
  }

  return {
    allowed: true,
    status: resolvePaywall({
      ...input,
      trial: { startedAt: input.trial!.startedAt, usageCount: usageCount as number },
    }),
  };
}

// A Stripe account rarely has more than a handful of app users; the cap
// keeps one "Recheck" press from fanning out into unbounded Stripe calls.
const MAX_MEMBERS_TO_REFRESH = 20;

/**
 * POST /api/stripe-app/paywall/refresh — "Recheck my plan". Re-reads the
 * subscriptions of the account's members from Stripe, so a plan bought a
 * moment ago counts even if its webhook hasn't arrived (or isn't set up).
 */
export async function refreshPaywallStatus(owner: PaywallOwner): Promise<PaywallStatus> {
  // Nothing to recheck where the paywall doesn't apply.
  if (owner.mode === 'test' && !paywallConfig().enforceInTestMode) {
    return loadPaywallStatus(owner);
  }

  const memberIds = await loadMemberIds(owner.stripeAccountId);

  if (memberIds.length > 0) {
    const column = customerColumn(owner.mode);
    const { data: customers, error } = await getSupabase()
      .from('users')
      .select(`id, ${column}`)
      .in('id', memberIds)
      .not(column, 'is', null)
      .limit(MAX_MEMBERS_TO_REFRESH)
      .returns<Array<Record<string, string>>>();
    if (error) throw error;

    await Promise.all(
      customers.map((customer) =>
        syncCustomerSubscriptions(customer.id, customer[column], owner.mode),
      ),
    );
  }

  return loadPaywallStatus(owner);
}
