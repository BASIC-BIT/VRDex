import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { eventPathForRecord } from "./_eventPaths";
import { googleTarget } from "./_googleCalendar";

export const readCredential = internalQuery({
  args: { credentialId: v.id("connectorCredentials") },
  handler: (ctx, { credentialId }) => ctx.db.get(credentialId),
});

// The caller encrypts in its action: Convex seeds a mutation's RNG, so the IV must not come from here.
export const saveAccessToken = internalMutation({
  args: { credentialId: v.id("connectorCredentials"), encryptedAccessToken: v.string(), accessTokenExpiresAt: v.number() },
  handler: async (ctx, { credentialId, encryptedAccessToken, accessTokenExpiresAt }) => {
    if ((await ctx.db.get(credentialId))?.state !== "active") return;
    await ctx.db.patch(credentialId, { encryptedAccessToken, accessTokenExpiresAt, updatedAt: Date.now() });
  },
});

// `error` is a code; it reaches the settings page and the ops alert email.
export const markNeedsReauth = internalMutation({
  args: { credentialId: v.id("connectorCredentials"), error: v.string() },
  handler: async (ctx, { credentialId, error }) => {
    const now = Date.now();
    // ponytail: reads every google_calendar connector; add a by_credentialId index when they pass a few hundred.
    const connectors = await ctx.db.query("eventConnectors").withIndex("by_kind_target_channelId", q => q.eq("kind", "google_calendar")).collect();
    for (const connector of connectors) {
      if (connector.credentialId !== credentialId || connector.state === "removed") continue;
      await ctx.db.patch(connector._id, { state: "needs_reauth", lastError: error, updatedAt: now });
    }
  },
});

export const exportContext = internalQuery({
  args: { connectorId: v.id("eventConnectors"), eventId: v.id("events") },
  handler: async (ctx, { connectorId, eventId }) => {
    const siteUrl = process.env.SITE_URL;
    if (!siteUrl) throw new Error("SITE_URL_MISSING");
    const [connector, event] = await Promise.all([ctx.db.get(connectorId), ctx.db.get(eventId)]);
    if (!connector || !event) throw new Error("CONNECTOR_EXPORT_CONTEXT");
    return { eventUrl: siteUrl.replace(/\/$/, "") + await eventPathForRecord(ctx.db, event), ...googleTarget(connector) };
  },
});

// Export dedupe must not claim a Google item another VRDex event or draft already holds.
export const linkedExternalIds = internalQuery({
  args: { connectorId: v.id("eventConnectors"), externalIds: v.array(v.string()) },
  handler: async (ctx, { connectorId, externalIds }) => {
    const linked: string[] = [];
    for (const externalId of externalIds) {
      if (await ctx.db.query("eventSyncLinks").withIndex("by_connectorId_externalId", q => q.eq("connectorId", connectorId).eq("externalId", externalId)).first()) linked.push(externalId);
    }
    return linked;
  },
});
