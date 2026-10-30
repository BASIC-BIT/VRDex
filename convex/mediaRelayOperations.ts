import { internalMutation, type MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import { ReleaseEvidenceSchema } from "../packages/media-relay/src/worker/release-evidence";
import { WorkerBindingsSchema } from "../packages/media-relay/src/worker/deployment";
import { relayOperationState } from "./_mediaRelayOperations";
import { rejectBrowserIdentityForDeploymentOperation } from "./_browserSessionAuthority";
async function update(
  ctx: MutationCtx,
  patch: { enabled?: boolean; drainingWorkers?: string[]; evidenceId?: string },
) {
  const row = await relayOperationState(ctx.db);
  if (row) await ctx.db.patch(row._id, { ...patch, updatedAt: Date.now() });
  else
    await ctx.db.insert("mediaRelayOperations", {
      key: "global",
      enabled: false,
      drainingWorkers: [],
      ...patch,
      updatedAt: Date.now(),
    });
}
export const drainWorker = internalMutation({
  args: { workerId: v.string() },
  handler: async (ctx, args) => {
    await rejectBrowserIdentityForDeploymentOperation(ctx);
    const bindings = WorkerBindingsSchema.parse(
      JSON.parse(process.env.MEDIA_RELAY_WORKERS ?? "null"),
    );
    if (!bindings.some((b) => b.workerId === args.workerId))
      throw Error("Unknown relay worker");
    const row = await relayOperationState(ctx.db);
    const draining = new Set(row?.drainingWorkers ?? []);
    draining.add(args.workerId);
    if (draining.size > 1000) throw Error("Drain inventory full");
    await update(ctx, { drainingWorkers: [...draining] });
    return null;
  },
});
export const setRelayEnabled = internalMutation({
  args: { enabled: v.boolean() },
  handler: async (ctx, args) => {
    await rejectBrowserIdentityForDeploymentOperation(ctx);
    if (!args.enabled) {
      await update(ctx, { enabled: false });
      return null;
    }
    let evidence;
    try {
      evidence = ReleaseEvidenceSchema.parse(
        JSON.parse(process.env.MEDIA_RELAY_RELEASE_EVIDENCE ?? "null"),
      );
    } catch {
      throw Error("Complete reviewed hosted release measurements required");
    }
    if (process.env.MEDIA_RELAY_ENABLED !== "true")
      throw Error("Deployment release gate is off");
    if (
      evidence.deployment !== process.env.CONVEX_CLOUD_URL ||
      evidence.measuredAt > Date.now() ||
      Date.now() - evidence.measuredAt > 7 * 86400000
    )
      throw Error("Release evidence deployment or freshness mismatch");
    const bindings = WorkerBindingsSchema.parse(
      JSON.parse(process.env.MEDIA_RELAY_WORKERS ?? "null"),
    );
    const state = await relayOperationState(ctx.db);
    const available = bindings.filter(
      (binding) =>
        !binding.draining && !state?.drainingWorkers.includes(binding.workerId),
    );
    const cap = Number(process.env.MEDIA_RELAY_MAX_SOURCES);
    if (
      !Number.isSafeInteger(cap) ||
      cap < 1 ||
      cap > evidence.sourceCap ||
      available.length < 2 ||
      bindings.some(
        (b) =>
          b.allocation.evidenceId !== evidence.evidenceId ||
          evidence.memoryPeakBytes > b.allocation.memoryMiB * 1048576 * 0.7,
      ) ||
      available.reduce((n, b) => n + b.maxSources, 0) -
        Math.max(...available.map((b) => b.maxSources)) <
        cap
    )
      throw Error("Release capacity or recovery margin unverified");
    await update(ctx, { enabled: true, evidenceId: evidence.evidenceId });
    return null;
  },
});
