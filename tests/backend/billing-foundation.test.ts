import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  deriveBillingEntitlementStatus,
  normalizeBillingEntitlementStatus,
  normalizeStripeSubscriptionStatus,
} from "../../convex/_billing";

describe("billing status helpers", () => {
  it("normalizes Stripe subscription statuses without trusting unknown input", () => {
    assert.equal(normalizeStripeSubscriptionStatus(" ACTIVE "), "active");
    assert.equal(normalizeStripeSubscriptionStatus("past-due"), "past_due");
    assert.equal(normalizeStripeSubscriptionStatus("cancelled"), "canceled");
    assert.equal(normalizeStripeSubscriptionStatus("not-a-stripe-status"), "unknown");
    assert.equal(normalizeStripeSubscriptionStatus(undefined), "unknown");
  });

  it("normalizes internal entitlement statuses to product-safe states", () => {
    assert.equal(normalizeBillingEntitlementStatus("grace-period"), "grace_period");
    assert.equal(normalizeBillingEntitlementStatus(" TRIALING "), "trialing");
    assert.equal(normalizeBillingEntitlementStatus("suspended"), "inactive");
    assert.equal(normalizeBillingEntitlementStatus(null), "inactive");
  });

  it("derives product entitlement state from current subscription snapshots", () => {
    const now = Date.UTC(2026, 6, 1, 12, 0, 0);
    const future = now + 86_400_000;
    const past = now - 86_400_000;

    assert.equal(
      deriveBillingEntitlementStatus({
        subscriptionStatus: "active",
        currentPeriodEnd: future,
        now,
      }),
      "active",
    );
    assert.equal(
      deriveBillingEntitlementStatus({
        subscriptionStatus: "trialing",
        currentPeriodEnd: future,
        now,
      }),
      "trialing",
    );
    assert.equal(
      deriveBillingEntitlementStatus({
        subscriptionStatus: "past_due",
        currentPeriodEnd: future,
        now,
      }),
      "grace_period",
    );
    assert.equal(
      deriveBillingEntitlementStatus({
        subscriptionStatus: "incomplete",
        now,
      }),
      "pending",
    );
    assert.equal(
      deriveBillingEntitlementStatus({
        subscriptionStatus: "active",
        currentPeriodEnd: past,
        now,
      }),
      "inactive",
    );
    assert.equal(
      deriveBillingEntitlementStatus({
        subscriptionStatus: "unpaid",
        currentPeriodEnd: future,
        now,
      }),
      "inactive",
    );
  });
});
