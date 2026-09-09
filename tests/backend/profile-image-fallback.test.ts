import assert from "node:assert/strict";
import { it } from "node:test";
import { convexTest } from "convex-test";
import schemaModule from "../../convex/schema";
import { api } from "../../convex/_generated/api";
import { newClerkUserId } from "./_clerkTestIdentity";

const schema = (schemaModule as unknown as { default?: typeof schemaModule }).default ?? schemaModule;
const modules = {
  "../../convex/_generated/api.ts": () => import("../../convex/_generated/api"),
  "../../convex/profiles.ts": () => import("../../convex/profiles"),
  "../../convex/profileLinkDestinations.ts": () => import("../../convex/profileLinkDestinations"),
  "../../convex/profileImageFallback.ts": () => import("../../convex/profileImageFallback"),
};
const userId = "usr_7023d326-083f-41fe-a3e9-27ea303b50c5";
it("public profiles use cached custom portraits, never unproven avatar artwork", async () => {
  const t = convexTest({ schema, modules });
  const id = await t.run(async ctx => {
    const profileId = await ctx.db.insert("profiles", {slug:"portrait",displayName:"Portrait",sortName:"portrait",aliases:[],tags:[],profileType:"person",person:{roleTags:[]},claimState:"unclaimed",publicationState:"published",publicSurfacingState:"public",creationSource:"community",updatedAt:1,outboundLinks:[{type:"vrchat_profile",label:"VRChat",url:`https://vrchat.com/home/user/${userId}`,source:"reviewed"}]});
    await ctx.db.insert("profileLinkDestinations", {key:`vrchat_user:${userId}`,kind:"vrchat_user",locator:userId,provider:"vrchat",status:"resolved",artworkSourceUrl:"https://example.com/portrait.png",observedAt:1});
    return profileId;
  });
  const read = () => t.query(api.profiles.getPublicBySlug,{slug:"portrait",includeShareCard:true});
  assert.equal((await read())?.avatarImageUrl, undefined);
  await t.run(async ctx => {
    const row = await ctx.db.query("profileLinkDestinations").first();
    await ctx.db.patch(row!._id, {artworkType:"profile_picture"});
  });
  assert.match((await read())?.avatarImageUrl ?? "", /size=512/);
  const artworkArgs = {key:`vrchat_user:${userId}`,profileId:String(id),profileImage:true};
  assert.ok(await t.query(api.profileLinkDestinations.lookupArtworkSource,artworkArgs));
  await t.run(ctx => ctx.db.patch(id,{fieldVisibility:{outboundLinks:"unlisted"}}));
  assert.ok(await t.query(api.profileLinkDestinations.lookupArtworkSource,artworkArgs));
  assert.equal(await t.query(api.profileLinkDestinations.lookupArtworkSource,{...artworkArgs,surface:"discovery"}),null);
  await t.run(ctx => ctx.db.patch(id,{fieldVisibility:{avatarImageUrl:"private"}}));
  assert.equal((await read())?.avatarImageUrl, undefined);
  assert.equal(await t.query(api.profileLinkDestinations.lookupArtworkSource,artworkArgs),null);
});

it("only owners can select linked community sources or disable automatic images", async () => {
  const t = convexTest({schema,modules});
  const clerkUserId = newClerkUserId();
  const id = await t.run(async ctx => {
    const user = await ctx.db.insert("users",{clerkUserId,email:"image@example.test",emailVerificationTime:1});
    const id = await ctx.db.insert("profiles",{slug:"image-club",displayName:"Club",sortName:"club",aliases:[],tags:[],profileType:"community",community:{categoryTags:[]},claimState:"claimed_verified",publicationState:"published",publicSurfacingState:"public",creationSource:"self",updatedAt:1,outboundLinks:[{type:"discord",label:"Server",url:"https://discord.gg/Club",source:"owner_authored"}]});
    await ctx.db.insert("profileOwners",{profileId:id,userId:user,roleKey:"owner",state:"active",grantedAt:1,updatedAt:1});
    return id;
  });
  const owner = t.withIdentity({subject:clerkUserId,issuer:"test",emailVerified:true});
  await assert.rejects(t.mutation(api.profileImageFallback.updateSettings,{slug:"image-club",disabled:true}));
  await assert.rejects(owner.mutation(api.profileImageFallback.updateSettings,{slug:"image-club",disabled:false,discordGuildKey:"discord_guild:Other"}));
  await owner.mutation(api.profileImageFallback.updateSettings,{slug:"image-club",disabled:false,discordGuildKey:"discord_guild:Club"});
  assert.equal((await owner.query(api.profileImageFallback.getSettings,{slug:"image-club"})).discordGuildKey,"discord_guild:Club");
  await t.run(ctx => ctx.db.patch(id,{outboundLinks:[]}));
  const removed = await owner.query(api.profileImageFallback.getSettings,{slug:"image-club"});
  assert.equal(removed.discordGuildKey,undefined);
  await owner.mutation(api.profileImageFallback.updateSettings,{slug:"image-club",disabled:true});
  const settings = await owner.query(api.profileImageFallback.getSettings,{slug:"image-club"});
  assert.equal(settings.disabled,true);
  assert.equal(settings.discordGuildKey,undefined);
  await t.run(ctx => ctx.db.patch(id,{avatarImageUrl:"https://example.com/authored.png"}));
  assert.equal((await t.query(api.profiles.getPublicBySlug,{slug:"image-club"}))?.avatarImageUrl,"https://example.com/authored.png");
});
