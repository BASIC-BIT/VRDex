import type { Doc, Id } from "./_generated/dataModel";
import type { DatabaseReader, MutationCtx } from "./_generated/server";
import { resolveClubSubject } from "./_clubAccess";
import { getActiveProfileOwner } from "./_profileOwnership";
import { clubOperationRequirement } from "./_clubOperationPolicy";
import { policyOperation } from "./_clubOperations";

export async function notificationRecipient(
  db: DatabaseReader,
  job: Doc<"clubOperations">,
) {
  const actor = await resolveClubSubject(db, job.communityProfileId, job.actor);
  const permission = clubOperationRequirement(
    policyOperation(job.payload, "unknown"),
  ).permission;
  if (actor.kind !== "none") {
    // A staff member may retain club access but lose access to this operation.
    if (actor.kind !== "owner" && !actor.permissions.includes(permission))
      return null;
    return job.actor;
  }
  const ownership = await getActiveProfileOwner(db, job.communityProfileId);
  const owner = ownership ? await db.get(ownership.userId) : null;
  const issuer = process.env.CLERK_JWT_ISSUER_DOMAIN;
  if (!owner?.clerkUserId || !issuer) return null;
  return {
    subject: owner.clerkUserId,
    issuer,
    tokenIdentifier: `${issuer}|${owner.clerkUserId}`,
  };
}

export async function recordClubOperationFailure(
  ctx: MutationCtx,
  operationId: Id<"clubOperations">,
) {
  const job = await ctx.db.get(operationId);
  if (
    !job ||
    !(
      job.state === "rejected" ||
      job.state === "indeterminate" ||
      job.state === "missed"
    )
  )
    return;
  const previous = await ctx.db
    .query("clubOperationNotifications")
    .withIndex("by_operation_revision_outcome", (q) =>
      q
        .eq("operationId", operationId)
        .eq("revision", job.revision)
        .eq("outcome", job.state as "rejected" | "indeterminate" | "missed"),
    )
    .unique();
  if (previous) return;
  await ctx.db.insert("clubOperationNotifications", {
    communityProfileId: job.communityProfileId,
    batchId: job.batchId,
    operationId,
    emailNextAttemptAt: Date.now(),
    revision: job.revision,
    outcome: job.state,
    createdAt: Date.now(),
    readBy: [],
    emailState: "pending",
  });
}
