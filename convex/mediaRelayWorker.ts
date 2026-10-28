import { v } from "convex/values";
import { mutation } from "./_generated/server";
import {
  PublishedSnapshotSchema,
  continuityAfter,
  snapshotObjectKey,
  isSnapshotFresh,
  SourceDescriptorSchema,
  SourceStateSchema,
  SourceTerminalReasonSchema,
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
      recoveryStartedAt: row.recoveryStartedAt ?? now,
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
  args: {
    ...ownership,
    state: v.string(),
    progressAt: v.number(),
    terminalReason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    await authority(ctx, args.credential, args);
    const state = SourceStateSchema.parse(args.state);
    const terminalReason =
      args.terminalReason === undefined
        ? undefined
        : SourceTerminalReasonSchema.parse(args.terminalReason);
    if (terminalReason !== undefined && state !== "unavailable")
      throw Error("Invalid terminal reason");
    const candidate = await source(ctx, args.streamKey);
    // Cleanup acknowledgment is not authority: it can only end this exact old
    // ownership and must preserve the last durable progress timestamp.
    if (
      (state === "stopped" || state === "unavailable") &&
      candidate.leaseExpiresAt !== undefined &&
      candidate.leaseExpiresAt <= now
    ) {
      if (
        candidate.owner?.workerId !== args.workerId ||
        candidate.owner?.workerEpoch !== args.workerEpoch ||
        candidate.epoch !== args.epoch ||
        !Number.isFinite(args.progressAt) ||
        args.progressAt < 0 ||
        args.progressAt > (candidate.progressAt ?? 0)
      )
        throw Error("Source cleanup denied");
      await ctx.db.patch(candidate._id, {
        state,
        ...(terminalReason === undefined ? {} : { terminalReason }),
        owner: undefined,
        leaseExpiresAt: undefined,
        updatedAt: now,
      });
      return null;
    }
    const row = await owned(ctx, args, now);
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
      ...(state === "unavailable"
        ? {
            terminalReason:
              terminalReason ?? row.terminalReason ?? "unavailable",
          }
        : {}),
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

// Service-authenticated reads use mutations to share the registration/authority boundary.
export const listSources = mutation({
  args: {
    credential: v.string(),
    workerId: v.string(),
    workerEpoch: v.number(),
  },
  handler: async (ctx, args) => {
    const binding = await authority(ctx, args.credential, args);
    if (process.env.MEDIA_RELAY_ENABLED !== "true")
      throw Error("Relay disabled");
    const now = Date.now();
    const own = await ctx.db
      .query("mediaRelaySources")
      .withIndex("by_owner", (q) => q.eq("owner.workerId", args.workerId))
      .take(binding.maxSources);
    const rows = [...own];
    if (!binding.draining)
      for (const state of [
        "queued",
        "starting",
        "ready",
        "recovering",
      ] as const) {
        const candidates = await ctx.db
          .query("mediaRelaySources")
          .withIndex("by_state_lease", (q) =>
            q.eq("state", state).lte("leaseExpiresAt", now),
          )
          .take(binding.maxSources);
        for (const row of candidates)
          if (
            rows.length < binding.maxSources &&
            !rows.some((r) => r._id === row._id) &&
            (!row.leaseExpiresAt || row.leaseExpiresAt <= now)
          )
            rows.push(row);
      }
    return rows.map((row) => ({
      source: SourceDescriptorSchema.parse({
        streamKey: row.streamKey,
        streamId: row.streamId,
        inputFormat: row.inputFormat,
        packagingVersion: row.packagingVersion,
      }),
      state: row.state,
      admissionRevision: row.admissionRevision ?? 0,
    }));
  },
});
export const readSource = mutation({
  args: ownership,
  handler: async (ctx, args) => {
    await authority(ctx, args.credential, args);
    const row = await owned(ctx, args, Date.now());
    const video = row.snapshots?.video
      ? PublishedSnapshotSchema.parse(row.snapshots.video)
      : undefined;
    const audio = row.snapshots?.audio
      ? PublishedSnapshotSchema.parse(row.snapshots.audio)
      : undefined;
    return {
      recoveryStartedAt: row.recoveryStartedAt ?? row.createdAt,
      ...(row.progressAt === undefined ? {} : { progressAt: row.progressAt }),
      ...(!video && !audio
        ? {}
        : {
            continuity: {
              video: video
                ? continuityAfter(video)
                : { nextSequence: 0, discontinuitySequence: 0 },
              audio: audio
                ? continuityAfter(audio)
                : { nextSequence: 0, discontinuitySequence: 0 },
            },
          }),
    };
  },
});
export const commitSnapshot = mutation({
  args: { ...ownership, snapshot: v.any(), objectKey: v.string() },
  handler: async (ctx, args) => {
    await authority(ctx, args.credential, args);
    if (process.env.MEDIA_RELAY_ENABLED !== "true")
      throw Error("Relay disabled");
    const now = Date.now(),
      row = await owned(ctx, args, now);
    const snapshot = PublishedSnapshotSchema.parse(args.snapshot);
    if (
      snapshot.streamKey !== args.streamKey ||
      snapshot.epoch !== args.epoch ||
      snapshotObjectKey(snapshot) !== args.objectKey ||
      !isSnapshotFresh(snapshot, now) ||
      row.state === "draining" ||
      row.state === "unavailable" ||
      row.state === "stopped"
    )
      throw Error("Publication fenced");
    const previous = row.snapshots?.[snapshot.rendition];
    if (previous) {
      const prior = PublishedSnapshotSchema.parse(previous);
      const next = continuityAfter(prior);
      if (
        continuityAfter(snapshot).nextSequence <= next.nextSequence ||
        snapshot.generatedAt < prior.generatedAt ||
        snapshot.discontinuitySequence < prior.discontinuitySequence
      )
        throw Error("Snapshot out of order");
      if (
        prior.epoch !== snapshot.epoch &&
        (snapshot.sequence < next.nextSequence ||
          snapshot.discontinuitySequence < next.discontinuitySequence ||
          (snapshot.sequence === next.nextSequence &&
            !snapshot.segments[0]?.discontinuity))
      )
        throw Error("Invalid takeover continuity");
    }
    const snapshots = { ...row.snapshots, [snapshot.rendition]: snapshot };
    // Both advertised renditions must progress; one healthy track cannot mask a stalled sibling.
    const video = snapshots.video
      ? PublishedSnapshotSchema.parse(snapshots.video)
      : undefined;
    const audio = snapshots.audio
      ? PublishedSnapshotSchema.parse(snapshots.audio)
      : undefined;
    const progressAt =
      video && audio
        ? Math.min(video.generatedAt, audio.generatedAt)
        : row.progressAt;
    await ctx.db.patch(row._id, {
      snapshots,
      ...(progressAt === undefined ? {} : { progressAt }),
      updatedAt: now,
      ...(video?.epoch === args.epoch && audio?.epoch === args.epoch
        ? { state: "ready" as const }
        : {}),
    });
    return null;
  },
});
