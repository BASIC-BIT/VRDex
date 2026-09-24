import { membershipCoverage } from "./_collectionCoverage";
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import {
  query,
  mutation,
  type QueryCtx,
  type MutationCtx,
} from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import {
  resolveClubActor,
  readClubVisibility,
  canReadCategory,
} from "./_clubAccess";
import { CLUB_CATEGORIES, clubCategory, type ClubCategory } from "./_clubModel";
import {
  summarizeSeries,
  summarizeSeriesSegment,
  type SeriesPoint,
} from "./_clubAnalyticsMath";
import { CURRENT_FRESHNESS_MS } from "./_communityTelemetry";

const base = { communitySlug: v.string() };
const range = { startAt: v.number(), endAt: v.number() };
const point = v.object({
  at: v.number(),
  value: v.number(),
  coverage: v.string(),
});
const summary = v.object({
  peak: v.union(v.number(), v.null()),
  average: v.union(v.number(), v.null()),
  playerHours: v.union(v.number(), v.null()),
  lastValue: v.union(v.number(), v.null()),
  coverageRatio: v.number(),
});
const preferences = v.object({
  widgets: v.array(v.string()),
  rangeDays: v.union(v.literal(7), v.literal(30), v.literal(90)),
});
const sessionView = v.object({
  id: v.id("instanceSessions"),
  worldId: v.string(),
  worldName: v.union(v.string(), v.null()),
  providerInstanceId: v.string(),
  openedAt: v.number(),
  closedAt: v.union(v.number(), v.null()),
  lastObservedAt: v.number(),
  state: v.union(v.literal("open"), v.literal("closed")),
  now: v.number(),
  liveObservedAt: v.union(v.number(), v.null()),
});
const pageReturn = v.object({
  page: v.array(point),
  isDone: v.boolean(),
  continueCursor: v.string(),
  before: v.union(point, v.null()),
  after: v.union(point, v.null()),
});
const DEFAULTS = {
  widgets: ["current", "activity", "membership", "instances", "recaps"],
  rangeDays: 30 as const,
};

async function context(ctx: QueryCtx | MutationCtx, slug: string) {
  const community = await ctx.db
    .query("profiles")
    .withIndex("by_slug", (q) => q.eq("slug", slug.trim().toLowerCase()))
    .unique();
  if (!community || community.profileType !== "community")
    throw new Error("Club not found.");
  const actor = await resolveClubActor(ctx, community._id);
  if (actor.kind === "none" || !actor.subject)
    throw new Error("You do not have access to this page.");
  const visibility = await readClubVisibility(ctx.db, community._id);
  const integration = await ctx.db
    .query("communityVrchatIntegrations")
    .withIndex("by_communityProfileId", (q) =>
      q.eq("communityProfileId", community._id),
    )
    .first();
  return {
    community,
    actor,
    integration,
    epoch: integration?.telemetryEpochStartedAt ?? integration?.createdAt ?? 0,
    allowed: (category: ClubCategory) =>
      canReadCategory(actor, visibility, category),
  };
}
function requireCategory(
  state: Awaited<ReturnType<typeof context>>,
  category: ClubCategory,
) {
  if (!state.allowed(category))
    throw new Error("You do not have access to this category.");
}
function checkedRange(startAt: number, endAt: number, maxDays = 93) {
  if (
    !Number.isSafeInteger(startAt) ||
    !Number.isSafeInteger(endAt) ||
    startAt >= endAt ||
    endAt - startAt > maxDays * 86400_000
  )
    throw new Error("Invalid analytics range.");
}
function checkedPagination(opts: { numItems: number; cursor: string | null }) {
  if (
    !Number.isInteger(opts.numItems) ||
    opts.numItems < 1 ||
    opts.numItems > 500
  )
    throw new Error("Choose a page size between 1 and 500.");
  return opts;
}
function populationPoint(
  row: Doc<"communityPopulationObservations">,
): SeriesPoint {
  return {
    at: row.observedAt,
    value: row.totalPopulation,
    coverage: row.coverageState,
  };
}
function memberPoint(
  row: Doc<"communityMemberCountObservations">,
): SeriesPoint {
  return {
    at: row.observedAt,
    value: row.memberCount,
    coverage: row.coverageState,
  };
}
function instancePoint(
  row: Doc<"instancePopulationObservations">,
): SeriesPoint {
  return {
    at: row.observedAt,
    value: row.population,
    coverage: row.coverageState,
  };
}
async function preferencesFor(
  ctx: QueryCtx | MutationCtx,
  communityProfileId: Id<"profiles">,
  subjectTokenIdentifier: string,
  scope: "club" | "personal",
) {
  return ctx.db
    .query("communityDashboardPreferences")
    .withIndex("by_communityProfileId_scope_subject", (q) =>
      q
        .eq("communityProfileId", communityProfileId)
        .eq("scope", scope)
        .eq("subjectTokenIdentifier", subjectTokenIdentifier),
    )
    .unique();
}
async function sessionLiveness(
  ctx: QueryCtx,
  state: Awaited<ReturnType<typeof context>>,
  now: number,
) {
  const integration = state.integration;
  if (
    !integration ||
    integration.killSwitchEnabled ||
    !["active", "degraded"].includes(integration.state) ||
    (integration.enabledFeatures && !integration.enabledFeatures.includes("analytics"))
  )
    return (_session: Doc<"instanceSessions">): number | null => null;
  // A later group success cannot renew an unseen session. Retain the most
  // recent explicit stop even when collection has since resumed.
  const stops = await Promise.all(
    (["estimated", "stale", "unknown", "degraded"] as const).map((coverage) =>
      ctx.db
        .query("collectionCoverageWindows")
        .withIndex("by_integrationId_state_startedAt", (q) =>
          q.eq("integrationId", integration._id)
            .eq("state", coverage)
            .gte("startedAt", state.epoch)
            .lte("startedAt", now),
        )
        .order("desc")
        .first(),
    ),
  );
  const stoppedAt = Math.max(
    state.epoch,
    ...stops.map((row) => row?.startedAt ?? state.epoch),
  );
  return (session: Doc<"instanceSessions">): number | null =>
    session.state === "open" &&
    session.openedAt >= state.epoch &&
    session.lastObservedAt >= Math.max(session.openedAt, stoppedAt) &&
    session.lastObservedAt <= now &&
    now - session.lastObservedAt <= CURRENT_FRESHNESS_MS
      ? session.lastObservedAt
      : null;
}
async function projectSession(
  ctx: QueryCtx,
  session: Doc<"instanceSessions">,
  now: number,
  liveObservedAt: number | null,
) {
  const world = session.worldId ? await ctx.db.get(session.worldId) : null;
  return {
    id: session._id,
    worldId: session.vrchatWorldId,
    worldName: world?.displayName ?? null,
    providerInstanceId: session.providerInstanceId,
    openedAt: session.openedAt,
    closedAt: session.closedAt ?? null,
    lastObservedAt: session.lastObservedAt,
    state: session.state,
    now,
    liveObservedAt,
  };
}

export const getContext = query({
  args: { ...base, freshnessNonce: v.optional(v.string()) },
  returns: v.object({
    epochStartedAt: v.union(v.number(), v.null()),
    now: v.number(),
    current: v.object({
      population: v.optional(v.number()),
      activeInstances: v.optional(v.number()),
      groupMemberCount: v.optional(v.number()),
      observedAt: v.optional(v.number()),
    }),
    readableCategories: v.array(clubCategory),
    preferences,
    clubDefaults: preferences,
    savedPersonal: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const state = await context(ctx, args.communitySlug);
    const defaults = await preferencesFor(ctx, state.community._id, "", "club");
    const personal = await preferencesFor(
      ctx,
      state.community._id,
      state.actor.subject!.tokenIdentifier,
      "personal",
    );
    const clubDefaults = defaults
      ? { widgets: defaults.widgets, rangeDays: defaults.rangeDays }
      : DEFAULTS;
    const now = Date.now();
    const population =
      state.integration && state.allowed("current_population")
        ? await ctx.db
            .query("communityPopulationObservations")
            .withIndex("by_integrationId_observedAt", (q) =>
              q
                .eq("integrationId", state.integration!._id)
                .gte("observedAt", state.epoch),
            )
            .order("desc")
            .first()
        : null;
    const members =
      state.integration && state.allowed("group_size")
        ? await ctx.db
            .query("communityMemberCountObservations")
            .withIndex("by_integrationId_observedAt", (q) =>
              q
                .eq("integrationId", state.integration!._id)
                .gte("observedAt", state.epoch),
            )
            .order("desc")
            .first()
        : null;
    const fresh =
      population &&
      (!state.integration?.enabledFeatures ||
        state.integration.enabledFeatures.includes("analytics")) &&
      population.coverageState === "observed" &&
      now - population.observedAt <= CURRENT_FRESHNESS_MS &&
      state.integration?.state !== "disconnected" &&
      state.integration?.state !== "disconnecting";
    return {
      epochStartedAt: state.integration ? state.epoch : null,
      now,
      current: {
        ...(fresh
          ? {
              population: population.totalPopulation,
              activeInstances: population.activeInstanceCount,
              observedAt: population.observedAt,
            }
          : {}),
        ...(members ? { groupMemberCount: members.memberCount } : {}),
      },
      readableCategories: CLUB_CATEGORIES.filter(state.allowed),
      preferences: personal
        ? { widgets: personal.widgets, rangeDays: personal.rangeDays }
        : clubDefaults,
      clubDefaults,
      savedPersonal: !!personal,
    };
  },
});

export const getBucket = query({
  args: { ...base, ...range, freshnessNonce: v.optional(v.string()) },
  returns: v.object({
    ...range,
    now: v.number(),
    complete: v.boolean(),
    population: v.union(summary, v.null()),
    membership: v.union(
      v.null(),
      v.object({
        lastValue: v.union(v.number(), v.null()),
        observedAt: v.union(v.number(), v.null()),
        netChange: v.union(v.number(), v.null()),
        continuous: v.boolean(),
        continuousUntil: v.union(v.number(), v.null()),
      }),
    ),
  }),
  handler: async (ctx, args) => {
    checkedRange(args.startAt, args.endAt, 26 / 24);
    const now = Date.now();
    const state = await context(ctx, args.communitySlug);
    if (!state.integration || args.endAt <= state.epoch)
      return {
        now,
        startAt: args.startAt,
        endAt: args.endAt,
        complete: true,
        population: null,
        membership: null,
      };
    const integrationId = state.integration._id,
      startAt = Math.max(state.epoch, args.startAt),
      endAt = args.endAt;
    let population: ReturnType<typeof summarizeSeries> | null = null,
      membership: {
        lastValue: number | null;
        observedAt: number | null;
        netChange: number | null;
        continuous: boolean;
        continuousUntil: number | null;
      } | null = null,
      complete = true;
    if (state.allowed("population_history")) {
      const rows = await ctx.db
        .query("communityPopulationObservations")
        .withIndex("by_integrationId_observedAt", (q) =>
          q
            .eq("integrationId", integrationId)
            .gte("observedAt", startAt)
            .lt("observedAt", endAt),
        )
        .take(5001);
      const before = await ctx.db
        .query("communityPopulationObservations")
        .withIndex("by_integrationId_observedAt", (q) =>
          q
            .eq("integrationId", integrationId)
            .gte("observedAt", state.epoch)
            .lt("observedAt", startAt),
        )
        .order("desc")
        .first();
      const after = await ctx.db
        .query("communityPopulationObservations")
        .withIndex("by_integrationId_observedAt", (q) =>
          q
            .eq("integrationId", integrationId)
            .gte("observedAt", endAt)
            .lte("observedAt", endAt + 300_000),
        )
        .first();
      if (rows.length > 5000) complete = false;
      else
        population = summarizeSeries(
          [...(before ? [before] : []), ...rows, ...(after ? [after] : [])].map(
            populationPoint,
          ),
          args.startAt,
          endAt,
        );
    }
    if (state.allowed("group_size") || state.allowed("membership_movement")) {
      const before = await ctx.db
        .query("communityMemberCountObservations")
        .withIndex("by_integrationId_observedAt", (q) =>
          q
            .eq("integrationId", integrationId)
            .gte("observedAt", state.epoch)
            .lt("observedAt", startAt),
        )
        .order("desc")
        .first();
      const latest = await ctx.db
        .query("communityMemberCountObservations")
        .withIndex("by_integrationId_observedAt", (q) =>
          q
            .eq("integrationId", integrationId)
            .gte("observedAt", state.epoch)
            .lt("observedAt", endAt),
        )
        .order("desc")
        .first();
      const coverage = state.allowed("group_size")
        ? await membershipCoverage(
            ctx,
            integrationId,
            startAt,
            endAt,
            state.epoch,
          )
        : null;
      if (coverage && !coverage.complete) complete = false;
      const coveringInterval =
        startAt <= now
          ? coverage?.intervals.find(
              (interval) =>
                interval.startAt <= startAt &&
                interval.endAt >= Math.min(endAt, now),
            )
          : undefined;
      const continuous = !!coveringInterval;
      // Fully covered historical days never age out. Open-day continuity keeps
      // the original collection deadline, independently of query rerenders.
      const continuousUntil =
        coveringInterval && coveringInterval.endAt < endAt
          ? coveringInterval.endAt
          : null;
      const visibleLatest =
        latest?.coverageState === "observed" &&
        (latest.observedAt >= startAt || continuous)
          ? latest
          : null;
      membership = {
        continuous,
        continuousUntil,
        lastValue: state.allowed("group_size")
          ? (visibleLatest?.memberCount ?? null)
          : null,
        observedAt: state.allowed("group_size")
          ? (visibleLatest?.observedAt ?? null)
          : null,
        netChange:
          state.allowed("membership_movement") && before && latest
            ? latest.memberCount - before.memberCount
            : null,
      };
    }
    return {
      now,
      startAt: args.startAt,
      endAt: args.endAt,
      complete,
      population,
      membership,
    };
  },
});

export const getMembershipCoverage = query({
  args: { ...base, ...range },
  returns: v.object({ complete: v.boolean(), intervals: v.array(v.object(range)) }),
  handler: async (ctx, args) => {
    checkedRange(args.startAt, args.endAt, 26 / 24);
    const state = await context(ctx, args.communitySlug);
    requireCategory(state, "group_size");
    if (!state.integration || args.endAt <= state.epoch)
      return { complete: true, intervals: [] };
    return membershipCoverage(ctx, state.integration._id, Math.max(args.startAt, state.epoch), args.endAt, state.epoch);
  },
});

export const getSeries = query({
  args: {
    ...base,
    ...range,
    kind: v.union(v.literal("population"), v.literal("members")),
    paginationOpts: paginationOptsValidator,
  },
  returns: pageReturn,
  handler: async (ctx, args) => {
    checkedRange(args.startAt, args.endAt);
    const state = await context(ctx, args.communitySlug);
    requireCategory(
      state,
      args.kind === "population" ? "population_history" : "group_size",
    );
    if (!state.integration || args.endAt <= state.epoch)
      return {
        page: [],
        isDone: true,
        continueCursor: "",
        before: null,
        after: null,
      };
    const integrationId = state.integration._id,
      startAt = Math.max(state.epoch, args.startAt),
      endAt = args.endAt,
      opts = checkedPagination(args.paginationOpts);
    if (args.kind === "population") {
      const result = await ctx.db
        .query("communityPopulationObservations")
        .withIndex("by_integrationId_observedAt", (q) =>
          q
            .eq("integrationId", integrationId)
            .gte("observedAt", startAt)
            .lt("observedAt", endAt),
        )
        .paginate(opts);
      const before = await ctx.db
        .query("communityPopulationObservations")
        .withIndex("by_integrationId_observedAt", (q) =>
          q
            .eq("integrationId", integrationId)
            .gte("observedAt", state.epoch)
            .lt("observedAt", startAt),
        )
        .order("desc")
        .first();
      const after = await ctx.db
        .query("communityPopulationObservations")
        .withIndex("by_integrationId_observedAt", (q) =>
          q
            .eq("integrationId", integrationId)
            .gte("observedAt", endAt)
            .lte("observedAt", endAt + 300_000),
        )
        .first();
      return {
        page: result.page.map(populationPoint),
        isDone: result.isDone,
        continueCursor: result.continueCursor,
        before: before ? populationPoint(before) : null,
        after: after ? populationPoint(after) : null,
      };
    }
    const result = await ctx.db
      .query("communityMemberCountObservations")
      .withIndex("by_integrationId_observedAt", (q) =>
        q
          .eq("integrationId", integrationId)
          .gte("observedAt", startAt)
          .lt("observedAt", endAt),
      )
      .paginate(opts);
    const before = await ctx.db
      .query("communityMemberCountObservations")
      .withIndex("by_integrationId_observedAt", (q) =>
        q
          .eq("integrationId", integrationId)
          .gte("observedAt", state.epoch)
          .lt("observedAt", startAt),
      )
      .order("desc")
      .first();
    return {
      page: result.page.map(memberPoint),
      isDone: result.isDone,
      continueCursor: result.continueCursor,
      before: before ? memberPoint(before) : null,
      after: null,
    };
  },
});

// Empty filtered pages still need a clock without changing pagination arguments.
export const getInstanceListClock = query({
  args: { ...base, freshnessNonce: v.string() },
  returns: v.number(),
  handler: async (ctx, args) => {
    const state = await context(ctx, args.communitySlug);
    requireCategory(state, "instance_history");
    return Date.now();
  },
});

export const listInstances = query({
  args: {
    ...base,
    kind: v.union(v.literal("live"), v.literal("past"), v.literal("history")),
    freshnessNonce: v.optional(v.string()),
    paginationOpts: paginationOptsValidator,
  },
  returns: v.object({
    page: v.array(sessionView),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, args) => {
    const state = await context(ctx, args.communitySlug);
    requireCategory(state, "instance_history");
    if (!state.integration)
      return { page: [], isDone: true, continueCursor: "" };
    const now = Date.now();
    const liveObservedAt = await sessionLiveness(ctx, state, now);
    const result = await ctx.db
      .query("instanceSessions")
      .withIndex("by_communityProfileId_openedAt", (q) =>
        q
          .eq("communityProfileId", state.community._id)
          .gte("openedAt", state.epoch),
      )
      .order("desc")
      .paginate(checkedPagination(args.paginationOpts));
    return {
      page: await Promise.all(
        result.page
          .filter((session) =>
            session.integrationId === state.integration!._id &&
            (args.kind === "live"
              ? liveObservedAt(session) !== null
              : args.kind === "past" ? session.state === "closed" : true),
          )
          .map((session) => projectSession(ctx, session, now, liveObservedAt(session))),
      ),
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});
async function requireSession(
  ctx: QueryCtx,
  communitySlug: string,
  sessionId: Id<"instanceSessions">,
) {
  const state = await context(ctx, communitySlug);
  requireCategory(state, "instance_history");
  const session = await ctx.db.get(sessionId);
  if (
    !session ||
    session.integrationId !== state.integration?._id ||
    session.communityProfileId !== state.community._id ||
    session.openedAt < state.epoch
  )
    throw new Error("Instance not found.");
  return { state, session };
}
export const getInstance = query({
  args: { ...base, sessionId: v.string(), freshnessNonce: v.optional(v.string()) },
  returns: v.union(sessionView, v.null()),
  handler: async (ctx, args) => {
    const state = await context(ctx, args.communitySlug);
    if (!state.allowed("instance_history")) return null;
    const sessionId = ctx.db.normalizeId("instanceSessions", args.sessionId);
    if (!sessionId) return null;
    const session = await ctx.db.get(sessionId);
    if (
      !session ||
      session.integrationId !== state.integration?._id ||
      session.communityProfileId !== state.community._id ||
      session.openedAt < state.epoch
    )
      return null;
    const now = Date.now();
    const liveObservedAt = await sessionLiveness(ctx, state, now);
    return projectSession(ctx, session, now, liveObservedAt(session));
  },
});
export const getInstanceSeries = query({
  args: {
    ...base,
    ...range,
    sessionId: v.id("instanceSessions"),
    paginationOpts: paginationOptsValidator,
  },
  returns: pageReturn,
  handler: async (ctx, args) => {
    checkedRange(args.startAt, args.endAt, Infinity);
    const { state, session } = await requireSession(
      ctx,
      args.communitySlug,
      args.sessionId,
    );
    const startAt = Math.max(state.epoch, session.openedAt, args.startAt),
      endAt = args.endAt;
    if (endAt <= startAt)
      return {
        page: [],
        isDone: true,
        continueCursor: "",
        before: null,
        after: null,
      };
    const result = await ctx.db
      .query("instancePopulationObservations")
      .withIndex("by_sessionId_observedAt", (q) =>
        q
          .eq("sessionId", session._id)
          .gte("observedAt", startAt)
          .lt("observedAt", endAt),
      )
      .paginate(checkedPagination(args.paginationOpts));
    const before = await ctx.db
      .query("instancePopulationObservations")
      .withIndex("by_sessionId_observedAt", (q) =>
        q
          .eq("sessionId", session._id)
          .gte("observedAt", Math.max(state.epoch, session.openedAt))
          .lt("observedAt", startAt),
      )
      .order("desc")
      .first();
    const after = await ctx.db
      .query("instancePopulationObservations")
      .withIndex("by_sessionId_observedAt", (q) =>
        q
          .eq("sessionId", session._id)
          .gte("observedAt", endAt)
          .lte("observedAt", endAt + 300_000),
      )
      .first();
    return {
      page: result.page.map(instancePoint),
      isDone: result.isDone,
      continueCursor: result.continueCursor,
      before: before ? instancePoint(before) : null,
      after: after ? instancePoint(after) : null,
    };
  },
});

/** Lifetime list metrics without downloading lifetime observations to the browser. */
export const getInstanceSummaryPage = query({
  args: {
    ...base,
    ...range,
    sessionId: v.id("instanceSessions"),
    paginationOpts: paginationOptsValidator,
  },
  returns: v.object({
    page: v.array(
      v.object({
        peak: v.union(v.number(), v.null()),
        area: v.number(),
        observedDuration: v.number(),
        first: v.union(point, v.null()),
        last: v.union(point, v.null()),
      }),
    ),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, args) => {
    checkedRange(args.startAt, args.endAt, Infinity);
    const { state, session } = await requireSession(
      ctx,
      args.communitySlug,
      args.sessionId,
    );
    const startAt = Math.max(state.epoch, session.openedAt, args.startAt);
    const endAt = Math.min(args.endAt, session.closedAt ?? args.endAt);
    const opts = checkedPagination(args.paginationOpts);
    if (endAt <= startAt) return { page: [], isDone: true, continueCursor: "" };
    const result = await ctx.db
      .query("instancePopulationObservations")
      .withIndex("by_sessionId_observedAt", (q) =>
        q
          .eq("sessionId", session._id)
          .gte("observedAt", startAt)
          .lt("observedAt", endAt),
      )
      .paginate(opts);
    const points = result.page.map(instancePoint);
    if (opts.cursor === null) {
      const before = await ctx.db
        .query("instancePopulationObservations")
        .withIndex("by_sessionId_observedAt", (q) =>
          q
            .eq("sessionId", session._id)
            .gte("observedAt", Math.max(state.epoch, session.openedAt))
            .lt("observedAt", startAt),
        )
        .order("desc")
        .first();
      if (before) points.unshift(instancePoint(before));
    }
    if (result.isDone) {
      const after = await ctx.db
        .query("instancePopulationObservations")
        .withIndex("by_sessionId_observedAt", (q) =>
          q
            .eq("sessionId", session._id)
            .gte("observedAt", endAt)
            .lte(
              "observedAt",
              Math.min(endAt + 300_000, session.closedAt ?? endAt + 300_000),
            ),
        )
        .first();
      if (after) points.push(instancePoint(after));
    }
    // Boundary samples close real observed intervals, never an invented tail.
    return {
      page: points.length
        ? [summarizeSeriesSegment(points, startAt, endAt)]
        : [],
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

export const listAssociationSuggestions = query({
  args: { ...base, paginationOpts: paginationOptsValidator },
  returns: v.object({
    page: v.array(v.object({
      id: v.id("eventInstanceAssociations"),
      eventTitle: v.union(v.string(), v.null()),
      sessionId: v.union(v.id("instanceSessions"), v.null()),
      worldName: v.union(v.string(), v.null()),
      openedAt: v.union(v.number(), v.null()),
      confidence: v.number(),
      canConfirm: v.boolean(),
    })),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, args) => {
    const state = await context(ctx, args.communitySlug);
    if (state.actor.kind !== "owner" && !state.actor.permissions.includes("manage_events"))
      throw new Error("You do not have access to this action.");
    requireCategory(state, "event_recaps");
    if (!state.integration ||
      (state.integration.enabledFeatures && !state.integration.enabledFeatures.includes("analytics")))
      return { page: [], isDone: true, continueCursor: "" };
    const result = await ctx.db.query("eventInstanceAssociations")
      .withIndex("by_communityProfileId_state", (q) =>
        q.eq("communityProfileId", state.community._id).eq("state", "suggested"))
      .paginate(checkedPagination(args.paginationOpts));
    const page = await Promise.all(result.page.map(async (association) => {
      const [event, session] = await Promise.all([
        ctx.db.get(association.eventId),
        ctx.db.get(association.sessionId),
      ]);
      const world = session?.worldId ? await ctx.db.get(session.worldId) : null;
      const confirmed = session ? await ctx.db.query("eventInstanceAssociations")
        .withIndex("by_sessionId_state", (q) => q.eq("sessionId", session._id).eq("state", "confirmed"))
        .first() : null;
      const validSession = !!session && session.communityProfileId === state.community._id &&
        session.integrationId === state.integration!._id && session.openedAt >= state.epoch;
      const validEvent = !!event && event.communityProfileId === state.community._id;
      return {
        id: association._id,
        eventTitle: validEvent ? event.title : null,
        sessionId: validSession ? session._id : null,
        worldName: validSession ? world?.displayName ?? null : null,
        openedAt: validSession ? session.openedAt : null,
        confidence: association.confidence,
        canConfirm: validEvent && validSession && !confirmed,
      };
    }));
    return { page, isDone: result.isDone, continueCursor: result.continueCursor };
  },
});

export const listEventRecaps = query({
  args: { ...base, ...range, paginationOpts: paginationOptsValidator },
  returns: v.object({
    page: v.array(
      v.object({
        id: v.id("communityTelemetryRollups"),
        eventId: v.id("events"),
        title: v.string(),
        slug: v.union(v.string(), v.null()),
        startAt: v.number(),
        endAt: v.number(),
        peak: v.number(),
        playerHours: v.number(),
        coverageRatio: v.number(),
        groupMemberCount: v.optional(v.number()),
        netChange: v.optional(v.number()),
      }),
    ),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, args) => {
    checkedRange(args.startAt, args.endAt);
    const state = await context(ctx, args.communitySlug);
    requireCategory(state, "event_recaps");
    if (!state.integration || args.endAt <= state.epoch)
      return { page: [], isDone: true, continueCursor: "" };
    const result = await ctx.db
      .query("communityTelemetryRollups")
      .withIndex("by_communityProfileId_grain_bucketStartAt", (q) =>
        q
          .eq("communityProfileId", state.community._id)
          .eq("grain", "event")
          .gte("bucketStartAt", Math.max(args.startAt, state.epoch))
          .lt("bucketStartAt", args.endAt),
      )
      .order("desc")
      .paginate(checkedPagination(args.paginationOpts));
    const page = [];
    for (const row of result.page) {
      if (!row.eventId) continue;
      const event = await ctx.db.get(row.eventId);
      if (
        !event ||
        event.communityProfileId !== state.community._id ||
        event.publicationState !== "published"
      )
        continue;
      page.push({
        id: row._id,
        eventId: event._id,
        title: event.title,
        slug: event.slug ?? null,
        startAt: row.bucketStartAt,
        endAt: row.bucketEndAt,
        peak: row.peakConcurrency,
        playerHours: row.playerMinutes / 60,
        coverageRatio: row.coverageRatio,
        ...(state.allowed("group_size") && row.groupMemberCount !== undefined
          ? { groupMemberCount: row.groupMemberCount }
          : {}),
        ...(state.allowed("membership_movement") &&
        row.groupMemberGrowth !== undefined
          ? { netChange: row.groupMemberGrowth }
          : {}),
      });
    }
    return {
      page,
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});
export const savePreferences = mutation({
  args: {
    ...base,
    scope: v.union(v.literal("club"), v.literal("personal")),
    ...preferences.fields,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const state = await context(ctx, args.communitySlug);
    if (args.scope === "club" && state.actor.kind !== "owner")
      throw new Error("Only the club owner can change the default dashboard.");
    if (
      args.widgets.length > DEFAULTS.widgets.length ||
      new Set(args.widgets).size !== args.widgets.length ||
      args.widgets.some((id) => !DEFAULTS.widgets.includes(id))
    )
      throw new Error("Invalid dashboard widgets.");
    const subjectTokenIdentifier =
      args.scope === "club" ? "" : state.actor.subject!.tokenIdentifier;
    const saved = await preferencesFor(
      ctx,
      state.community._id,
      subjectTokenIdentifier,
      args.scope,
    );
    const values = {
      communityProfileId: state.community._id,
      scope: args.scope,
      subjectTokenIdentifier,
      widgets: args.widgets,
      rangeDays: args.rangeDays,
      updatedAt: Date.now(),
    };
    if (saved) await ctx.db.patch(saved._id, values);
    else await ctx.db.insert("communityDashboardPreferences", values);
    return null;
  },
});
export const resetPersonalPreferences = mutation({
  args: base,
  returns: v.null(),
  handler: async (ctx, args) => {
    const state = await context(ctx, args.communitySlug);
    const saved = await preferencesFor(
      ctx,
      state.community._id,
      state.actor.subject!.tokenIdentifier,
      "personal",
    );
    if (saved) await ctx.db.delete(saved._id);
    return null;
  },
});
