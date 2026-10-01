// One plan from the catalogue (src/config/plans.json), as a card.
//
// Shared by the two pages that list plans:
//
//   /plans     public — anyone can read the prices; the action is a link
//              that leads through login to checkout
//   /billing   signed-in — the action is a button that starts checkout
//
// The card renders the plan; the page decides what can be done with it and
// passes that in as children. No hooks and no browser APIs, so it works in
// server and client components alike.

import type { ReactNode } from 'react';
import type { Plan } from '@/lib/plans';

/** "$29 / month". Whole amounts drop the decimals. */
export function formatPlanPrice(plan: Plan): string {
  const amount = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: plan.currency,
    minimumFractionDigits: plan.unitAmount % 100 === 0 ? 0 : 2,
  }).format(plan.unitAmount / 100);
  return `${amount} / ${plan.interval}`;
}

type PlanCardProps = {
  plan: Plan;
  /** Shown next to the name, e.g. a "Your plan" badge. */
  badge?: ReactNode;
  /** The action for an available plan: a button or a link. */
  children?: ReactNode;
};

export default function PlanCard({ plan, badge, children }: PlanCardProps) {
  return (
    <div
      className={`flex flex-col rounded-2xl border p-5 ${
        plan.highlighted
          ? 'border-[#635BFF] dark:border-[#8b85ff]'
          : 'border-black/[.08] dark:border-white/[.145]'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-semibold text-black dark:text-zinc-50">{plan.name}</h3>
        {badge}
      </div>
      <p className="mt-2 text-2xl font-semibold tracking-tight text-black dark:text-zinc-50">
        {formatPlanPrice(plan)}
      </p>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{plan.description}</p>
      <ul className="mt-4 flex-1 list-disc space-y-1 pl-5 text-sm text-zinc-600 dark:text-zinc-400">
        {plan.features.map((feature) => (
          <li key={feature}>{feature}</li>
        ))}
      </ul>

      {plan.available ? (
        children && <div className="mt-5 flex flex-col">{children}</div>
      ) : (
        // The plan is in plans.json but no Stripe price carries its lookup
        // key yet, so it can be shown but not bought.
        <p className="mt-5 rounded-xl bg-yellow-100 px-3 py-2 text-xs text-yellow-800 dark:bg-yellow-400/10 dark:text-yellow-300">
          Demo plan: no Stripe price has the lookup key{' '}
          <code className="font-mono">{plan.lookupKey}</code> yet. Run{' '}
          <code className="font-mono">npm run billing:seed</code>.
        </p>
      )}
    </div>
  );
}
