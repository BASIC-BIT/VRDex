import { v } from "convex/values";
import { query, mutation, type QueryCtx, type MutationCtx } from "./_generated/server";
import { requireUser } from "./_identity";
import { userOwnsProfile } from "./_profileOwnership";
import { profileImageSources } from "./_profileImageFallback";

async function ownedProfile(ctx: QueryCtx | MutationCtx, slug: string) {
  const { user } = await requireUser(ctx);
  const profile = await ctx.db.query("profiles").withIndex("by_slug",q => q.eq("slug",slug)).unique();
  if (!profile || !await userOwnsProfile(ctx.db,profile._id,user._id)) throw new Error("Only the profile owner can update profile appearance.");
  return profile;
}

export const getSettings = query({
  args: {slug:v.string()},
  handler: async (ctx,args) => {
    const profile = await ownedProfile(ctx,args.slug);
    const candidates = [...new Map(profileImageSources(profile,"profile_page").map(source => [source.key,source])).values()];
    const sources = await Promise.all(candidates.map(async source => {
      const cached = await ctx.db.query("profileLinkDestinations").withIndex("by_key",q => q.eq("key",source.key)).unique();
      return {...source,label:cached?.name ? `${cached.name} (${source.locator})` : source.locator};
    }));
    return {
      disabled: profile.imageFallback?.disabled ?? false,
      vrchatGroupKey: sources.some(source => source.kind === "vrchat_group" && source.key === profile.imageFallback?.vrchatGroupKey) ? profile.imageFallback?.vrchatGroupKey : undefined,
      discordGuildKey: sources.some(source => source.kind === "discord_guild" && source.key === profile.imageFallback?.discordGuildKey) ? profile.imageFallback?.discordGuildKey : undefined,
      profileType: profile.profileType,
      sources,
    };
  },
});

export const updateSettings = mutation({
  args: {slug:v.string(),disabled:v.boolean(),vrchatGroupKey:v.optional(v.string()),discordGuildKey:v.optional(v.string())},
  handler: async (ctx,args) => {
    const profile = await ownedProfile(ctx,args.slug);
    const sources = profileImageSources(profile,"profile_page");
    for (const [key,kind] of [[args.vrchatGroupKey,"vrchat_group"],[args.discordGuildKey,"discord_guild"]] as const) {
      if (key && !sources.some(source => source.key === key && source.kind === kind)) throw new Error("Image source is not linked to this profile.");
    }
    await ctx.db.patch(profile._id,{imageFallback:{disabled:args.disabled,vrchatGroupKey:args.vrchatGroupKey,discordGuildKey:args.discordGuildKey},updatedAt:Date.now()});
    return null;
  },
});
