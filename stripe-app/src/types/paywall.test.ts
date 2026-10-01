// Unit tests for the paywall decision: the facts (mode, trial row,
// subscription, limits) in, the PaywallStatus out. The backend runs the same
// function, so these tests are the specification of who gets access.

import {
  describeTrial,
  resolvePaywall,
  type PaywallInput,
  type PaywallSubscription,
} from "./paywall";

const NOW = new Date("2026-06-15T12:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY_MS).toISOString();

const LIMITS = { trialDaysLimit: 30, trialCountLimit: 25 };

const subscription = (status: PaywallSubscription["status"]): PaywallSubscription => ({
  status,
  planName: "Pro",
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
});

const resolve = (overrides: Partial<PaywallInput> = {}) =>
  resolvePaywall({
    mode: "live",
    limits: LIMITS,
    trial: null,
    subscription: null,
    now: NOW,
    ...overrides,
  });

describe("resolvePaywall", () => {
  describe("test mode", () => {
    it("is always free, whatever the trial and subscription say", () => {
      const status = resolve({
        mode: "test",
        trial: { startedAt: daysAgo(400), usageCount: 999 },
        subscription: subscription("past_due"),
      });
      expect(status).toMatchObject({
        access: "granted",
        reason: "test_mode",
        view: "content",
        enforced: false,
      });
    });

    it("is paywalled like live mode when enforcement is switched on", () => {
      const status = resolve({ mode: "test", enforceInTestMode: true });
      expect(status).toMatchObject({
        access: "denied",
        reason: "trial_not_started",
        view: "intro",
        enforced: true,
      });
    });
  });

  describe("subscription", () => {
    it.each(["active", "trialing"] as const)("grants access when %s", (status) => {
      expect(resolve({ subscription: subscription(status) })).toMatchObject({
        access: "granted",
        reason: "subscribed",
      });
    });

    it("wins over an expired trial", () => {
      const status = resolve({
        trial: { startedAt: daysAgo(90), usageCount: 25 },
        subscription: subscription("active"),
      });
      expect(status.reason).toBe("subscribed");
    });

    it("blocks when past due, even with trial allowance left", () => {
      const status = resolve({
        trial: { startedAt: daysAgo(1), usageCount: 0 },
        subscription: subscription("past_due"),
      });
      expect(status).toMatchObject({
        access: "denied",
        reason: "payment_past_due",
        view: "past-due",
      });
    });

    it.each(["canceled", "unpaid", "incomplete", "incomplete_expired", "paused"] as const)(
      "counts %s as no subscription and falls back to the trial",
      (status) => {
        const running = resolve({
          trial: { startedAt: daysAgo(1), usageCount: 0 },
          subscription: subscription(status),
        });
        expect(running.reason).toBe("trialing");

        const notStarted = resolve({ subscription: subscription(status) });
        expect(notStarted.reason).toBe("trial_not_started");
      },
    );
  });

  describe("trial", () => {
    it("shows the intro until the trial has been started", () => {
      expect(resolve()).toMatchObject({
        access: "denied",
        reason: "trial_not_started",
        view: "intro",
      });
    });

    it("grants access while both limits hold", () => {
      const status = resolve({ trial: { startedAt: daysAgo(10), usageCount: 24 } });
      expect(status).toMatchObject({ access: "granted", reason: "trialing" });
      expect(status.trial).toMatchObject({ daysRemaining: 20, usageRemaining: 1 });
    });

    it("ends when the days run out", () => {
      const status = resolve({ trial: { startedAt: daysAgo(30), usageCount: 0 } });
      expect(status).toMatchObject({
        access: "denied",
        reason: "trial_expired",
        view: "trial-ended",
      });
      expect(status.trial.daysRemaining).toBe(0);
    });

    it("ends when the allowance is used up", () => {
      const status = resolve({ trial: { startedAt: daysAgo(1), usageCount: 25 } });
      expect(status).toMatchObject({
        access: "denied",
        reason: "trial_limit_reached",
        view: "trial-ended",
      });
    });

    it("reports time before allowance when both have run out", () => {
      const status = resolve({ trial: { startedAt: daysAgo(31), usageCount: 25 } });
      expect(status.reason).toBe("trial_expired");
    });
  });

  describe("limits switched off (null)", () => {
    it("never expires without a day limit", () => {
      const status = resolve({
        limits: { trialDaysLimit: null, trialCountLimit: 25 },
        trial: { startedAt: daysAgo(4000), usageCount: 3 },
      });
      expect(status.reason).toBe("trialing");
      expect(status.trial).toMatchObject({ expiresAt: null, daysRemaining: null });
    });

    it("never runs out of uses without a count limit", () => {
      const status = resolve({
        limits: { trialDaysLimit: 30, trialCountLimit: null },
        trial: { startedAt: daysAgo(1), usageCount: 100000 },
      });
      expect(status.reason).toBe("trialing");
      expect(status.trial.usageRemaining).toBeNull();
    });
  });
});

describe("describeTrial", () => {
  it("derives the expiry date from the start date and the day limit", () => {
    const trial = describeTrial(
      { startedAt: "2026-06-01T00:00:00.000Z", usageCount: 5 },
      LIMITS,
      NOW,
    );
    expect(trial).toEqual({
      startedAt: "2026-06-01T00:00:00.000Z",
      expiresAt: "2026-07-01T00:00:00.000Z",
      // 15.5 days left, rounded up: "16 days left" reads right until the end.
      daysRemaining: 16,
      usageCount: 5,
      usageRemaining: 20,
    });
  });

  it("describes a trial that hasn't started", () => {
    expect(describeTrial(null, LIMITS, NOW)).toEqual({
      startedAt: null,
      expiresAt: null,
      daysRemaining: null,
      usageCount: 0,
      usageRemaining: 25,
    });
  });

  it("never reports more days than the limit when the database clock runs ahead", () => {
    const fiveSecondsAhead = new Date(NOW.getTime() + 5000).toISOString();
    const trial = describeTrial({ startedAt: fiveSecondsAhead, usageCount: 0 }, LIMITS, NOW);
    expect(trial.daysRemaining).toBe(30);
  });

  it("never reports negative remainders", () => {
    const trial = describeTrial({ startedAt: daysAgo(99), usageCount: 99 }, LIMITS, NOW);
    expect(trial).toMatchObject({ daysRemaining: 0, usageRemaining: 0 });
  });
});
