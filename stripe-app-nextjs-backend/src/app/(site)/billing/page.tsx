'use client';

// /billing — where an app user pays for the app.
//
// Three sections, all fed by one request to /api/protected/billing:
//
//   Plan details     the current plan, its status and renewal date, the
//                    payment method on file, and "Manage plan" (the Stripe
//                    customer portal: change plan, card, cancel, invoices)
//   Plans            the catalogue from src/config/plans.json with live
//                    prices; "Subscribe" goes to Stripe Checkout
//   Covered accounts the Stripe accounts this plan unlocks the app in
//
// The page never handles card data and never names a price: it sends a
// plan's lookup key to the backend and follows the URL it gets back. The
// Stripe App links here from its paywall (src/components/Paywall.tsx in the
// app) — after subscribing, the user presses "Recheck my plan" there.
//
// Arriving with ?subscribe_to=<lookup key> — the link behind "Subscribe" on
// the public /plans page — continues straight to Checkout for that plan, so
// a visitor who chose a plan before logging in doesn't have to choose again.
//
// Session auth: the proxy redirects signed-out visitors to /login and back
// (query string included, which is what carries subscribe_to through).

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import PlanCard from '@/components/PlanCard';
import { useSession } from '@/lib/auth-client';
import type { BillingOverview, CurrentPlan, PaymentMethodSummary } from '@/lib/billing';

const CARD = 'rounded-2xl border border-black/[.08] p-6 dark:border-white/[.145]';
const MUTED = 'text-sm text-zinc-600 dark:text-zinc-400';
const LABEL = 'text-xs font-medium uppercase tracking-wide text-zinc-500';
const PRIMARY_BUTTON =
  'inline-flex h-10 items-center justify-center rounded-full bg-[#635BFF] px-5 text-sm font-medium text-white transition-colors hover:bg-[#5348e8] disabled:cursor-not-allowed disabled:opacity-50';
const SECONDARY_BUTTON =
  'inline-flex h-10 items-center justify-center rounded-full border border-black/[.08] px-5 text-sm font-medium transition-colors hover:bg-black/[.04] disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/[.145] dark:hover:bg-white/[.06]';

// Badge tints paired light/dark so they stay readable on both themes.
const BADGES = {
  positive: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-400/10 dark:text-emerald-300',
  negative: 'bg-red-100 text-red-800 dark:bg-red-400/10 dark:text-red-300',
  info: 'bg-blue-100 text-blue-800 dark:bg-blue-400/10 dark:text-blue-300',
  warning: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-400/10 dark:text-yellow-300',
};

const STATUS_BADGES: Record<string, { label: string; tint: string }> = {
  active: { label: 'Active', tint: BADGES.positive },
  trialing: { label: 'Trialing', tint: BADGES.info },
  past_due: { label: 'Past due — please pay your invoice', tint: BADGES.negative },
};

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

/** POST to a billing route and follow the Stripe-hosted URL it answers with. */
async function redirectTo(path: string, body?: unknown): Promise<string | null> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await response.json().catch(() => ({}))) as {
    url?: string;
    message?: string;
    error?: string;
  };
  if (!response.ok || !data.url) {
    return data.message ?? data.error ?? 'Something went wrong. Please try again.';
  }
  window.location.assign(data.url);
  return null;
}

function Badge({ tint, children }: { tint: string; children: React.ReactNode }) {
  return (
    <span className={`inline-flex rounded-full px-3 py-1 text-sm ${tint}`}>{children}</span>
  );
}

/** The banner shown after returning from Stripe Checkout (?checkout=…). */
function CheckoutResult() {
  const result = useSearchParams()?.get('checkout') ?? null;
  if (result === 'success') {
    return (
      <p role="status" className={`rounded-2xl px-5 py-4 text-sm ${BADGES.positive}`}>
        You&apos;re subscribed. Go back to the app in your Stripe Dashboard and press
        &ldquo;Recheck my plan&rdquo;.
      </p>
    );
  }
  if (result === 'cancelled') {
    return (
      <p role="status" className={`rounded-2xl px-5 py-4 text-sm ${BADGES.warning}`}>
        Checkout was cancelled. You haven&apos;t been charged.
      </p>
    );
  }
  return null;
}

function PaymentMethod({ paymentMethod }: { paymentMethod: PaymentMethodSummary | null }) {
  if (!paymentMethod) {
    return <p className={MUTED}>No payment method on file.</p>;
  }
  return (
    <p className="text-sm text-black dark:text-zinc-50">
      <span className="capitalize">{paymentMethod.label ?? paymentMethod.type}</span>
      {paymentMethod.last4 && <> ending in {paymentMethod.last4}</>}
      {paymentMethod.expMonth && paymentMethod.expYear && (
        <span className="text-zinc-600 dark:text-zinc-400">
          {' '}
          · expires {String(paymentMethod.expMonth).padStart(2, '0')}/{paymentMethod.expYear}
        </span>
      )}
    </p>
  );
}

function PlanDetails({
  currentPlan,
  paymentMethod,
  busy,
  onManage,
}: {
  currentPlan: CurrentPlan | null;
  paymentMethod: PaymentMethodSummary | null;
  busy: boolean;
  onManage: () => void;
}) {
  if (!currentPlan) {
    return (
      <section aria-label="Plan details" className={CARD}>
        <h2 className="text-xl font-semibold text-black dark:text-zinc-50">Plan details</h2>
        <p className="mt-3 text-lg font-medium text-black dark:text-zinc-50">Free trial</p>
        <p className={`mt-1 ${MUTED}`}>
          You don&apos;t have a paid plan. Each Stripe account gets one free trial of the
          app; choose a plan below to keep using it after the trial ends.
        </p>
      </section>
    );
  }

  const status = STATUS_BADGES[currentPlan.status] ?? {
    label: currentPlan.status,
    tint: BADGES.info,
  };
  const endsOn = currentPlan.cancelAt ?? currentPlan.currentPeriodEnd;
  const isEnding = currentPlan.cancelAtPeriodEnd || currentPlan.cancelAt !== null;

  return (
    <section aria-label="Plan details" className={CARD}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-black dark:text-zinc-50">Plan details</h2>
          <p className="mt-3 text-lg font-medium text-black dark:text-zinc-50">
            {currentPlan.planName ?? 'Custom plan'}
          </p>
        </div>
        <Badge tint={status.tint}>{status.label}</Badge>
      </div>

      <dl className="mt-6 grid gap-6 border-t border-black/[.08] pt-6 sm:grid-cols-2 dark:border-white/[.145]">
        <div>
          <dt className={LABEL}>{isEnding ? 'Ends on' : 'Renews on'}</dt>
          <dd className="mt-1.5 text-sm text-black dark:text-zinc-50">
            {endsOn ? formatDate(endsOn) : '—'}
          </dd>
          {isEnding && (
            <dd className="mt-1 text-sm text-red-700 dark:text-red-300">
              Your plan is scheduled for cancellation. Undo it under &ldquo;Manage plan&rdquo;.
            </dd>
          )}
        </div>
        <div>
          <dt className={LABEL}>Payment method</dt>
          <dd className="mt-1.5">
            <PaymentMethod paymentMethod={paymentMethod} />
          </dd>
        </div>
      </dl>

      <div className="mt-6">
        <button onClick={onManage} disabled={busy} className={SECONDARY_BUTTON}>
          Manage plan
        </button>
        <p className={`mt-2 ${MUTED}`}>
          Change plan, update your payment method, cancel, or download invoices — on a
          page hosted by Stripe.
        </p>
      </div>
    </section>
  );
}

function BillingPage() {
  const { data: session, isPending } = useSession();
  const router = useRouter();
  const [overview, setOverview] = useState<BillingOverview | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    if (!isPending && !session) router.push('/login?redirect=/billing');
  }, [session, isPending, router]);

  // Both actions end in a redirect to Stripe; `busy` stays on until the
  // browser leaves, and is only cleared when the request failed.
  const run = useCallback(async (path: string, body?: unknown) => {
    setBusy(true);
    setActionError(null);
    const error = await redirectTo(path, body);
    if (error) {
      setActionError(error);
      setBusy(false);
    }
  }, []);

  // ?subscribe_to=<lookup key>: the plan chosen on the public /plans page.
  const subscribeTo = useSearchParams()?.get('subscribe_to') ?? null;
  const continued = useRef(false);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    fetch('/api/protected/billing')
      .then((response) => (response.ok ? response.json() : Promise.reject(response)))
      .then((data: BillingOverview) => {
        if (cancelled) return;
        setOverview(data);

        // Continue to Checkout for the plan chosen on /plans, once. Skipped
        // when the user already has a plan (changes go through "Manage
        // plan") or the key isn't a plan on offer — the page then simply
        // shows, and the server would refuse the checkout anyway.
        if (subscribeTo && !continued.current) {
          continued.current = true;
          const chosen = data.plans.find((plan) => plan.lookupKey === subscribeTo);
          if (chosen?.available && !data.currentPlan) {
            run('/api/protected/billing/checkout', { lookupKey: chosen.lookupKey });
          }
        }
      })
      .catch(() => {
        if (!cancelled) setLoadFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [session, subscribeTo, run]);

  if (loadFailed) {
    return (
      <main className="mx-auto w-full max-w-4xl px-6 py-24">
        <p role="alert" className={MUTED}>
          Couldn&apos;t load your billing details. Check the backend terminal for the error
          and reload the page.
        </p>
      </main>
    );
  }

  if (isPending || !session || !overview) {
    return (
      <main className="mx-auto flex w-full max-w-4xl items-center justify-center px-6 py-24">
        <p className={MUTED}>Loading…</p>
      </main>
    );
  }

  const { currentPlan } = overview;

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-10 px-6 py-12">
      <div>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-semibold tracking-tight text-black dark:text-zinc-50">
            Billing
          </h1>
          {overview.environment === 'test' && (
            <Badge tint={BADGES.warning}>Test mode — no real charges</Badge>
          )}
        </div>
        <p className={`mt-2 ${MUTED}`}>Your plan, payment method and the plans on offer.</p>
      </div>

      <CheckoutResult />

      {overview.notice && (
        <p role="alert" className={`rounded-2xl px-5 py-4 text-sm ${BADGES.warning}`}>
          Stripe isn&apos;t connected, so plans can&apos;t be bought yet: {overview.notice}
        </p>
      )}
      {actionError && (
        <p role="alert" className={`rounded-2xl px-5 py-4 text-sm ${BADGES.negative}`}>
          {actionError}
        </p>
      )}

      <PlanDetails
        currentPlan={currentPlan}
        paymentMethod={overview.paymentMethod}
        busy={busy}
        onManage={() => run('/api/protected/billing/portal')}
      />

      <section aria-label="Plans">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-xl font-semibold text-black dark:text-zinc-50">Plans</h2>
          <Link href="/plans" className="text-sm font-medium text-[#635BFF] hover:underline">
            Public price list
          </Link>
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          {overview.plans.map((plan) => (
            <PlanCard
              key={plan.lookupKey}
              plan={plan}
              badge={
                currentPlan?.priceLookupKey === plan.lookupKey && (
                  <Badge tint={BADGES.positive}>Your plan</Badge>
                )
              }
            >
              {/* With a plan already, changes go through the portal (one
                  subscription per user), so only offer Subscribe without one. */}
              {!currentPlan && (
                <button
                  onClick={() =>
                    run('/api/protected/billing/checkout', { lookupKey: plan.lookupKey })
                  }
                  disabled={busy}
                  className={PRIMARY_BUTTON}
                >
                  Subscribe
                </button>
              )}
            </PlanCard>
          ))}
        </div>
      </section>

      <section aria-label="Covered Stripe accounts">
        <h2 className="text-xl font-semibold text-black dark:text-zinc-50">
          Covered Stripe accounts
        </h2>
        <p className={`mt-2 ${MUTED}`}>
          One plan covers the app in every Stripe account you have logged in from.
        </p>
        {overview.coveredAccounts.length === 0 ? (
          <p className={`mt-4 ${MUTED}`}>
            None yet. Open the app in your Stripe Dashboard and log in there to link an
            account.
          </p>
        ) : (
          <ul className="mt-4 space-y-2">
            {overview.coveredAccounts.map((account) => (
              <li
                key={account.stripeAccountId}
                className="rounded-2xl border border-black/[.08] px-5 py-3 text-sm text-black dark:border-white/[.145] dark:text-zinc-50"
              >
                {account.name ? `${account.name}: ` : ''}
                <span className="font-mono">{account.stripeAccountId}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

// useSearchParams (in BillingPage and CheckoutResult) needs a Suspense boundary above it for
// the page to prerender; wrapping the whole page keeps that in one place.
export default function Page() {
  return (
    <Suspense fallback={null}>
      <BillingPage />
    </Suspense>
  );
}
