import { v } from "convex/values";
import {
  mutation,
  query,
  internalQuery,
  type DatabaseReader,
} from "./_generated/server";
import { relayContextValidator } from "./_mediaRelayTables";
import { authorizeRelayContext } from "./_mediaRelayAuthorization";
import {
  AdmissionSchema,
  PlaybackGrantSchema,
  PublicContextSchema,
  StreamIdSchema,
  streamKeyFor,
  RELAY_POLICY,
  type Admission,
} from "../packages/media-relay/src";

function positiveBounded(value: string | undefined, max: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= max
    ? parsed
    : 0;
}
function admissionConfig() {
  const sources = positiveBounded(process.env.MEDIA_RELAY_MAX_SOURCES, 1000);
  const grants = positiveBounded(process.env.MEDIA_RELAY_MAX_GRANTS, 10000);
  const perMinute = positiveBounded(
    process.env.MEDIA_RELAY_ADMISSIONS_PER_MINUTE,
    10000,
  );
  return {
    enabled:
      process.env.MEDIA_RELAY_ENABLED === "true" &&
      sources > 0 &&
      grants > 0 &&
      perMinute > 0,
    sources,
    grants,
    perMinute,
  };
}
async function admissionQuota(
  db: DatabaseReader,
  now: number,
  config: ReturnType<typeof admissionConfig>,
  continuing = false,
) {
  const recent = await db
    .query("mediaRelayGrants")
    .withIndex("by_issuedAt", (q) => q.gt("issuedAt", now - 60000))
    .take(config.perMinute);
  const rate = await db
    .query("mediaRelayRestartRate")
    .withIndex("by_key", (q) => q.eq("key", "global"))
    .unique();
  const attempts = (rate?.attempts ?? []).filter((at) => at > now - 60000);
  const active = await db
    .query("mediaRelayGrants")
    .withIndex("by_releasedAt_expiresAt", (q) =>
      q.eq("releasedAt", undefined).gt("expiresAt", now),
    )
    .take(config.grants + (continuing ? 1 : 0));
  return {
    rate,
    attempts,
    limited:
      recent.length + attempts.length >= config.perMinute ||
      (continuing
        ? active.length > config.grants
        : active.length >= config.grants),
  };
}
async function sourceCapacityAvailable(db: DatabaseReader, limit: number) {
  let count = 0;
  for (const state of [
    "queued",
    "starting",
    "ready",
    "recovering",
    "draining",
  ] as const) {
    count += (
      await db
        .query("mediaRelaySources")
        .withIndex("by_state", (q) => q.eq("state", state))
        .take(limit)
    ).length;
  }
  return count < limit;
}
export async function resolveRelayGrant(
  db: DatabaseReader,
  grantId: string,
  now: number,
) {
  const denied = { kind: "denied", reason: "unavailable" } as const;
  if (!admissionConfig().enabled || !Number.isFinite(now)) return denied;
  const row = await db
    .query("mediaRelayGrants")
    .withIndex("by_grantId", (q) => q.eq("grantId", grantId))
    .unique();
  if (
    !row ||
    row.releasedAt !== undefined ||
    now < row.issuedAt ||
    now >= row.expiresAt
  )
    return denied;
  const streamId = row.streamKey.split("/")[1];
  if (!streamId) return denied;
  const authorized = await authorizeRelayContext(
    db,
    row.context,
    streamId,
    now,
    true,
  );
  if (!authorized || authorized.contextRevision !== row.contextRevision)
    return denied;
  const grant = PlaybackGrantSchema.parse({
    id: row.grantId,
    streamKey: row.streamKey,
    context: row.context,
    contextRevision: row.contextRevision,
    issuedAt: row.issuedAt,
    expiresAt: row.expiresAt,
    renditions: ["video", "audio"],
  });
  return { kind: "valid", grant, metadata: authorized.metadata } as const;
}
async function playback(
  db: DatabaseReader,
  grantId: string,
  now: number,
): Promise<Admission> {
  const resolved = await resolveRelayGrant(db, grantId, now);
  if (resolved.kind === "denied")
    return { kind: "unavailable", reason: resolved.reason };
  const source = await db
    .query("mediaRelaySources")
    .withIndex("by_streamKey", (q) =>
      q.eq("streamKey", resolved.grant.streamKey),
    )
    .unique();
  if (!source || ["stopped", "draining", "unavailable"].includes(source.state))
    return {
      kind: "unavailable",
      reason: source?.terminalReason ?? "unavailable",
    };
  // Delivery origin is server configuration, never caller-controlled.
  const origin = process.env.MEDIA_RELAY_PLAYBACK_ORIGIN;
  if (source.state !== "ready" || !origin)
    return { kind: "preparing", grantId, retryAfterMs: 1000 };
  let base: URL;
  try {
    base = new URL(origin);
  } catch {
    return { kind: "unavailable", reason: "unavailable" };
  }
  if (
    base.protocol !== "https:" ||
    base.username ||
    base.password ||
    base.search ||
    base.hash
  )
    return { kind: "unavailable", reason: "unavailable" };
  const prefix = `${base.href.replace(/\/$/, "")}/p/${encodeURIComponent(grantId)}`;
  return AdmissionSchema.parse({
    kind: "ready",
    grant: resolved.grant,
    metadata: resolved.metadata,
    videoPlaylist: `${prefix}/video/index.m3u8`,
    audioPlaylist: `${prefix}/audio/index.m3u8`,
  });
}
export const openPlayback = mutation({
  args: {
    context: relayContextValidator,
    streamId: v.string(),
    preferredMode: v.union(v.literal("audio"), v.literal("video")),
  },
  handler: async (ctx, args): Promise<Admission> => {
    const config = admissionConfig();
    if (!config.enabled) return { kind: "unavailable", reason: "disabled" };
    const context = PublicContextSchema.safeParse(args.context);
    const streamId = StreamIdSchema.safeParse(args.streamId);
    if (!context.success || !streamId.success)
      return { kind: "unavailable", reason: "unsupported" };
    const now = Date.now();
    const authorized = await authorizeRelayContext(
      ctx.db,
      context.data,
      streamId.data,
      now,
      false,
    );
    if (!authorized) return { kind: "unavailable", reason: "unavailable" };
    // Bounded indexed reads, matching existing quota conventions. OCC serializes concurrent admissions.
    if ((await admissionQuota(ctx.db, now, config)).limited)
      return { kind: "capacityLimited", retryAfterMs: 60000 };
    const streamKey = streamKeyFor(streamId.data);
    const source = await ctx.db
      .query("mediaRelaySources")
      .withIndex("by_streamKey", (q) => q.eq("streamKey", streamKey))
      .unique();
    if (
      !source ||
      source.state === "stopped" ||
      source.state === "unavailable"
    ) {
      if (!(await sourceCapacityAvailable(ctx.db, config.sources)))
        return { kind: "capacityLimited", retryAfterMs: 1000 };
      if (source)
        await ctx.db.patch(source._id, {
          state: "queued",
          updatedAt: now,
          progressAt: undefined,
          recoveryStartedAt: undefined,
          terminalReason: undefined,
          admissionRevision: (source.admissionRevision ?? 0) + 1,
        });
      else
        await ctx.db.insert("mediaRelaySources", {
          streamKey,
          streamId: streamId.data,
          inputFormat: "vrcdn_fmp4",
          packagingVersion: 1,
          state: "queued",
          createdAt: now,
          updatedAt: now,
        });
    }
    if (source?.state === "draining")
      return { kind: "capacityLimited", retryAfterMs: 1000 };
    const grantId = crypto.randomUUID();
    await ctx.db.insert("mediaRelayGrants", {
      grantId,
      streamKey,
      context: context.data,
      contextRevision: authorized.contextRevision,
      issuedAt: now,
      expiresAt: now + RELAY_POLICY.grantLifetimeMs,
    });
    return playback(ctx.db, grantId, now);
  },
});
export const getPlayback = query({
  args: { grantId: v.string() },
  handler: (ctx, args): Promise<Admission> =>
    playback(ctx.db, args.grantId, Date.now()),
});
export const releasePlayback = mutation({
  args: { grantId: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("mediaRelayGrants")
      .withIndex("by_grantId", (q) => q.eq("grantId", args.grantId))
      .unique();
    if (row && row.releasedAt === undefined)
      await ctx.db.patch(row._id, { releasedAt: Date.now() });
  },
});
export const resolveGrant = internalQuery({
  args: { grantId: v.string(), now: v.number() },
  handler: (ctx, args) => resolveRelayGrant(ctx.db, args.grantId, args.now),
});

/** Foreground renewal of an existing capability. Never admits or restarts a source. */
export const refreshPlayback = mutation({
  args: { grantId: v.string() },
  handler: async (ctx, args): Promise<Admission> => {
    const now = Date.now();
    const resolved = await resolveRelayGrant(ctx.db, args.grantId, now);
    if (resolved.kind === "denied")
      return { kind: "unavailable", reason: "unavailable" };
    // At most one effective extension per eleven hours. OCC serializes concurrent refreshes.
    if (resolved.grant.expiresAt - now <= 60 * 60 * 1000) {
      const row = await ctx.db
        .query("mediaRelayGrants")
        .withIndex("by_grantId", (q) => q.eq("grantId", args.grantId))
        .unique();
      if (row)
        await ctx.db.patch(row._id, {
          expiresAt: now + RELAY_POLICY.grantLifetimeMs,
        });
    }
    return playback(ctx.db, args.grantId, now);
  },
});

/** Deliberate retry only. Retains a current capability; reads/refresh never call this. */
export const restartPlayback = mutation({
  args: { grantId: v.string() },
  handler: async (ctx, args): Promise<Admission> => {
    const now = Date.now();
    const config = admissionConfig();
    const resolved = await resolveRelayGrant(ctx.db, args.grantId, now);
    if (resolved.kind === "denied") {
      const row = await ctx.db
        .query("mediaRelayGrants")
        .withIndex("by_grantId", (q) => q.eq("grantId", args.grantId))
        .unique();
      return {
        kind: "unavailable",
        reason:
          row && row.releasedAt === undefined && now >= row.expiresAt
            ? "expired"
            : "unavailable",
      };
    }
    const source = await ctx.db
      .query("mediaRelaySources")
      .withIndex("by_streamKey", (q) =>
        q.eq("streamKey", resolved.grant.streamKey),
      )
      .unique();
    if (!source) return { kind: "unavailable", reason: "unavailable" };
    if (source.terminalReason === "unsupported")
      return { kind: "unavailable", reason: "unsupported" };
    if (source.state !== "stopped" && source.state !== "unavailable")
      return playback(ctx.db, args.grantId, now);
    const quota = await admissionQuota(ctx.db, now, config, true);
    if (quota.limited) return { kind: "capacityLimited", retryAfterMs: 60000 };
    if (!(await sourceCapacityAvailable(ctx.db, config.sources)))
      return { kind: "capacityLimited", retryAfterMs: 1000 };
    const attempts = [...quota.attempts, now];
    if (quota.rate) await ctx.db.patch(quota.rate._id, { attempts });
    else
      await ctx.db.insert("mediaRelayRestartRate", { key: "global", attempts });
    await ctx.db.patch(source._id, {
      state: "queued",
      updatedAt: now,
      progressAt: undefined,
      recoveryStartedAt: undefined,
      terminalReason: undefined,
      admissionRevision: (source.admissionRevision ?? 0) + 1,
    });
    return playback(ctx.db, args.grantId, now);
  },
});
