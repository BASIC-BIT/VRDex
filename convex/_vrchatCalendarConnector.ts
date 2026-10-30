import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { DatabaseReader, MutationCtx } from "./_generated/server";
import { readManagedIntegration } from "./_groupObservationPolicy";
import { enabledClubFeatures } from "./_clubConnection";
import { cancelPendingSchedule } from "./_eventSync";

// Helpers shared by clubOperations.ts and the VRChat calendar connector; a separate module so neither imports the other.

export type ReadinessCode = "no_integration" | "integration_inactive" | "no_collector_account" | "feature_disabled";

export async function vrchatCalendarReadiness(db: DatabaseReader, communityProfileId: Id<"profiles">): Promise<
  { ready: true; integration: Doc<"communityVrchatIntegrations"> } | { ready: false; code: ReadinessCode }
> {
  const integration = await readManagedIntegration(db, communityProfileId);
  if (!integration) return { ready: false, code: "no_integration" };
  if (integration.state !== "active" && integration.state !== "degraded") return { ready: false, code: "integration_inactive" };
  if (!integration.assignedCollectorAccountId) return { ready: false, code: "no_collector_account" };
  if (!enabledClubFeatures(integration).includes("calendar")) return { ready: false, code: "feature_disabled" };
  return { ready: true, integration };
}

// A terminal connector operation wakes the sync job waiting on it now instead of at the end of its wait.
// Anything else (the job moved on, or waits on another operation) is a stale callback and does nothing.
export async function resumeConnectorSyncJob(ctx: MutationCtx, operation: Doc<"clubOperations">): Promise<void> {
  if (!operation.connectorSync) return;
  const job = await ctx.db.get(operation.connectorSync.jobId);
  if (job?.state !== "running" || (job.payload as { operationId?: unknown } | null)?.operationId !== operation._id) return;
  await cancelPendingSchedule(ctx.db, ctx.scheduler, job.scheduledFunctionId);
  const scheduledFunctionId = await ctx.scheduler.runAfter(0, internal.eventSync.runJob, { jobId: job._id });
  await ctx.db.patch(job._id, { leaseExpiresAt: Date.now(), scheduledFunctionId, updatedAt: Date.now() });
}
