import { v } from "convex/values";
import { mutation } from "./_generated/server";
import {
  SourceStateSchema,
  WorkerObservationSchema,
} from "../packages/media-relay/src";
import {
  authority,
  capacity,
  lease,
  owned,
  register,
  source,
} from "./_mediaRelayControl";
const identity = {
  credential: v.string(),
  workerId: v.string(),
  workerEpoch: v.number(),
  streamKey: v.string(),
};
const ownership = { ...identity, epoch: v.number() };
// Deployment-authenticated RPCs. A browser identity conveys no worker authority.
export const registerWorker = mutation({
  args: { credential: v.string(), observation: v.any() },
  handler: (ctx, args) =>
    register(
      ctx,
      args.credential,
      WorkerObservationSchema.parse(args.observation),
    ),
});
export const claimSource = mutation({
  args: identity,
  handler: async (ctx, args) => {
    const now = Date.now();
    const binding = await authority(ctx, args.credential, args);
    const row = await source(ctx, args.streamKey);
    if (row.leaseExpiresAt !== undefined && row.leaseExpiresAt > now)
      throw Error("Source already leased");
    if (
      row.state === "draining" ||
      row.state === "stopped" ||
      row.state === "unavailable"
    )
      throw Error("Source is not runnable");
    await capacity(ctx, binding, now, false);
    const granted = lease(
      row.streamKey,
      args.workerId,
      (row.epoch ?? 0) + 1,
      now,
    );
    await ctx.db.patch(row._id, {
      epoch: granted.epoch,
      owner: { workerId: args.workerId, workerEpoch: args.workerEpoch },
      leaseExpiresAt: granted.expiresAt,
      state: "starting",
      progressAt: undefined,
      updatedAt: now,
    });
    return granted;
  },
});
export const renewSource = mutation({
  args: ownership,
  handler: async (ctx, args) => {
    const now = Date.now();
    const binding = await authority(ctx, args.credential, args);
    const row = await owned(ctx, args, now);
    await capacity(ctx, binding, now, true);
    if (row.state === "draining") throw Error("Source draining");
    const granted = lease(row.streamKey, args.workerId, args.epoch, now);
    await ctx.db.patch(row._id, {
      leaseExpiresAt: granted.expiresAt,
      updatedAt: now,
    });
    return granted;
  },
});
export const observeSource = mutation({
  args: { ...ownership, state: v.string(), progressAt: v.number() },
  handler: async (ctx, args) => {
    const now = Date.now();
    await authority(ctx, args.credential, args);
    const row = await owned(ctx, args, now);
    const state = SourceStateSchema.parse(args.state);
    if (
      state === "queued" ||
      !Number.isFinite(args.progressAt) ||
      args.progressAt < 0 ||
      args.progressAt > now ||
      args.progressAt < (row.progressAt ?? 0) ||
      (row.state === "draining" &&
        state !== "stopped" &&
        state !== "unavailable" &&
        state !== "draining")
    )
      throw Error("Invalid source observation");
    const terminal = state === "stopped" || state === "unavailable";
    await ctx.db.patch(row._id, {
      state,
      progressAt: args.progressAt,
      updatedAt: now,
      ...(terminal ? { owner: undefined, leaseExpiresAt: undefined } : {}),
    });
    return null;
  },
});
export const releaseSource = mutation({
  args: ownership,
  handler: async (ctx, args) => {
    const now = Date.now();
    await authority(ctx, args.credential, args);
    const row = await owned(ctx, args, now);
    await ctx.db.patch(row._id, {
      owner: undefined,
      leaseExpiresAt: undefined,
      progressAt: undefined,
      state: row.state === "draining" ? "stopped" : "queued",
      updatedAt: now,
    });
    return null;
  },
});
