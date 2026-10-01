// /plans — the public price list. No login.
//
// This is the page to link to from anywhere a price is a question: the
// Stripe App's paywall ("See plans"), your Marketplace listing, an email.
// It is listed in PUBLIC_ROUTES (src/proxy.ts), so the proxy lets everyone
// through, and it reads nothing about the visitor.
//
// What it shows comes from the same two places as the billing page: the
// catalogue in src/config/plans.json, with amounts from the Stripe prices
// that carry each plan's lookup key (src/lib/plans.ts).
//
// Buying still needs an account, because a subscription has to belong to
// someone. "Subscribe" therefore links to /billing?subscribe_to=<lookup key>:
// the proxy sends a signed-out visitor through /login (or /register) and
// back, and the billing page continues to Stripe Checkout for that plan.
//
// A server component: the Stripe call happens here, on the server, and the
// browser receives plain HTML. Rendered per request (force-dynamic) rather
// than at build time, so `next build` never needs a Stripe key and a price
// changed in Stripe shows up on the next page load. If you have real
// traffic, swap that line for `export const revalidate = 300` to cache the
// page for five minutes.

import type { Metadata } from 'next';
import Link from 'next/link';
import PlanCard from '@/components/PlanCard';
import { billingEnvironment } from '@/lib/billing';
import { paywallConfig } from '@/lib/paywall';
import { loadPlans, unavailablePlans, type Plan } from '@/lib/plans';
import { getStripeClient } from '@/lib/stripe';
import type { PaywallLimits } from '@/types/paywall';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Plans and pricing',
  description: 'Start with a free trial, then choose the plan that fits.',
};

const PRIMARY_LINK =
  'inline-flex h-10 items-center justify-center rounded-full bg-[#635BFF] px-5 text-sm font-medium text-white transition-colors hover:bg-[#5348e8]';

/** The catalogue with live prices, or without them when Stripe can't be reached. */
async function loadPublicPlans(): Promise<Plan[]> {
  try {
    return await loadPlans(getStripeClient(billingEnvironment(), 'billing'));
  } catch (error) {
    // No Stripe key yet (a fresh checkout) or Stripe is down: the page still
    // renders, with the amounts from plans.json and nothing buyable.
    console.error('[plans] Could not load prices from Stripe:', error);
    return unavailablePlans();
  }
}

/** The free trial in one sentence, from the same limits the paywall enforces. */
function trialSummary(limits: PaywallLimits): string {
  const { trialDaysLimit: days, trialCountLimit: count } = limits;
  const length = days === null ? null : `${days} ${days === 1 ? 'day' : 'days'}`;
  const allowance = count === null ? null : `${count} ${count === 1 ? 'note' : 'notes'}`;

  if (length && allowance) {
    return `Every Stripe account starts with a free trial: ${length} or ${allowance}, whichever comes first.`;
  }
  if (length) return `Every Stripe account starts with a free ${length} trial.`;
  if (allowance) return `Every Stripe account starts with ${allowance} free.`;
  return 'Every Stripe account starts with a free trial.';
}

/** The limits for display. A misconfigured limit must not take the price list down. */
function trialLimits(): PaywallLimits | null {
  try {
    return paywallConfig().limits;
  } catch (error) {
    console.error('[plans] Could not read the trial limits:', error);
    return null;
  }
}

export default async function PlansPage() {
  const plans = await loadPublicPlans();
  const limits = trialLimits();

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-10 px-6 py-12">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight text-black dark:text-zinc-50">
          Plans and pricing
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-zinc-600 dark:text-zinc-400">
          {limits ? trialSummary(limits) : 'Every Stripe account starts with a free trial.'}{' '}
          No payment details are needed to start, and test mode is always free.
        </p>
      </div>

      <section aria-label="Plans" className="grid gap-4 md:grid-cols-3">
        {plans.map((plan) => (
          <PlanCard key={plan.lookupKey} plan={plan}>
            <Link
              href={`/billing?subscribe_to=${encodeURIComponent(plan.lookupKey)}`}
              className={PRIMARY_LINK}
            >
              Subscribe
            </Link>
          </PlanCard>
        ))}
      </section>

      <section
        aria-label="How billing works"
        className="rounded-2xl border border-black/[.08] p-6 dark:border-white/[.145]"
      >
        <h2 className="text-xl font-semibold text-black dark:text-zinc-50">
          How billing works
        </h2>
        <ul className="mt-4 list-disc space-y-2 pl-5 text-sm text-zinc-600 dark:text-zinc-400">
          <li>
            One plan covers the app in every Stripe account you log in from. You don&apos;t
            need a plan per account.
          </li>
          <li>The free trial is shared by everyone who uses the app in a Stripe account.</li>
          <li>
            Payment is handled by Stripe. You can change plan, update your card or cancel
            at any time from your{' '}
            <Link href="/billing" className="font-medium text-[#635BFF] hover:underline">
              billing page
            </Link>
            .
          </li>
        </ul>
      </section>
    </main>
  );
}
