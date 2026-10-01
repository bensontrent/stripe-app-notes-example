// components/Paywall.tsx
//
// ============================================================================
//  Paywall — show a paid feature, or the reason it isn't available
// ============================================================================
//
// Wrap whatever is paid for:
//
//   <PaywallProvider context={context}>
//     <Paywall context={context} unit="note">
//       <NoteComposer … />
//     </Paywall>
//   </PaywallProvider>
//
// and the user sees one of four things, chosen by the backend
// (`status.view`, see src/types/paywall.ts):
//
//   content       the children — test mode, a subscription, or a running
//                 trial (with a line saying how much of the trial is left)
//   intro         the trial terms and a "Start free trial" button. The trial
//                 starts when someone accepts, not at install, so nobody
//                 loses trial days to an app they haven't opened yet.
//   trial-ended   the trial ran out (time or allowance): three steps to
//                 subscribe — log in, choose a plan on the website, recheck
//
// Every view links to the backend's public price list (/plans, no login),
// so the price is never a surprise at the end of the trial.
//   past-due      a subscription exists but its invoice is unpaid
//
// Modeled on Parcelcraft's PayWall component, with the decision moved to the
// backend: this file renders, it never decides. Hiding the children is a
// courtesy to the user, not the lock — the backend route behind the feature
// checks access again (POST /api/stripe-app/notes in the backend). Only
// adding a note is paid for: the list of existing notes sits outside
// <Paywall> and stays usable when the trial has run out.
//
// Two components:
//
//   Paywall       connected: reads usePaywall() and handles loading/errors.
//                 This is the one to use.
//   PaywallGate   presentational: renders a given PaywallStatus. Tests use
//                 it directly to render every state.
//
// Layout: everything here is plain Boxes, so it fits inside a ContextView, a
// PageModule or a FocusView alike. (Don't put a PageModule inside it:
// PageModule must be a direct child of DetailPage / OverviewPage, or the
// Dashboard throws "Invalid usage of PageModule".)
// ============================================================================

import type { ExtensionContextValue } from "@stripe/ui-extension-sdk/context";
import {
  Badge,
  Banner,
  Box,
  Button,
  Inline,
  Link,
  Spinner,
} from "@stripe/ui-extension-sdk/ui";
import type { ReactNode } from "react";
import { billingPageUrl, plansPageUrl } from "../api/backend";
import {
  usePaywall,
  type PaywallAction,
  type PaywallActions,
  type PaywallError,
  type PaywallRecheck,
} from "../hooks/usePaywall";
import type { PaywallLimits, PaywallStatus } from "../types/paywall";
import Login from "./Login";

// ---------------------------------------------------------------------------
//  Wording (pure functions, unit-tested in Paywall.test.tsx)
// ---------------------------------------------------------------------------

const plural = (count: number, noun: string) =>
  `${count} ${noun}${count === 1 ? "" : "s"}`;

export const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

/** The trial terms in one sentence, for whichever limits are switched on. */
export function trialTermsText(limits: PaywallLimits, unit: string): string {
  const { trialDaysLimit: days, trialCountLimit: count } = limits;
  if (days !== null && count !== null) {
    return `Your free trial lasts ${plural(days, "day")} and includes ${plural(count, unit)}, whichever runs out first.`;
  }
  if (days !== null) return `Your free trial lasts ${plural(days, "day")}.`;
  if (count !== null) return `Your free trial includes ${plural(count, unit)}.`;
  return "Your free trial has no limits.";
}

/** How much of a running trial is left, e.g. "12 days and 3 notes left in your free trial". */
export function trialRemainingText(status: PaywallStatus, unit: string): string {
  const { daysRemaining, usageRemaining } = status.trial;
  const parts = [
    daysRemaining !== null && plural(daysRemaining, "day"),
    usageRemaining !== null && plural(usageRemaining, unit),
  ].filter(Boolean);
  return parts.length > 0
    ? `${parts.join(" and ")} left in your free trial`
    : "You are in your free trial";
}

/** Why the trial ended, as a banner title and description. */
export function trialEndedText(
  status: PaywallStatus,
  unit: string,
): { title: string; description: string } {
  if (status.reason === "trial_limit_reached") {
    const allowance = status.limits.trialCountLimit ?? status.trial.usageCount;
    return {
      title: `You have used all ${plural(allowance, unit)} of your free trial`,
      description:
        "The allowance is shared by everyone who uses the app in your Stripe account.",
    };
  }
  return {
    title: status.trial.expiresAt
      ? `Your free trial ended on ${formatDate(status.trial.expiresAt)}`
      : "Your free trial has ended",
    description:
      "The trial started the first time someone in your Stripe account accepted it.",
  };
}

// ---------------------------------------------------------------------------
//  Shared pieces
// ---------------------------------------------------------------------------

const panel = {
  stack: "y",
  gap: "medium",
  padding: "medium",
  backgroundColor: "container",
  borderRadius: "medium",
} as const;

const ActionError = ({ error }: { error: PaywallError | null }) =>
  error ? (
    <Box css={{ stack: "y", gap: "xsmall" }}>
      <Banner type="critical" title="Request failed" description={error.message} />
      {error.hint && (
        <Box css={{ font: "caption", color: "secondary" }}>💡 {error.hint}</Box>
      )}
    </Box>
  ) : null;

const formatTime = (iso: string) =>
  new Date(iso).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });

/** The recheck answer in one sentence. */
export function recheckSummaryText(status: PaywallStatus): string {
  const { subscription } = status;
  if (status.reason === "test_mode") {
    return "Test mode is free, so there is no plan to look for.";
  }
  if (!subscription) {
    return "No plan found for this Stripe account. If you have just subscribed, make sure you are logged in here with the account you paid with.";
  }
  const plan = subscription.planName ?? "Custom plan";
  const state = subscription.status.replace("_", " ");
  return status.access === "granted"
    ? `Found the ${plan} plan (${state}).`
    : `Found the ${plan} plan, but it is ${state}.`;
}

/**
 * What the backend answered to "Recheck my plan": POST
 * /api/stripe-app/paywall/refresh. Shown whether or not the answer changed
 * anything, so the button never appears to do nothing.
 */
export const RecheckResult = ({
  recheck,
  preview,
}: {
  recheck: PaywallRecheck | null | undefined;
  preview?: boolean;
}) => {
  if (!recheck) return null;
  const { status, checkedAt } = recheck;
  return (
    <Box css={{ stack: "y", gap: "xsmall" }}>
      <Box css={{ stack: "x", gap: "small", alignY: "center", wrap: "wrap" }}>
        <Inline css={{ fontWeight: "semibold" }}>Server response</Inline>
        <Badge type={status.access === "granted" ? "positive" : "negative"}>
          access {status.access}
        </Badge>
        <Inline css={{ font: "caption", color: "secondary" }}>
          checked at {formatTime(checkedAt)}
        </Inline>
      </Box>
      <Box css={{ font: "caption" }}>{recheckSummaryText(status)}</Box>
      <Box css={{ font: "caption", color: "secondary" }}>
        reason: {status.reason} · view: {status.view} · mode: {status.mode}
      </Box>
      {preview && (
        <Box css={{ font: "caption", color: "secondary" }}>
          This is the answer for your real Stripe account. The situation
          previewed above is made up and stays as it is.
        </Box>
      )}
    </Box>
  );
};

/**
 * Link to the backend's public price list (/plans). It needs no login, so
 * it is offered in every view: people want to know the price before they
 * start a trial, not only after it ends.
 */
export const PlansLink = ({
  context,
  children = "See plans and pricing",
}: {
  context: ExtensionContextValue;
  children?: ReactNode;
}) => (
  <Link href={plansPageUrl(context)} target="_blank" external>
    {children}
  </Link>
);

const Step = ({ number, children }: { number: number; children: ReactNode }) => (
  <Box css={{ stack: "y", gap: "xsmall" }}>
    <Inline css={{ font: "heading" }}>Step {number}</Inline>
    {children}
  </Box>
);

type ViewProps = {
  context: ExtensionContextValue;
  status: PaywallStatus;
  actions: Pick<PaywallActions, "startTrial" | "refresh">;
  pending: PaywallAction | null;
  actionError: PaywallError | null;
  /** What one use of the feature is called, singular: "note". */
  unit: string;
  /** The backend's answer to the last "Recheck my plan", shown under the button. */
  lastRecheck?: PaywallRecheck | null;
  /**
   * The status on screen is made up (the demo's preview section). Disables
   * "Start free trial", the one button that would change the account's
   * trial. Everything else stays live: the Login component, the links, and
   * "Recheck my plan", whose answer is then about the real account and is
   * labelled as such.
   */
  preview?: boolean;
};

// ---------------------------------------------------------------------------
//  The views
// ---------------------------------------------------------------------------

/** intro: the terms, and the button that starts the trial. */
export const TrialIntro = ({
  context,
  status,
  actions,
  pending,
  actionError,
  unit,
  preview,
}: ViewProps) => (
  <Box css={{ stack: "y", gap: "medium" }}>
    <Inline css={{ font: "heading" }}>Start your free trial</Inline>
    <Box>
      {trialTermsText(status.limits, unit)} The trial is shared by everyone who
      uses the app in your Stripe account, and it starts when you press the
      button below.
    </Box>
    <Box css={{ color: "secondary" }}>
      We will tell you here when the trial has ended and it is time to choose
      a plan. No payment details are needed to start.
    </Box>

    <Box>
      <Button
        type="primary"
        disabled={preview || pending !== null}
        onPress={actions.startTrial}
      >
        Start free trial
        {pending === "start-trial" && <Spinner size="small" />}
      </Button>
    </Box>

    <Box>
      <PlansLink context={context}>See what it costs after the trial</PlansLink>
    </Box>

    {status.mode === "live" && (
      <Box css={{ font: "caption", color: "secondary" }}>
        Only want to try things out? Open the app in test mode: it is free and
        unlimited there.
      </Box>
    )}

    <ActionError error={actionError} />
  </Box>
);

/** Steps 1-3 shared by the two blocked views. */
const UpgradeSteps = ({
  context,
  status,
  actions,
  pending,
  actionError,
  lastRecheck,
  preview,
  planStep,
}: ViewProps & { planStep: string }) => (
  <Box css={panel}>
    <Step number={1}>
      <Box>Log in or create an account. Your plan is tied to it.</Box>
      {/* The real component in previews too: logging in changes nothing
          about the trial, and a placeholder would hide the one step people
          most want to see working. */}
      <Login context={context} />
    </Step>

    <Step number={2}>
      <Box>{planStep}</Box>
      <Link href={billingPageUrl(context)} target="_blank" external>
        Open the billing page
      </Link>
      <Box css={{ font: "caption", color: "secondary" }}>
        Want to compare first? <PlansLink context={context}>See plans and pricing</PlansLink> (no
        login needed).
      </Box>
    </Step>

    <Step number={3}>
      <Box>Come back here and recheck. The app unlocks straight away.</Box>
      <Box>
        {/* Live in previews too: a recheck reads, it doesn't spend anything. */}
        <Button
          type="primary"
          disabled={pending !== null}
          onPress={actions.refresh}
        >
          Recheck my plan
          {pending === "refresh" && <Spinner size="small" />}
        </Button>
      </Box>
      <RecheckResult recheck={lastRecheck} preview={preview} />
    </Step>

    <Box css={{ stack: "x", gap: "small", alignY: "center" }}>
      <Inline css={{ font: "caption", color: "secondary" }}>Plan status</Inline>
      <Badge type={status.subscription ? "negative" : "neutral"}>
        {status.subscription ? status.subscription.status.replace("_", " ") : "no plan"}
      </Badge>
    </Box>

    <ActionError error={actionError} />
  </Box>
);

/** trial-ended: the trial ran out of time or allowance. */
export const TrialEnded = (props: ViewProps) => {
  const { title, description } = trialEndedText(props.status, props.unit);
  return (
    <Box css={{ stack: "y", gap: "medium" }}>
      <Banner type="critical" title={title} description={description} />
      <Inline css={{ font: "subtitle" }}>Upgrade in 3 steps</Inline>
      <UpgradeSteps {...props} planStep="Choose any paid plan on the billing page." />
    </Box>
  );
};

/** past-due: there is a plan, but its latest invoice is unpaid. */
export const PastDue = (props: ViewProps) => (
  <Box css={{ stack: "y", gap: "medium" }}>
    <Banner
      type="critical"
      title="Your plan is past due"
      description="The latest invoice for your plan has not been paid. Pay it to continue."
    />
    <Inline css={{ font: "subtitle" }}>Pay for your plan in 3 steps</Inline>
    <UpgradeSteps
      {...props}
      planStep='Press "Manage plan" on the billing page and pay the open invoice or update your payment method.'
    />
  </Box>
);

/** Shown above the feature while a trial is running. */
export const TrialNotice = ({
  context,
  status,
  unit,
}: Pick<ViewProps, "context" | "status" | "unit">) => (
  <Box css={{ stack: "x", gap: "small", alignY: "center", wrap: "wrap" }}>
    <Badge type="info">Free trial</Badge>
    <Inline css={{ font: "caption", color: "secondary" }}>
      {trialRemainingText(status, unit)}
      {status.trial.expiresAt && ` (ends ${formatDate(status.trial.expiresAt)})`}
    </Inline>
    <PlansLink context={context}>See plans</PlansLink>
  </Box>
);

// ---------------------------------------------------------------------------
//  The gate
// ---------------------------------------------------------------------------

export type PaywallGateProps = ViewProps & {
  /** The paid feature. Rendered only when the status grants access. */
  children: ReactNode;
};

/** Renders the view a PaywallStatus asks for. Presentational. */
export function PaywallGate({ children, ...props }: PaywallGateProps) {
  switch (props.status.view) {
    case "intro":
      return <TrialIntro {...props} />;
    case "trial-ended":
      return <TrialEnded {...props} />;
    case "past-due":
      return <PastDue {...props} />;
    case "content":
      return (
        <Box css={{ stack: "y", gap: "medium" }}>
          {props.status.reason === "trialing" && (
            <TrialNotice context={props.context} status={props.status} unit={props.unit} />
          )}
          {children}
        </Box>
      );
  }
}

export type PaywallProps = {
  context: ExtensionContextValue;
  /** What one use of the feature is called, singular. Defaults to "use". */
  unit?: string;
  children: ReactNode;
};

/**
 * The paid feature, or the reason it isn't available. Must be rendered
 * inside <PaywallProvider>.
 */
export default function Paywall({ context, unit = "use", children }: PaywallProps) {
  const {
    state,
    error,
    status,
    pending,
    actionError,
    lastRecheck,
    startTrial,
    refresh,
  } = usePaywall();

  if (state === "loading") return <Spinner size="small" />;

  if (state === "error" || !status) {
    // Fail closed: if the backend can't be asked, the feature stays hidden.
    // The backend route would refuse it anyway.
    return (
      <Box css={{ stack: "y", gap: "xsmall" }}>
        <Banner
          type="critical"
          title="Couldn't check your plan"
          description={error?.message ?? "Unknown error"}
        />
        {error?.hint && (
          <Box css={{ font: "caption", color: "secondary" }}>💡 {error.hint}</Box>
        )}
      </Box>
    );
  }

  return (
    <PaywallGate
      context={context}
      status={status}
      actions={{ startTrial, refresh }}
      pending={pending}
      actionError={actionError}
      lastRecheck={lastRecheck}
      unit={unit}
    >
      {children}
    </PaywallGate>
  );
}
