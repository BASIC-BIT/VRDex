import { v, type Infer } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { seedImportAuthSubjectValidator } from "./_seedImportValidators";
import { destinationGroupMetadataValidator } from "./_profileLinkDestination";

const common = {
  authorizedAt: v.number(), actor: seedImportAuthSubjectValidator, reason: v.string(),
  collectorAccountId: v.id("collectorAccounts"), epochStartedAt: v.number(),
  lastCheckedAt: v.optional(v.number()),
  membershipOrigin: v.union(v.literal("unknown"), v.literal("preexisting"), v.literal("admission")),
};
const request = {
  joinPolicy: v.literal("request"),
  operation: v.optional(v.object({kind: v.union(v.literal("request"), v.literal("leave"), v.literal("withdraw_request")), startedAt: v.number(), outcome: v.union(v.literal("uncertain"), v.literal("confirmed"))})),
};
const invite = {
  joinPolicy: v.literal("invite"),
  operation: v.optional(v.object({kind: v.union(v.literal("accept_invite"), v.literal("leave")), startedAt: v.number(), outcome: v.union(v.literal("uncertain"), v.literal("confirmed"))})),
};
const usableOrEnded = {
  phase: v.union(v.literal("pending"), v.literal("active"), v.literal("paused"), v.literal("ended")),
  revokedAt: v.optional(v.number()),
};
const revoked = {
  phase: v.union(v.literal("cleanup_pending"), v.literal("cancelled")), revokedAt: v.number(),
};
export const statisticsAdmissionValidator = v.union(
  v.object({...common, ...request, ...usableOrEnded}),
  v.object({...common, ...invite, ...usableOrEnded}),
  v.object({...common, ...request, ...revoked}),
  v.object({...common, ...invite, ...revoked}),
);
export type StatisticsAdmission = Infer<typeof statisticsAdmissionValidator>;
export const statisticsAdmissionViewValidator = v.object({
  eligible: v.boolean(), blockReason: v.optional(v.string()),
  vrchatGroupId: v.optional(v.string()), groupName: v.optional(v.string()), groupMetadata: v.optional(destinationGroupMetadataValidator), metadataObservedAt: v.optional(v.number()),
  bot: v.optional(v.object({collectorAccountId:v.id("collectorAccounts"), accountAlias:v.string(), vrchatUserId:v.string(), profileUrl:v.string()})),
  integrationId:v.optional(v.id("communityVrchatIntegrations")), state:v.optional(v.string()),
  statisticsAdmission:v.optional(statisticsAdmissionValidator), nextPollAt:v.optional(v.number()),
});
export type StatisticsAdmissionView = Infer<typeof statisticsAdmissionViewValidator>;

/** Semantic checks beyond the stored shape, shared by admission write boundaries. */
export function assertStatisticsAdmission(admission: StatisticsAdmission): void {
  if (!admission.reason.trim() || admission.reason !== admission.reason.trim() || admission.reason.length > 500) throw new Error("Admission reason must be trimmed and between 1 and 500 characters.");
  if (!["request", "invite"].includes(admission.joinPolicy) ||
      !["pending", "active", "paused", "ended", "cleanup_pending", "cancelled"].includes(admission.phase) ||
      ((admission.phase === "cleanup_pending" || admission.phase === "cancelled") && admission.revokedAt === undefined) ||
      (admission.operation && !(admission.joinPolicy === "request" ? ["request", "withdraw_request", "leave"] : ["accept_invite", "leave"]).includes(admission.operation.kind))) throw new Error("Contradictory statistics admission.");
}

/** This matches grant authority only. Publication separately requires confirmed membership. */
export function admissionMatches(integration: Doc<"communityVrchatIntegrations">, admissionAt: number, collectorAccountId: Id<"collectorAccounts">): boolean {
  const admission = integration.statisticsAdmission;
  if (!admission) return false;
  assertStatisticsAdmission(admission);
  return admission.authorizedAt === admissionAt && admission.revokedAt === undefined &&
    (admission.phase === "pending" || admission.phase === "active") &&
    admission.epochStartedAt === (integration.telemetryEpochStartedAt ?? integration.createdAt) &&
    admission.collectorAccountId === collectorAccountId && integration.assignedCollectorAccountId === collectorAccountId;
}
