import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

export const readCredential = internalQuery({
  args: { credentialId: v.id("connectorCredentials") },
  handler: (ctx, { credentialId }) => ctx.db.get(credentialId),
});

// The caller encrypts in its action: Convex seeds a mutation's RNG, so the IV must not come from here.
export const saveAccessToken = internalMutation({
  args: { credentialId: v.id("connectorCredentials"), encryptedAccessToken: v.string(), accessTokenExpiresAt: v.number() },
  handler: async (ctx, { credentialId, encryptedAccessToken, accessTokenExpiresAt }) => {
    await ctx.db.patch(credentialId, { encryptedAccessToken, accessTokenExpiresAt, updatedAt: Date.now() });
  },
});

// `error` is a code; it reaches the settings page and the ops alert email.
export const markNeedsReauth = internalMutation({
  args: { credentialId: v.id("connectorCredentials"), error: v.string() },
  handler: async (ctx, { credentialId, error }) => {
    const now = Date.now();
    const connectors = await ctx.db.query("eventConnectors").withIndex("by_kind_target_channelId", q => q.eq("kind", "google_calendar")).collect();
    for (const connector of connectors) {
      if (connector.credentialId !== credentialId || connector.state === "removed") continue;
      await ctx.db.patch(connector._id, { state: "needs_reauth", lastError: error, updatedAt: now });
    }
  },
});
