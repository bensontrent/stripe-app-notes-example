// lib/plans.ts
//
// ============================================================================
//  The plan catalogue — what the app sells
// ============================================================================
//
// The plans are PLACEHOLDER DATA: one made-up plan in
// src/config/plans.json. Replace it with your own — that JSON file is the
// one place to edit. (It is JSON rather than TypeScript so that
// scripts/seed-plans.mjs, a plain Node script, reads the same file.)
//
// Plans are tied to Stripe by LOOKUP KEY, not by price id:
//
//   • A price id (price_1Abc…) is different in test mode, in live mode and
//     in every Stripe account, so hard-coding ids means one set of constants
//     per environment and a redeploy to change a price.
//   • A lookup key (notetaskerator_pro_monthly) is a name you choose and
//     attach to a price. The same key works in every mode and account, and
//     Stripe lets you move it to a new price when you change what a plan
//     costs — no code change.
//
// Getting real prices behind the catalogue, either way:
//
//   npm run billing:seed          creates a Product + Price per plan in your
//                                 TEST billing account, tagged with the
//                                 lookup keys from plans.json
//   …or by hand                   create the prices in the Stripe Dashboard
//                                 and give each one a lookup key, then put
//                                 those keys in plans.json
//
// Until a plan's price exists in Stripe the billing page still lists the
// plan (with the amount from plans.json) but marks it unavailable, so the
// page works on a fresh checkout.
// ============================================================================

import type Stripe from 'stripe';
import planCatalog from '@/config/plans.json';

export type BillingInterval = 'month' | 'year';

/** One entry of src/config/plans.json. */
export type PlanDefinition = {
  /** The Stripe price's lookup key. Unique per plan; never reuse one. */
  lookupKey: string;
  name: string;
  description: string;
  features: string[];
  /** Price in the currency's smallest unit (cents). Used for seeding and as the display fallback. */
  unitAmount: number;
  currency: string;
  interval: BillingInterval;
  /** Marks the plan the billing page should draw attention to. */
  highlighted?: boolean;
};

/** A plan as the billing page shows it: the definition plus what Stripe says. */
export type Plan = PlanDefinition & {
  /** The Stripe price behind the plan, or null when it hasn't been created yet. */
  priceId: string | null;
  /** False until the price exists in Stripe — the plan can't be bought yet. */
  available: boolean;
};

export const PLAN_DEFINITIONS = planCatalog as PlanDefinition[];

export function findPlanDefinition(
  lookupKey: string | null | undefined,
): PlanDefinition | undefined {
  return PLAN_DEFINITIONS.find((plan) => plan.lookupKey === lookupKey);
}

/** Display name for a stored subscription's plan, or null for an unknown price. */
export function planNameFor(lookupKey: string | null | undefined): string | null {
  return findPlanDefinition(lookupKey)?.name ?? null;
}

/**
 * The catalogue joined with Stripe: one prices.list call resolves every
 * lookup key. Amount, currency and interval come from the Stripe price when
 * it exists (Stripe is the truth for what is charged); the JSON values are
 * only the fallback for plans that aren't in Stripe yet.
 */
export async function loadPlans(stripe: Stripe): Promise<Plan[]> {
  const prices = await stripe.prices.list({
    lookup_keys: PLAN_DEFINITIONS.map((plan) => plan.lookupKey),
    active: true,
    limit: 100,
  });
  const byLookupKey = new Map(prices.data.map((price) => [price.lookup_key, price]));

  return PLAN_DEFINITIONS.map((definition) => {
    const price = byLookupKey.get(definition.lookupKey);
    if (!price) return { ...definition, priceId: null, available: false };
    return {
      ...definition,
      unitAmount: price.unit_amount ?? definition.unitAmount,
      currency: price.currency,
      interval: price.recurring?.interval === 'year' ? 'year' : 'month',
      priceId: price.id,
      available: true,
    };
  });
}

/** The catalogue without Stripe — what the page shows when Stripe can't be reached. */
export function unavailablePlans(): Plan[] {
  return PLAN_DEFINITIONS.map((definition) => ({
    ...definition,
    priceId: null,
    available: false,
  }));
}
