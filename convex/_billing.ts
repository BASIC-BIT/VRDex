import { v } from "convex/values";

export type BillingOwnerKind = "user" | "profile";
export type StripeEnvironment = "test" | "live";
export type BillingCustomerState = "active" | "archived";
export type BillingCustomerCreatedFrom = "checkout" | "portal" | "webhook" | "operator" | "migration";

export type BillingSubscriptionStatus =
  | "incomplete"
  | "incomplete_expired"
  | "trialing"
  | "active"
  | "past_due"
  | "canceled"
  | "unpaid"
  | "paused"
  | "unknown";

export type BillingEntitlementStatus = "active" | "trialing" | "grace_period" | "pending" | "inactive";
export type BillingEntitlementSource = "stripe_subscription" | "operator_override" | "migration";

export type BillingEntitlementDerivationInput = {
  subscriptionStatus: unknown;
  currentPeriodEnd?: number;
  now?: number;
};

const STRIPE_SUBSCRIPTION_STATUSES = new Set<BillingSubscriptionStatus>([
  "incomplete",
  "incomplete_expired",
  "trialing",
  "active",
  "past_due",
  "canceled",
  "unpaid",
  "paused",
]);

const BILLING_ENTITLEMENT_STATUSES = new Set<BillingEntitlementStatus>([
  "active",
  "trialing",
  "grace_period",
  "pending",
  "inactive",
]);

export const billingOwnerKindValidator = v.union(v.literal("user"), v.literal("profile"));
export const stripeEnvironmentValidator = v.union(v.literal("test"), v.literal("live"));
export const billingCustomerStateValidator = v.union(v.literal("active"), v.literal("archived"));
export const billingCustomerCreatedFromValidator = v.union(
  v.literal("checkout"),
  v.literal("portal"),
  v.literal("webhook"),
  v.literal("operator"),
  v.literal("migration"),
);

export const billingSubscriptionStatusValidator = v.union(
  v.literal("incomplete"),
  v.literal("incomplete_expired"),
  v.literal("trialing"),
  v.literal("active"),
  v.literal("past_due"),
  v.literal("canceled"),
  v.literal("unpaid"),
  v.literal("paused"),
  v.literal("unknown"),
);

export const billingEntitlementStatusValidator = v.union(
  v.literal("active"),
  v.literal("trialing"),
  v.literal("grace_period"),
  v.literal("pending"),
  v.literal("inactive"),
);

export const billingEntitlementSourceValidator = v.union(
  v.literal("stripe_subscription"),
  v.literal("operator_override"),
  v.literal("migration"),
);

function normalizedStatusText(input: unknown): string | undefined {
  if (typeof input !== "string") {
    return undefined;
  }

  const normalized = input.trim().toLowerCase().replaceAll("-", "_");

  if (normalized.length === 0) {
    return undefined;
  }

  return normalized === "cancelled" ? "canceled" : normalized;
}

export function normalizeStripeSubscriptionStatus(input: unknown): BillingSubscriptionStatus {
  const normalized = normalizedStatusText(input);

  if (normalized !== undefined && STRIPE_SUBSCRIPTION_STATUSES.has(normalized as BillingSubscriptionStatus)) {
    return normalized as BillingSubscriptionStatus;
  }

  return "unknown";
}

export function normalizeBillingEntitlementStatus(input: unknown): BillingEntitlementStatus {
  const normalized = normalizedStatusText(input);

  if (normalized !== undefined && BILLING_ENTITLEMENT_STATUSES.has(normalized as BillingEntitlementStatus)) {
    return normalized as BillingEntitlementStatus;
  }

  return "inactive";
}

export function deriveBillingEntitlementStatus(
  input: BillingEntitlementDerivationInput,
): BillingEntitlementStatus {
  const subscriptionStatus = normalizeStripeSubscriptionStatus(input.subscriptionStatus);
  const now = input.now ?? Date.now();
  const expired =
    typeof input.currentPeriodEnd === "number" &&
    Number.isFinite(input.currentPeriodEnd) &&
    input.currentPeriodEnd <= now;

  switch (subscriptionStatus) {
    case "active":
      return expired ? "inactive" : "active";
    case "trialing":
      return expired ? "inactive" : "trialing";
    case "past_due":
      return expired ? "inactive" : "grace_period";
    case "incomplete":
      return "pending";
    case "canceled":
    case "incomplete_expired":
    case "paused":
    case "unpaid":
    case "unknown":
      return "inactive";
  }
}
