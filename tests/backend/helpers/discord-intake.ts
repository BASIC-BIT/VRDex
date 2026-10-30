import { convexTest, type TestConvex } from "convex-test";
import schemaModule from "../../../convex/schema";
import { internal } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { newClerkUserId } from "../_clerkTestIdentity";
import { connectorModules, grantCommunityRole } from "../_eventConnectorFixture";

const schema = (schemaModule as unknown as { default?: typeof schemaModule }).default ?? schemaModule;
type T = TestConvex<typeof schema>;

export const GUILD = "100000000000000001";
export const CHANNEL = "100000000000000002";
export const AUTHOR_A = "200000000000000001";
export const AUTHOR_B = "200000000000000002";
export const M1 = "300000000000000001";
export const M2 = "300000000000000002";
export const SECRET = "s".repeat(40);

export const modules = {
  ...connectorModules,
  "../../convex/discordIntake.ts": () => import("../../../convex/discordIntake"),
  "../../convex/discordIntakeRun.ts": () => import("../../../convex/discordIntakeRun"),
  "../../convex/http.ts": () => import("../../../convex/http"),
  "../../convex/productAnalytics.ts": () => import("../../../convex/productAnalytics"),
};

/** A published public community with no staff grants. */
export const seedCommunity = (t: T, { slug, displayName }: { slug: string; displayName: string }) =>
  t.run(ctx => ctx.db.insert("profiles", {
    slug, displayName, sortName: displayName.toLowerCase(), profileType: "community", community: { categoryTags: [] }, aliases: [], tags: [],
    claimState: "unclaimed", publicationState: "published", publicSurfacingState: "public", creationSource: "community", updatedAt: Date.now(),
  }));

export async function seedDiscordIntake(options: { mode?: "hold" | "autopublish"; quietWindowSeconds?: number; state?: "active" | "paused" } = {}) {
  process.env.EVENT_DATE_ONLY_ENABLED = "true";
  process.env.CLERK_JWT_ISSUER_DOMAIN = "test";
  process.env.VRDEX_EVENT_CONNECTORS_ENABLED = "true";
  const t = convexTest({ schema, modules });
  const clerkUserId = newClerkUserId();
  const communitySlug = "night-club" as const;
  const communityProfileId = await seedCommunity(t, { slug: communitySlug, displayName: "Night Club" });
  const { authorityUserId, connectorId } = await t.run(async ctx => {
    const authorityUserId = await ctx.db.insert("users", { clerkUserId });
    await grantCommunityRole(ctx.db, communityProfileId, clerkUserId, "integrations", ["manage_integrations"]);
    const connectorId = await ctx.db.insert("eventConnectors", {
      communityProfileId, kind: "discord_announcements", direction: "import", mode: options.mode ?? "hold", authorityUserId,
      target: { guildId: GUILD, guildName: "Night Server", channelId: CHANNEL, channelName: "announcements" },
      quietWindowSeconds: options.quietWindowSeconds, state: options.state ?? "active", createdAt: Date.now() - 60_000, updatedAt: Date.now(),
    });
    return { authorityUserId, connectorId };
  });
  return { t, authorityUserId, clerkUserId, communityProfileId, communitySlug, connectorId };
}

export const message = (messageId: string, overrides: Record<string, unknown> = {}) => ({
  messageId, authorId: AUTHOR_A, authorDisplayName: "Ari", isBot: false,
  content: `post ${messageId}`, createdAt: Date.now(), attachments: [], ...overrides,
});

export const record = (t: T, action: "create" | "update" | "delete", payload: Record<string, unknown>) =>
  t.mutation(internal.discordIntake.recordMessage, { guildId: GUILD, channelId: CHANNEL, action, payload: payload as never });

/** Revokes the manage_integrations grant `seedDiscordIntake` made. */
export const revokeManageIntegrations = (t: T, communityProfileId: Id<"profiles">, userId: Id<"users">) => t.run(async ctx => {
  const subject = (await ctx.db.get(userId))!.clerkUserId;
  const grants = await ctx.db.query("communityAuthorities").withIndex("by_subjectTokenIdentifier_state", q => q.eq("subjectTokenIdentifier", `test|${subject}`).eq("state", "active")).collect();
  for (const grant of grants.filter(row => row.communityProfileId === communityProfileId)) await ctx.db.patch(grant._id, { state: "revoked", revokedAt: Date.now(), updatedAt: Date.now() });
});

export const seedGuildProof = (t: T, userId: Id<"users">, guildId: string, controlLevel: "manager" | "administrator" | "owner") => t.run(ctx => {
  const now = Date.now();
  return ctx.db.insert("externalControlProofs", {
    userId, assetType: "discord_guild", assetExternalId: guildId, controlLevel, state: "active", evidenceSource: "discord_oauth",
    verifiedAt: now, revalidateAfter: now + 86_400_000, createdAt: now, updatedAt: now,
  });
});
