import assert from "node:assert/strict";
import { createInterface } from "node:readline";
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { api } from "../../../convex/_generated/api";
import schemaModule from "../../../convex/schema";
import { formatDiscordEventPost } from "../../../convex/_eventDiscordExport";

// Only this child selects identity. Browser args never select an actor.
async function main() {
  process.env.VRDEX_EVENT_SPAM_MODE = "off";
  const schema = (schemaModule as unknown as { default?: typeof schemaModule }).default ?? schemaModule;
  const t = convexTest({ schema, modules: {
    "../../../convex/_generated/api.ts": () => import("../../../convex/_generated/api"),
    "../../../convex/events.ts": () => import("../../../convex/events"),
    "../../../convex/eventInventory.ts": () => import("../../../convex/eventInventory"),
    "../../../convex/eventIntake.ts": () => import("../../../convex/eventIntake"),
    "../../../convex/eventCorrections.ts": () => import("../../../convex/eventCorrections"),
    "../../../convex/accounts.ts": () => import("../../../convex/accounts"),
    "../../../convex/profiles.ts": () => import("../../../convex/profiles"),
    "../../../convex/search.ts": () => import("../../../convex/search"),
  } });
  const owner = t.withIdentity({ subject: "checkpoint-owner", issuer: "test", tokenIdentifier: "test|checkpoint-owner", emailVerified: true });
  const outsider = t.withIdentity({ subject: "checkpoint-outsider", issuer: "test", tokenIdentifier: "test|checkpoint-outsider", emailVerified: true });
  await t.run(async ({ db }) => {
    const userId = await db.insert("users", { clerkUserId: "checkpoint-owner", name: "Checkpoint organizer", email: "owner@example.test", emailVerificationTime: Date.now() });
    await db.insert("users", { clerkUserId: "checkpoint-outsider", name: "Other contributor", email: "other@example.test", emailVerificationTime: Date.now() });
    const profileId = await db.insert("profiles", { slug: "checkpoint-club", displayName: "Checkpoint Club", sortName: "checkpoint club", profileType: "community", community: { categoryTags: [] }, aliases: [], tags: [], claimState: "unclaimed", publicationState: "published", publicSurfacingState: "public", creationSource: "community", updatedAt: Date.now() });
    await db.insert("profileOwners", { profileId, userId, roleKey: "owner", state: "active", grantedAt: Date.now(), updatedAt: Date.now() });
  });
  const startAt = Date.UTC(2027, 9, 24, 20);
  const staff = await owner.mutation(api.events.createCommunityEvent, { communitySlug: "checkpoint-club", title: "Checkpoint staff", startAt, endAt: startAt + 4 * 3600_000, timezone: "UTC", published: false, lineup: [{ clientKey: "staff-slot", position: 0, performerLabel: "Original staff guest", startAt, endAt: startAt + 3600_000 }] });
  const intake = await owner.mutation(api.eventIntake.saveEventIntakeDraft, { patch: { communitySlug: "checkpoint-club", title: "Checkpoint intake", eventDate: "2027-10-25", timezone: "UTC", start: { time: "20:00" }, end: { time: "23:00" }, lineup: [{ clientKey: "intake-slot", position: 0, performerLabel: "Original intake guest", start: { time: "20:00" }, end: { time: "21:00" } }] } });
  await outsider.mutation(api.eventIntake.saveEventIntakeDraft, { patch: { title: "Other private draft" } });
  const expired = await owner.mutation(api.eventIntake.saveEventIntakeDraft, { patch: { title: "Expired draft" } });
  await t.run(({ db }) => db.patch(expired.draftId, { expiresAt: Date.now() - 1 }));
  const commands: Array<{ name: string; args: Record<string, unknown> }> = [];
  let publishedIntakeSlug: string | undefined;
  async function snapshot() {
    const editable = await owner.query(api.events.getEditableBySlug, { slug: staff.slug });
    assert.ok(editable);
    const discord = editable.publicationState === "published" ? formatDiscordEventPost({ event: editable, canonicalUrl: `https://vrdex.example/checkpoint-club/events/${staff.slug}` }) : null;
    return { editable, discord, draftId: intake.draftId, staffPath: `/checkpoint-club/events/${staff.slug}`, staffPublic: await t.query(api.events.getPublicBySlug, { slug: staff.slug }), intakePublic: publishedIntakeSlug ? await t.query(api.events.getPublicBySlug, { slug: publishedIntakeSlug }) : null };
  }
  const queries = new Set(["events:getPublicBySlug", "events:listVrcdnOutputAccounts", "events:getEventMediaControlStatus", "events:listEventAudit", "eventCorrections:getEventContributionAccess", "accounts:viewer", "events:listManagedCommunities", "eventCorrections:getEventReportAccess", "eventInventory:listPage", "eventIntake:getEventIntakeDraft", "eventCorrections:getOwnContributedEvent", "profiles:getPublicBySlug", "profiles:lookupPeople", "search:searchUniversal"]);
  console.log(JSON.stringify({ ready: true, snapshot: await snapshot() }));
  for await (const line of createInterface({ input: process.stdin })) {
    const request = JSON.parse(line) as { v: number; id: number; type: string; name: string; args: Record<string, unknown> };
    try {
      let result: unknown;
      const { name, args } = request;
      assert.equal(request.v, 1);
      if (request.type === "snapshot") result = await snapshot();
      else if (request.type === "query") {
        assert.ok(queries.has(name), `Unexpected query ${name}`);
        if (name === "eventIntake:getEventIntakeDraft") assert.equal(args.draftId, intake.draftId);
        result = await owner.query(makeFunctionReference<"query">(name), args);
      } else if (request.type === "mutation") {
        assert.ok(["events:updateCommunityEvent", "eventIntake:saveEventIntakeDraft"].includes(name), `Unexpected mutation ${name}`);
        if (name === "events:updateCommunityEvent") assert.equal(args.currentSlug, staff.slug);
        else assert.equal(args.draftId, intake.draftId);
        await assert.rejects(t.mutation(makeFunctionReference<"mutation">(name), args));
        result = await owner.mutation(makeFunctionReference<"mutation">(name), args);
        commands.push({ name, args });
      } else if (request.type === "action") {
        assert.equal(name, "eventIntake:publishEventIntake"); assert.equal(args.draftId, intake.draftId);
        await assert.rejects(t.action(makeFunctionReference<"action">(name), args));
        await assert.rejects(outsider.action(makeFunctionReference<"action">(name), args));
        result = await owner.action(makeFunctionReference<"action">(name), args);
        publishedIntakeSlug = (result as { eventPath: string }).eventPath.split("/").at(-1);
        commands.push({ name, args });
      } else if (request.type === "finish") {
        const saved = await snapshot();
        assert.equal(saved.editable.publicationState, "published");
        assert.equal(saved.editable.lineup?.[0].displayLabel, "Revised staff guest");
        assert.equal(saved.editable.lineup?.[0].startAt, Date.UTC(2027, 9, 24, 20, 15));
        assert.match(saved.discord!, /Revised staff guest/);
        assert.ok(saved.intakePublic?.lineup?.some(row => row.displayLabel === "Saved intake guest"));
        assert.equal(saved.intakePublic?.lineup?.[0].startAt, Date.UTC(2027, 9, 25, 20, 15));
        assert.ok(commands.some(command => command.name === "events:updateCommunityEvent" && command.args.published === true));
        assert.ok(commands.some(command => command.name === "eventIntake:publishEventIntake"));
        assert.equal(await outsider.query(api.events.getEditableBySlug, { slug: staff.slug }), null);
        const contribution = await outsider.mutation(api.eventIntake.saveEventIntakeDraft, { patch: { communitySlug: "checkpoint-club", title: "Independent contribution", eventDate: "2028-01-15", timezone: "UTC", start: { time: "20:00" } } });
        const contributed = await outsider.action(api.eventIntake.publishEventIntake, { draftId: contribution.draftId, expectedVersion: contribution.version, idempotencyKey: "negative-export-checkpoint" });
        assert.equal(await outsider.query(api.events.getEditableBySlug, { slug: contributed.eventPath.split("/").at(-1)! }), null);
        // Hold criteria fixed for the second actual source page.
        const ownCriteria = { view: "all" as const, query: "", timeZone: "UTC", asOf: Date.now() };
        const ownStart = await outsider.query(api.eventInventory.listPage, { ...ownCriteria, paginationOpts: { cursor: null, numItems: 20 } });
        const ownEvents = await outsider.query(api.eventInventory.listPage, { ...ownCriteria, paginationOpts: { cursor: ownStart.continueCursor, numItems: 20 } });
        assert.ok(ownEvents.page.some(row => row.id === contributed.eventId && row.kind === "own_contribution" && row.continuation.kind === "public_event"));
        await owner.mutation(api.events.setCommunityEventCancelled, { currentSlug: staff.slug, cancelled: true, reason: "Checkpoint cancellation" });
        assert.equal((await snapshot()).discord, null);
        await owner.mutation(api.events.setCommunityEventPublished, { currentSlug: staff.slug, published: false });
        assert.equal((await snapshot()).discord, null);
        result = { commands, negatives: ["anonymous writes rejected", "other contributor staff read rejected", "cancelled export absent", "unpublished export absent"] };
      } else throw new Error(`Unexpected request ${request.type}`);
      console.log(JSON.stringify({ id: request.id, ok: true, result }));
      if (request.type === "finish") break;
    } catch (error) {
      console.log(JSON.stringify({ id: request.id, ok: false, error: { message: error instanceof Error ? error.message : String(error), data: error && typeof error === "object" && "data" in error ? error.data : undefined } }));
    }
  }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
