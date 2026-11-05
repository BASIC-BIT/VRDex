import { ConvexError, v, type Infer } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx } from "./_generated/server";
import { requireActiveBrowserSessionSubject } from "./_browserSessionAuthority";
import {
  allowedDirections, boardEnabled, connectorDirection, connectorKind, connectorMode, connectorState, connectorTarget, connectorsEnabled,
  DISCORD_ID, discordScheduledEventsEnabled, requireConnectorAuthority, type ConnectorDirection, type ConnectorKind,
} from "./_eventConnectors";
import { enqueueSyncJob, removeConnector } from "./_eventSync";
import { MINIMUM_COMMUNITY_CONTROL_LEVEL, requireControlProof } from "./_externalControl";
import { googleCalendarEnabled, revokeCredentialIfUnused } from "./_googleCalendar";
import { canManageCalendarEvents, vrchatCalendarReadiness } from "./_vrchatCalendarConnector";
import { vrchatCalendarEnabled } from "./eventSyncKinds/vrchatCalendar";

type ConnectorTarget = Infer<typeof connectorTarget>;
const TARGET_IDS = ["guildId", "channelId", "calendarId", "groupId"] as const;
const TARGET_NAMES = ["guildName", "channelName", "calendarName", "groupName"] as const;
const PUBLIC_TARGET_KEYS: ReadonlyArray<string> = [...TARGET_IDS, ...TARGET_NAMES];
const publicTarget = (target: ConnectorTarget) => Object.fromEntries(Object.entries(target).filter(([key]) => PUBLIC_TARGET_KEYS.includes(key))) as ConnectorTarget;

const fail = (code: string): never => { throw new ConvexError({ code }); };

function requireEnabled() {
  if (!connectorsEnabled()) fail("CONNECTORS_DISABLED");
}

function requireDirection(kind: ConnectorKind, direction: ConnectorDirection) {
  if (!allowedDirections(kind).includes(direction)) fail("CONNECTOR_DIRECTION_INVALID");
}

type TargetId = (typeof TARGET_IDS)[number];
type CreatableKind = Exclude<ConnectorKind, "notion" | "discord_announcements">;
// Each kind names its target with exactly these IDs. Notion is reserved and never reaches this.
const KIND_TARGET_IDS: Record<CreatableKind, TargetId[]> = {
  discord_board: ["guildId", "channelId"],
  discord_scheduled_events: ["guildId"],
  google_calendar: ["calendarId"],
  vrchat_calendar: ["groupId"],
};

function requireTarget(kind: CreatableKind, target: ConnectorTarget) {
  const required = KIND_TARGET_IDS[kind];
  // Only a calendar group keeps its zone; every other non-public key belongs to the sync engine.
  if (!Object.keys(target).every(key => PUBLIC_TARGET_KEYS.includes(key) || (kind === "vrchat_calendar" && key === "timezone"))) fail("CONNECTOR_TARGET");
  for (const key of TARGET_IDS) if ((target[key] === undefined) === required.includes(key)) fail("CONNECTOR_TARGET");
  for (const key of ["guildId", "channelId"] as const) if (target[key] !== undefined && !DISCORD_ID.test(target[key])) fail("CONNECTOR_TARGET");
  for (const key of ["calendarId", "groupId"] as const) if ((target[key]?.length ?? 0) > 256) fail("CONNECTOR_TARGET");
  for (const key of TARGET_NAMES) if ((target[key]?.length ?? 0) > 100) fail("CONNECTOR_TARGET");
}

function acceptedTimezone(timeZone: string | undefined) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return timeZone ?? "UTC";
  } catch {
    return "UTC";
  }
}

// A VRChat group has one calendar, so the target is the community's connected group; a caller's IDs never reach it.
async function vrchatCalendarTarget(ctx: MutationCtx, communityProfileId: Id<"profiles">, timezone: string | undefined): Promise<ConnectorTarget> {
  if (!vrchatCalendarEnabled()) fail("CONNECTOR_UNAVAILABLE");
  const readiness = await vrchatCalendarReadiness(ctx.db, communityProfileId);
  if (!readiness.ready) return fail("CONNECTOR_UNAVAILABLE");
  // Every job this connector enqueues re-checks manage_events on the authority.
  if (!await canManageCalendarEvents(ctx, communityProfileId)) fail("CONNECTOR_FORBIDDEN");
  return { groupId: readiness.integration.vrchatGroupId, timezone: acceptedTimezone(timezone) };
}

// Loads the connector and authorizes the caller against its stored community, never a caller-supplied one.
async function authorizedConnector(ctx: MutationCtx, connectorId: Id<"eventConnectors">) {
  const { userId } = await requireActiveBrowserSessionSubject(ctx);
  requireEnabled();
  const connector = await ctx.db.get(connectorId);
  if (!connector) return fail("CONNECTOR_FORBIDDEN");
  await requireConnectorAuthority(ctx, connector.communityProfileId, userId);
  return { userId, connector };
}

const reconcile = (ctx: MutationCtx, connectorId: Id<"eventConnectors">) => enqueueSyncJob(ctx.db, ctx.scheduler, { connectorId, kind: "reconcile" });

const connectorView = v.object({
  connectorId: v.id("eventConnectors"), kind: connectorKind, direction: connectorDirection, mode: connectorMode, state: connectorState,
  target: connectorTarget, lastSyncedAt: v.optional(v.number()), lastError: v.optional(v.string()),
});

export const listForCommunity = query({ args: { communityProfileId: v.id("profiles") }, returns: v.object({ enabled: v.boolean(), connectors: v.array(connectorView) }), handler: async (ctx, { communityProfileId }) => {
  const { userId } = await requireActiveBrowserSessionSubject(ctx);
  if (!connectorsEnabled()) return { enabled: false, connectors: [] };
  await requireConnectorAuthority(ctx, communityProfileId, userId);
  const rows = await ctx.db.query("eventConnectors").withIndex("by_communityProfileId", q => q.eq("communityProfileId", communityProfileId)).collect();
  return { enabled: true, connectors: rows.filter(row => row.state !== "removed").map(row => ({
    connectorId: row._id, kind: row.kind, direction: row.direction, mode: row.mode, state: row.state,
    target: publicTarget(row.target), lastSyncedAt: row.lastSyncedAt, lastError: row.lastError,
  })) };
} });

export const create = mutation({
  args: { communityProfileId: v.id("profiles"), kind: connectorKind, direction: connectorDirection, mode: connectorMode, target: connectorTarget, credentialId: v.optional(v.id("connectorCredentials")) },
  returns: v.id("eventConnectors"),
  handler: async (ctx, args) => {
    const { userId } = await requireActiveBrowserSessionSubject(ctx);
    requireEnabled();
    if ((await ctx.db.get(args.communityProfileId))?.profileType !== "community") fail("CONNECTOR_FORBIDDEN");
    await requireConnectorAuthority(ctx, args.communityProfileId, userId);
    // Discord announcements connect only through the slash command or the site flow, which prove guild control.
    if (args.kind === "notion" || args.kind === "discord_announcements") return fail("CONNECTOR_KIND_RESERVED");
    if (args.kind === "google_calendar" && !googleCalendarEnabled()) fail("CONNECTOR_KIND_DISABLED");
    if (args.kind === "discord_board" && !boardEnabled()) fail("CONNECTOR_KIND_DISABLED");
    if (args.kind === "discord_scheduled_events" && !discordScheduledEventsEnabled()) fail("CONNECTOR_KIND_DISABLED");
    requireDirection(args.kind, args.direction);
    const target = args.kind === "vrchat_calendar" ? await vrchatCalendarTarget(ctx, args.communityProfileId, args.target.timezone) : args.target;
    requireTarget(args.kind, target);
    // The bot writes into the guild as VRDex, so the staffer must prove that guild.
    if (args.kind === "discord_board" || args.kind === "discord_scheduled_events") await requireControlProof(ctx.db, userId, "discord_guild", args.target.guildId!, MINIMUM_COMMUNITY_CONTROL_LEVEL);
    const credential = args.credentialId ? await ctx.db.get(args.credentialId) : null;
    if (args.credentialId && (credential?.state !== "active" || credential.ownerUserId !== userId)) fail("CONNECTOR_CREDENTIAL");
    if (args.kind === "google_calendar" && credential?.provider !== "google") fail("CONNECTOR_CREDENTIAL");
    const existing = await ctx.db.query("eventConnectors").withIndex("by_communityProfileId", q => q.eq("communityProfileId", args.communityProfileId)).collect();
    // Names are display-only, so two targets with the same IDs are the same target.
    if (existing.some(row => row.state !== "removed" && row.kind === args.kind && TARGET_IDS.every(key => row.target[key] === target[key]))) fail("CONNECTOR_EXISTS");
    const now = Date.now();
    const connectorId = await ctx.db.insert("eventConnectors", {
      communityProfileId: args.communityProfileId, kind: args.kind, direction: args.direction, mode: args.mode,
      authorityUserId: userId, credentialId: args.credentialId, target,
      state: "active", createdAt: now, updatedAt: now,
    });
    if (args.direction !== "off") await reconcile(ctx, connectorId);
    return connectorId;
  },
});

export const update = mutation({
  args: { connectorId: v.id("eventConnectors"), direction: v.optional(connectorDirection), mode: v.optional(connectorMode), quietWindowSeconds: v.optional(v.number()), state: v.optional(v.literal("active")) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { userId, connector } = await authorizedConnector(ctx, args.connectorId);
    // Resume only lifts a pause; Reconnect in the kind plans is what clears needs_reauth.
    if (args.state === "active" && connector.state !== "paused") fail("CONNECTOR_RESUME_INVALID");
    if (connector.state === "removed") fail("CONNECTOR_REMOVED");
    // The resumer becomes the authority, and every VRChat job re-checks manage_events on it.
    if (args.state === "active" && connector.kind === "vrchat_calendar" && !await canManageCalendarEvents(ctx, connector.communityProfileId)) fail("CONNECTOR_FORBIDDEN");
    if (args.direction !== undefined) requireDirection(connector.kind, args.direction);
    const quiet = args.quietWindowSeconds;
    if (quiet !== undefined && (!Number.isInteger(quiet) || quiet < 30 || quiet > 600)) fail("CONNECTOR_QUIET_WINDOW");
    const patch: Partial<Doc<"eventConnectors">> = { updatedAt: Date.now() };
    if (args.direction !== undefined) patch.direction = args.direction;
    if (args.mode !== undefined) patch.mode = args.mode;
    if (quiet !== undefined) patch.quietWindowSeconds = quiet;
    const resumed = args.state === "active";
    // The resumer becomes the authority, or the next claim would pause it again for the original staffer's lost role.
    if (resumed) Object.assign(patch, { state: "active", authorityUserId: userId, lastError: undefined });
    await ctx.db.patch(connector._id, patch);
    // Any change to a live direction reconciles: the new direction may export what the old one never did.
    const redirected = args.direction !== undefined && args.direction !== "off" && args.direction !== connector.direction;
    if (resumed || (redirected && connector.state === "active")) await reconcile(ctx, connector._id);
    return null;
  },
});

export const remove = mutation({ args: { connectorId: v.id("eventConnectors") }, returns: v.null(), handler: async (ctx, args) => {
  const { connector } = await authorizedConnector(ctx, args.connectorId);
  await removeConnector(ctx, connector);
  if (connector.kind === "google_calendar" && connector.credentialId) await revokeCredentialIfUnused(ctx, connector.credentialId);
  return null;
} });
