// types/paywall.ts
//
// ============================================================================
//  Paywall — the single definition of "may this Stripe account use the app?"
// ============================================================================
//
// IDENTICAL copies of this file live in both projects:
//
//   stripe-app-nextjs-backend/src/types/paywall.ts   (decides, authoritatively)
//   stripe-app/src/types/paywall.ts                  (renders the decision)
//
// Keep them in sync — same arrangement as src/types/settings.ts. Nothing here
// imports anything, so the file compiles in both.
//
// The model, in one paragraph: access belongs to the STRIPE ACCOUNT, not to
// the person. An account may use the paid features when (a) the app runs in
// test mode — testing is always free, (b) someone in the account has an
// active subscription, or (c) the account's free trial is still running. The
// trial has two limits, both configured on the backend: TRIAL_DAYS_LIMIT
// (calendar days since the trial started) and TRIAL_COUNT_LIMIT (how many
// times the paid feature may be used — here: how many notes may be created).
// Whichever runs out first ends it. Only creating a note is gated; reading
// and changing existing notes always works.
//
// resolvePaywall() below is the whole decision. The backend calls it with
// what the database says and sends the result to the app; the app never
// decides for itself, it only renders `status.view`. (The function is shared
// so the app's demo can preview every state and so both sides can unit-test
// the same rules.)
//
// To change the rules — a grace period for past-due invoices, a trial that
// starts at install instead of on first use — change resolvePaywall() in
// both copies and its tests. Nothing else encodes them.
// ============================================================================

export type PaywallMode = 'live' | 'test';

/**
 * The two trial limits, as the backend read them from TRIAL_COUNT_LIMIT and
 * TRIAL_DAYS_LIMIT. `null` means that limit is switched off (the variable is
 * set to 0): a trial can be time-boxed only, usage-capped only, or both.
 */
export type PaywallLimits = {
  /** How many uses of the paid feature a trial includes, or null for no cap. */
  trialCountLimit: number | null;
  /** How many days a trial lasts once started, or null for no time limit. */
  trialDaysLimit: number | null;
};

/**
 * The trial as stored: two columns on the account's account_settings row
 * (trial_started_at, trial_usage_count). Null = the trial hasn't started.
 */
export type StoredTrial = {
  /** ISO timestamp the trial started at. */
  startedAt: string;
  /** Uses of the paid feature recorded so far. */
  usageCount: number;
};

/**
 * Stripe's subscription statuses. Only three matter to the decision:
 * 'active' and 'trialing' grant access, 'past_due' blocks it until the
 * invoice is paid. Everything else counts as "no subscription".
 */
export type SubscriptionStatus =
  | 'active'
  | 'trialing'
  | 'past_due'
  | 'canceled'
  | 'unpaid'
  | 'incomplete'
  | 'incomplete_expired'
  | 'paused';

/** The subscription that covers the account, as much as the app needs to show. */
export type PaywallSubscription = {
  status: SubscriptionStatus;
  /** Display name from the plan catalogue, or null for an unknown price. */
  planName: string | null;
  /** ISO timestamp the paid-for period ends (renewal or cancellation date). */
  currentPeriodEnd: string | null;
  /** True when the subscriber cancelled and the plan ends at currentPeriodEnd. */
  cancelAtPeriodEnd: boolean;
};

/**
 * Why access is granted or denied. One reason per outcome, so the UI can
 * explain itself without re-deriving anything.
 */
export type AccessReason =
  // granted
  | 'test_mode'
  | 'subscribed'
  | 'trialing'
  // denied
  | 'trial_not_started'
  | 'trial_expired'
  | 'trial_limit_reached'
  | 'payment_past_due';

/**
 * What the app should render in place of the paid feature:
 *
 *   content       the feature itself (access granted)
 *   intro         the trial terms, with a button that starts the trial
 *   trial-ended   the trial ran out; how to subscribe
 *   past-due      there is a subscription, but its invoice is unpaid
 */
export type PaywallView = 'content' | 'intro' | 'trial-ended' | 'past-due';

/** The trial as the UI shows it: the stored row plus everything derived from it. */
export type TrialStatus = {
  startedAt: string | null;
  /** startedAt + trialDaysLimit, or null (not started / no time limit). */
  expiresAt: string | null;
  /** Whole days left, rounded up; null when not started or no time limit. */
  daysRemaining: number | null;
  usageCount: number;
  /** Uses left; null when there is no usage cap. */
  usageRemaining: number | null;
};

/** GET /api/stripe-app/paywall (and every other paywall route) answers with this. */
export type PaywallStatus = {
  mode: PaywallMode;
  /** False when the paywall doesn't apply at all (test mode). */
  enforced: boolean;
  access: 'granted' | 'denied';
  reason: AccessReason;
  view: PaywallView;
  limits: PaywallLimits;
  trial: TrialStatus;
  subscription: PaywallSubscription | null;
};

export type PaywallInput = {
  mode: PaywallMode;
  /**
   * PAYWALL_ENFORCE_IN_TEST_MODE on the backend. Off by default; a developer
   * turns it on to walk through the paywall locally without going live.
   */
  enforceInTestMode?: boolean;
  limits: PaywallLimits;
  trial: StoredTrial | null;
  subscription: PaywallSubscription | null;
  /** Injectable for tests and previews; defaults to now. */
  now?: Date;
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const GRANTING_STATUSES: readonly SubscriptionStatus[] = ['active', 'trialing'];

const VIEW_FOR_REASON: Record<AccessReason, PaywallView> = {
  test_mode: 'content',
  subscribed: 'content',
  trialing: 'content',
  trial_not_started: 'intro',
  trial_expired: 'trial-ended',
  trial_limit_reached: 'trial-ended',
  payment_past_due: 'past-due',
};

/** The stored trial row plus its derived dates and remaining allowance. */
export function describeTrial(
  trial: StoredTrial | null,
  limits: PaywallLimits,
  now: Date = new Date(),
): TrialStatus {
  const usageCount = trial?.usageCount ?? 0;
  const usageRemaining =
    limits.trialCountLimit === null
      ? null
      : Math.max(0, limits.trialCountLimit - usageCount);

  if (!trial || limits.trialDaysLimit === null) {
    return {
      startedAt: trial?.startedAt ?? null,
      expiresAt: null,
      daysRemaining: null,
      usageCount,
      usageRemaining,
    };
  }

  const expiresAtMs =
    new Date(trial.startedAt).getTime() + limits.trialDaysLimit * MS_PER_DAY;
  // Clamped at both ends: never negative after the trial, and never more
  // than the limit — the row's timestamp comes from the database clock,
  // which may run a moment ahead of this machine's.
  const daysLeft = Math.ceil((expiresAtMs - now.getTime()) / MS_PER_DAY);
  return {
    startedAt: trial.startedAt,
    expiresAt: new Date(expiresAtMs).toISOString(),
    daysRemaining: Math.min(limits.trialDaysLimit, Math.max(0, daysLeft)),
    usageCount,
    usageRemaining,
  };
}

/** Why access is granted or denied. The order of the checks is the policy. */
function resolveReason(
  input: PaywallInput,
  trial: TrialStatus,
  now: Date,
): AccessReason {
  // 1. Test mode is free: nobody should pay to try the app on test data.
  if (input.mode === 'test' && !input.enforceInTestMode) return 'test_mode';

  // 2. A paid-up subscription always wins, whatever the trial says.
  const status = input.subscription?.status;
  if (status && GRANTING_STATUSES.includes(status)) return 'subscribed';

  // 3. An unpaid invoice blocks, even if trial allowance is left: the
  //    account chose a plan, so the trial is over.
  if (status === 'past_due') return 'payment_past_due';

  // 4. The trial. It starts when someone accepts the terms, not at install.
  if (!input.trial) return 'trial_not_started';
  if (trial.expiresAt !== null && now.getTime() >= new Date(trial.expiresAt).getTime()) {
    return 'trial_expired';
  }
  if (trial.usageRemaining !== null && trial.usageRemaining <= 0) {
    return 'trial_limit_reached';
  }
  return 'trialing';
}

/**
 * The paywall decision. Pure: same input, same answer — the backend feeds
 * it the database rows, tests and previews feed it whatever they like.
 */
export function resolvePaywall(input: PaywallInput): PaywallStatus {
  const now = input.now ?? new Date();
  const trial = describeTrial(input.trial, input.limits, now);
  const reason = resolveReason(input, trial, now);
  const view = VIEW_FOR_REASON[reason];

  return {
    mode: input.mode,
    enforced: reason !== 'test_mode',
    access: view === 'content' ? 'granted' : 'denied',
    reason,
    view,
    limits: input.limits,
    trial,
    subscription: input.subscription,
  };
}

/**
 * The gated route (POST /api/stripe-app/notes) answers 402 Payment Required
 * with this body when the account may not use the paid feature (any more).
 */
export type PaywallDeniedBody = {
  error: 'Payment required';
  message: string;
  status: PaywallStatus;
};

/** A sentence for each reason, for error messages and logs. */
export const REASON_MESSAGES: Record<AccessReason, string> = {
  test_mode: 'Test mode is free to use.',
  subscribed: 'The account has an active subscription.',
  trialing: 'The account is in its free trial.',
  trial_not_started: 'The free trial has not been started yet.',
  trial_expired: 'The free trial has ended.',
  trial_limit_reached: 'The free trial allowance has been used up.',
  payment_past_due: 'The subscription has an unpaid invoice.',
};
