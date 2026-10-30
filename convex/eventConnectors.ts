import { ConvexError, v, type Infer } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx } from "./_generated/server";
import { requireActiveBrowserSessionSubject } from "./_browserSessionAuthority";
import {
  allowedDirections, connectorDirection, connectorKind, connectorMode, connectorState, connectorTarget, connectorsEnabled,
  DISCORD_ID, requireConnectorAuthority, type ConnectorDirection, type ConnectorKind,
} from "./_eventConnectors";
import { enqueueSyncJob, failureAlertKey } from "./_eventSync";
import { googleCalendarEnabled, revokeCredentialIfUnused } from "./_googleCalendar";
import { resolveOps } from "./_opsAlerts";

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
// Each kind names its target with exactly these IDs: required first, then optional. Notion is reserved and never reaches this.
const KIND_TARGET_IDS: Record<Exclude<ConnectorKind, "notion">, { required: TargetId[]; optional?: TargetId[] }> = {
  discord_announcements: { required: ["guildId", "channelId"] },
  discord_board: { required: ["guildId", "channelId"] },
  discord_scheduled_events: { required: ["guildId"] },
  google_calendar: { required: ["calendarId"] },
  vrchat_calendar: { required: ["groupId"], optional: ["calendarId"] },
};

function requireTarget(kind: Exclude<ConnectorKind, "notion">, target: ConnectorTarget) {
  const { required, optional = [] } = KIND_TARGET_IDS[kind];
  if (!Object.keys(target).every(key => PUBLIC_TARGET_KEYS.includes(key))) fail("CONNECTOR_TARGET");
  for (const key of TARGET_IDS) {
    const value = target[key];
    if (value === undefined ? required.includes(key) : !required.includes(key) && !optional.includes(key)) fail("CONNECTOR_TARGET");
  }
  for (const key of ["guildId", "channelId"] as const) if (target[key] !== undefined && !DISCORD_ID.test(target[key])) fail("CONNECTOR_TARGET");
  for (const key of ["calendarId", "groupId"] as const) if ((target[key]?.length ?? 0) > 256) fail("CONNECTOR_TARGET");
  for (const key of TARGET_NAMES) if ((target[key]?.length ?? 0) > 100) fail("CONNECTOR_TARGET");
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
    if (args.kind === "notion") return fail("CONNECTOR_KIND_RESERVED");
    if (args.kind === "google_calendar" && !googleCalendarEnabled()) fail("CONNECTOR_KIND_DISABLED");
    requireDirection(args.kind, args.direction);
    requireTarget(args.kind, args.target);
    const credential = args.credentialId ? await ctx.db.get(args.credentialId) : null;
    if (args.credentialId && (credential?.state !== "active" || credential.ownerUserId !== userId)) fail("CONNECTOR_CREDENTIAL");
    if (args.kind === "google_calendar" && credential?.provider !== "google") fail("CONNECTOR_CREDENTIAL");
    const existing = await ctx.db.query("eventConnectors").withIndex("by_communityProfileId", q => q.eq("communityProfileId", args.communityProfileId)).collect();
    // Names are display-only, so two targets with the same IDs are the same target.
    if (existing.some(row => row.state !== "removed" && row.kind === args.kind && TARGET_IDS.every(key => row.target[key] === args.target[key]))) fail("CONNECTOR_EXISTS");
    const now = Date.now();
    const connectorId = await ctx.db.insert("eventConnectors", {
      communityProfileId: args.communityProfileId, kind: args.kind, direction: args.direction, mode: args.mode,
      authorityUserId: userId, credentialId: args.credentialId, target: args.target,
      quietWindowSeconds: args.kind === "discord_announcements" ? 120 : undefined,
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
  // Links stay so a reconnect can match them; pending jobs close as connector_inactive when claimed.
  if (connector.state !== "removed") await ctx.db.patch(connector._id, { state: "removed", updatedAt: Date.now() });
  // A removed connector cannot recover, so close any open failure alert for it.
  await resolveOps(ctx, failureAlertKey(connector._id));
  if (connector.kind === "google_calendar" && connector.credentialId) await revokeCredentialIfUnused(ctx, connector.credentialId);
  return null;
} });
