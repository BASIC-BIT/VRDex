import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createInterface } from "node:readline";
import { convexTest } from "convex-test";
import { api } from "../../../convex/_generated/api";
import schemaModule from "../../../convex/schema";
import { newClerkUserId } from "../_clerkTestIdentity";

const schema = (schemaModule as unknown as { default?: typeof schemaModule }).default ?? schemaModule;
const modules = {
  "../../../convex/_generated/api.ts": () => import("../../../convex/_generated/api"),
  "../../../convex/events.ts": () => import("../../../convex/events"),
  "../../../convex/search.ts": () => import("../../../convex/search"),
};

async function main() {
  const t = convexTest({ schema, modules });
  const now = Math.floor(Date.now() / 60_000) * 60_000;
  const subject = newClerkUserId();
  await t.run(async ctx => {
    const userId = await ctx.db.insert("users", { clerkUserId: subject, name: "Owner", email: "owner@example.test", emailVerificationTime: now });
    const common = { aliases: [], tags: [], claimState: "unclaimed" as const, publicationState: "published" as const, publicSurfacingState: "public" as const, creationSource: "community" as const, updatedAt: now };
    const profileId = await ctx.db.insert("profiles", { ...common, slug: "controlled-community", displayName: "Controlled Community", sortName: "controlled community", profileType: "community", community: { categoryTags: [] } });
    await ctx.db.insert("profileOwners", { profileId, userId, roleKey: "owner", state: "active", grantedAt: now, updatedAt: now });
    await ctx.db.insert("profiles", { ...common, slug: "controlled-performer", displayName: "Controlled Performer", sortName: "controlled performer", profileType: "person", person: { roleTags: [] }, outboundLinks: [{ type: "vrcdn", label: "Stream", source: "owner_authored", url: "vrcdn:controlled" }, { type: "vrcdn", label: "Second stream", source: "owner_authored", url: "vrcdn:controlled-next" }] });
  });
  const owner = t.withIdentity({ subject, emailVerified: true, issuer: "test", tokenIdentifier: `test|${subject}` });
  const created = await owner.mutation(api.events.createCommunityEvent, {
    title: "Controlled lineup", communitySlug: "controlled-community", startAt: now - 60_000, endAt: now + 3600_000, timezone: "UTC", published: false, watchSurfaceEnabled: true,
    watchMode: "performer_sequence", slotLinks: [{ personSlug: "controlled-performer", displayLabel: "Controlled set", startAt: now - 60_000, selectedStreamId: "controlled" }],
  });
  assert.equal(await t.query(api.events.getPublicBySlug, { slug: created.slug }), null);
  await assert.rejects(t.mutation(api.events.setCommunityEventPublished, { currentSlug: created.slug, published: true }));
  const editableBefore = await owner.query(api.events.getEditableBySlug, { slug: created.slug });
  console.log(JSON.stringify({ editable: editableBefore }));
  const lines = createInterface({ input: process.stdin });
  const payload = await new Promise<string>(resolve => lines.once("line", resolve));
  lines.close();
  const args = JSON.parse(payload);
  assert.equal(args.currentSlug, created.slug);
  assert.equal(args.slotLinks[0].selectedStreamId, "controlled-next");
  await assert.rejects(t.mutation(api.events.updateCommunityEvent, args));
  await owner.mutation(api.events.updateCommunityEvent, args);
  assert.equal(await t.query(api.events.getPublicBySlug, { slug: created.slug }), null);
  await owner.mutation(api.events.setCommunityEventPublished, { currentSlug: created.slug, published: true });
  const editable = await owner.query(api.events.getEditableBySlug, { slug: created.slug });
  assert.equal(editable?.slots[0]?.selectedStreamId, "controlled-next");
  const discovered = await t.query(api.events.listPublicUpcoming, { now, limit: 8 });
  assert.ok(discovered.some(event => event.slug === created.slug));
  const event = await t.query(api.events.getPublicBySlug, { slug: created.slug });
  assert.equal(event?.slots?.[0]?.stream?.streamId, "controlled-next");
  // Only transport is replaced: pass the actual authored projection, never a second roster literal.
  const output = execFileSync(process.execPath, ["--import", "tsx", "tests/web/helpers/authored-event-serialization.ts"], {
    cwd: process.cwd(), input: JSON.stringify(event), encoding: "utf8", timeout: 30_000,
    env: { ...process.env, TSX_TSCONFIG_PATH: "apps/web/tsconfig.json", VRDEX_RATE_LIMIT_STORE: "memory", CONVEX_URL: "https://fixture.convex.cloud" },
  });
  assert.match(output, /authored event serialization passed/);
  console.log(JSON.stringify({ event, serialized: true }));
}
void main();
