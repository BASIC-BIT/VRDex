import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { convexTest } from "convex-test";
import { makeFunctionReference, SchemaDefinition } from "convex/server";
import { api } from "../../convex/_generated/api";
import schemaModule from "../../convex/schema";
import { newClerkUserId } from "./_clerkTestIdentity";
import { loadEventsWithFixtureCapacity } from "./_eventCapacityFixture";
import { bindVrcdnTestAccount } from "./_eventOutputAccountFixture";

const schema = "default" in schemaModule && schemaModule.default instanceof SchemaDefinition
  ? schemaModule.default
  : schemaModule;
const modules = {
  "../../convex/_generated/api.ts": () => import("../../convex/_generated/api"),
  "../../convex/events.ts": () => import("../../convex/events"),
};
const priorAccounts = process.env.VRDEX_VRCDN_OUTPUT_ACCOUNTS_JSON;
afterEach(() => {
  if (priorAccounts === undefined) delete process.env.VRDEX_VRCDN_OUTPUT_ACCOUNTS_JSON;
  else process.env.VRDEX_VRCDN_OUTPUT_ACCOUNTS_JSON = priorAccounts;
});

async function setupFixture(loadEvents = modules["../../convex/events.ts"]) {
  const t = convexTest({ schema, modules: { ...modules, "../../convex/events.ts": loadEvents } });
  const subject = newClerkUserId();
  const profileId = await t.run(async ({ db }) => {
    const now = Date.now();
    const userId = await db.insert("users", { clerkUserId: subject, name: "Owner", email: "owner@example.test", emailVerificationTime: now });
    const profileId = await db.insert("profiles", { slug: "club", displayName: "Club", sortName: "club", aliases: [], tags: [], claimState: "claimed_verified", publicationState: "published", publicSurfacingState: "public", creationSource: "self", updatedAt: now, profileType: "community", community: { categoryTags: [] } });
    await db.insert("profileOwners", { profileId, userId, roleKey: "owner", state: "active", grantedAt: now, updatedAt: now });
    return profileId;
  });
  const authorizeOutput = () => bindVrcdnTestAccount(profileId, "event-media/vrcdn/main");
  authorizeOutput();
  const owner = t.withIdentity({ subject, emailVerified: true, issuer: "test", tokenIdentifier: `test|${subject}` });
  const event = await owner.mutation(api.events.createCommunityEvent, { title: "Capacity event", communitySlug: "club", startAt: Date.now() + 600_000, timezone: "UTC" });
  await owner.mutation(api.events.configureVrcdnOutput, { currentSlug: event.slug, key: "main", label: "Main", credentialRef: "event-media/vrcdn/main", sourceConsentAccepted: true, destinationAuthorityAccepted: true, providerRulesAccepted: true, rightsClearedMediaAccepted: true });
  const schedulingState = () => t.run(async ({ db }) => ({
    sessions: await db.query("eventMediaSessions").collect(),
    programs: await db.query("eventMediaPrograms").collect(),
    commands: await db.query("eventMediaCommands").collect(),
    audits: await db.query("eventMediaAuditEvents").collect(),
  }));
  return { t, owner, event, authorizeOutput, schedulingState };
}

test("production capacity rejects with no scheduling writes", async () => {
  const f = await setupFixture();
  const before = await f.schedulingState();
  await assert.rejects(f.owner.mutation(api.events.scheduleEventMediaWorker, { currentSlug: f.event.slug }), /Unproved broadcast configuration/);
  assert.deepEqual(await f.schedulingState(), before);
});

test("persisted synthetic snapshot cannot authorize production reschedule", async () => {
  const f = await setupFixture(async () => {
    const events = await import("../../convex/events");
    const { fixtureCapacityResolver } = await import("../scripts/_event-allocation-fixture.mjs");
    return {
      ...events,
      fixtureScheduleEventMediaWorker: events.createScheduleEventMediaWorker(fixtureCapacityResolver),
    };
  });
  const fixtureSchedule = makeFunctionReference<"mutation">("events:fixtureScheduleEventMediaWorker");
  await f.owner.mutation(fixtureSchedule, { currentSlug: f.event.slug });
  const before = await f.schedulingState();
  assert.equal(before.sessions.length, 1);
  assert.equal(before.commands.length, 1);
  assert.deepEqual(before.sessions[0].allocation, { cpuUnits: 4096, memoryMiB: 8192, evidenceId: "fixture-capacity-v1" });
  await assert.rejects(f.owner.mutation(api.events.scheduleEventMediaWorker, { currentSlug: f.event.slug }), /Unproved broadcast configuration/);
  assert.deepEqual(await f.schedulingState(), before);
});

test("fixture scheduling does not alter default scheduling", async () => {
  const synthetic = await setupFixture(loadEventsWithFixtureCapacity);
  const production = await setupFixture();
  synthetic.authorizeOutput();
  const scheduled = await synthetic.owner.mutation(api.events.scheduleEventMediaWorker, { currentSlug: synthetic.event.slug });
  assert.equal(scheduled.status, "scheduled");
  const session = await synthetic.t.run(({ db }) => db.get(scheduled.sessionId));
  assert.deepEqual(session?.allocation, { cpuUnits: 4096, memoryMiB: 8192, evidenceId: "fixture-capacity-v1" });
  production.authorizeOutput();
  const before = await production.schedulingState();
  await assert.rejects(production.owner.mutation(api.events.scheduleEventMediaWorker, { currentSlug: production.event.slug }), /Unproved broadcast configuration/);
  assert.deepEqual(await production.schedulingState(), before);
});

test("fixture scheduling still validates frozen snapshots", async () => {
  for (const tampering of ["evidence", "destination profile"]) {
    const f = await setupFixture(loadEventsWithFixtureCapacity);
    const scheduled = await f.owner.mutation(api.events.scheduleEventMediaWorker, { currentSlug: f.event.slug });
    await f.t.run(async ({ db }) => {
      const session = await db.get(scheduled.sessionId);
      assert.ok(session?.allocation);
      assert.ok(session.destinationProfiles);
      if (tampering === "evidence") {
        await db.patch(session._id, { allocation: { ...session.allocation, evidenceId: "fixture-capacity-tampered" } });
      } else {
        await db.patch(session._id, { destinationProfiles: session.destinationProfiles.map(destination => ({ ...destination, profile: { ...destination.profile, frameRate: destination.profile.frameRate + 1 } })) });
      }
    });
    const before = await f.schedulingState();
    const expectedError = tampering === "evidence" ? /Unproved allocation snapshot/ : /Mismatched destination profile/;
    await assert.rejects(f.owner.mutation(api.events.scheduleEventMediaWorker, { currentSlug: f.event.slug }), expectedError);
    assert.deepEqual(await f.schedulingState(), before);
  }
});
