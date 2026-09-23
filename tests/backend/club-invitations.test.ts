import assert from "node:assert/strict";
import { it, after } from "node:test";
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import schemaModule from "../../convex/schema";
import { normalizeRecipients } from "../../convex/_clubInvitations";
const schema =
  (schemaModule as unknown as { default?: typeof schemaModule }).default ??
  schemaModule;
const modules = {
  "../../convex/clubInvitations.ts": () =>
    import("../../convex/clubInvitations"),
  "../../convex/clubOperations.ts": () => import("../../convex/clubOperations"),
  "../../convex/_generated/api.ts": () => import("../../convex/_generated/api"),
};
const ref = (name: string) =>
  makeFunctionReference<any>(`clubInvitations:${name}`);
const oldIssuer = process.env.CLERK_JWT_ISSUER_DOMAIN;
process.env.CLERK_JWT_ISSUER_DOMAIN = "https://test.clerk.accounts.dev";
after(() => {
  if (oldIssuer === undefined) delete process.env.CLERK_JWT_ISSUER_DOMAIN;
  else process.env.CLERK_JWT_ISSUER_DOMAIN = oldIssuer;
});
const first = "usr_11111111-1111-1111-1111-111111111111",
  second = "usr_22222222-2222-2222-2222-222222222222";
it("batch history filters current permissions and preserves pagination after hidden rows", async () => {
  const { t, owner, communityProfileId } = await setup();
  const ids = [];
  for (let i = 0; i < 2; i++)
    ids.push(
      await owner.mutation(ref("enqueue"), {
        communityProfileId,
        requestId: `history_batch_${i}`,
        reviewedRecipients: [first],
        destination: { kind: "group" },
        schedule: { kind: "fixed", dueAt: Date.now() + 60000 },
      }),
    );
  await t.run(async (ctx) => {
    const batch = await ctx.db.get(ids[1]);
    await ctx.db.patch(ids[1], { createdAt: Date.now() + 1000 });
    await ctx.db.patch(batch!.operationIds[0], {
      payload: {
        kind: "invite_to_instance",
        targetUserId: first,
        worldId: "wrld_11111111-1111-1111-1111-111111111111",
        instanceId: "123",
      },
    });
  });
  const subject = {
    subject: "staff",
    issuer: "https://test.clerk.accounts.dev",
    tokenIdentifier: "https://test.clerk.accounts.dev|staff",
  };
  const roleId = await t.run(async (ctx) => {
    await ctx.db.insert("users", { clerkUserId: "staff" });
    const roleId = await ctx.db.insert("communityRoles", {
      communityProfileId,
      key: "staff",
      label: "Staff",
      permissions: ["invite_group_members"],
      assignableRoleIds: [],
      state: "active",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    await ctx.db.insert("communityAuthorities", {
      communityProfileId,
      subject,
      subjectTokenIdentifier: subject.tokenIdentifier,
      roleId,
      roleKey: "staff",
      roleLabel: "Staff",
      state: "active",
      grantedAt: Date.now(),
      updatedAt: Date.now(),
    });
    return roleId;
  });
  const staff = t.withIdentity(subject);
  const firstPage = await staff.query(ref("batches"), {
    communityProfileId,
    paginationOpts: { numItems: 1, cursor: null },
  });
  assert.deepEqual(firstPage.page, []);
  assert.equal(firstPage.isDone, false);
  const secondPage = await staff.query(ref("batches"), {
    communityProfileId,
    paginationOpts: { numItems: 1, cursor: firstPage.continueCursor },
  });
  assert.equal(secondPage.page[0].id, ids[0]);
  assert.equal(
    (await staff.query(ref("outcomes"), { batchId: ids[0] })).canCancel,
    false,
  );
  const ownBatch = await staff.mutation(ref("enqueue"), {
    communityProfileId,
    requestId: "staff_own_batch",
    reviewedRecipients: [first],
    destination: { kind: "group" },
    schedule: { kind: "fixed", dueAt: Date.now() + 60000 },
  });
  assert.equal(
    (await staff.query(ref("outcomes"), { batchId: ownBatch })).canCancel,
    true,
  );
  await t.run((ctx) =>
    ctx.db.patch(roleId, {
      permissions: ["invite_group_members", "manage_scheduled_actions"],
    }),
  );
  assert.equal(
    (await staff.query(ref("outcomes"), { batchId: ids[0] })).canCancel,
    true,
  );
  await staff.mutation(ref("cancel"), { batchId: ownBatch });
  assert.equal(
    (await staff.query(ref("outcomes"), { batchId: ownBatch })).canCancel,
    false,
  );
  await t.run((ctx) => ctx.db.patch(roleId, { permissions: [] }));
  await assert.rejects(
    staff.query(ref("batches"), {
      communityProfileId,
      paginationOpts: { numItems: 1, cursor: null },
    }),
  );
});
it("authorized saved lists return only declared fields across empty, populated and deleted pages", async () => {
  const { owner, communityProfileId } = await setup();
  const read = (cursor: string | null = null) =>
    owner.query(ref("lists"), {
      communityProfileId,
      paginationOpts: { numItems: 1, cursor },
    });
  const empty = await read();
  assert.deepEqual(Object.keys(empty).sort(), [
    "continueCursor",
    "isDone",
    "page",
  ]);
  assert.deepEqual(empty.page, []);
  assert.equal(empty.isDone, true);
  const ids = [];
  for (const [name, recipients] of [
    ["First", [first]],
    ["Second", [second]],
  ] as const) {
    ids.push(
      await owner.mutation(ref("saveList"), {
        communityProfileId,
        name,
        recipients: [...recipients],
      }),
    );
  }
  const pageOne = await read();
  assert.deepEqual(pageOne.page, [
    { _id: ids[0], name: "First", recipients: [first], revision: 1 },
  ]);
  assert.equal(pageOne.isDone, false);
  const pageTwo = await read(pageOne.continueCursor);
  assert.deepEqual(pageTwo.page, [
    { _id: ids[1], name: "Second", recipients: [second], revision: 1 },
  ]);
  assert.equal(pageTwo.isDone, true);
  for (const listId of ids)
    await owner.mutation(ref("removeList"), { communityProfileId, listId });
  assert.deepEqual((await read()).page, []);
});
async function setup() {
  const t = convexTest({ schema, modules });
  const now = Date.now();
  const communityProfileId = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { clerkUserId: "owner" });
    const id = await ctx.db.insert("profiles", {
      slug: "invite-club",
      displayName: "Club",
      sortName: "club",
      aliases: [],
      tags: [],
      claimState: "claimed_verified",
      publicationState: "published",
      publicSurfacingState: "public",
      creationSource: "self",
      updatedAt: now,
      profileType: "community",
      community: { categoryTags: [] },
    });
    await ctx.db.insert("profileOwners", {
      profileId: id,
      userId,
      roleKey: "owner",
      state: "active",
      grantedAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("communityVrchatIntegrations", {
      communityProfileId: id,
      vrchatGroupId: "grp_11111111-1111-1111-1111-111111111111",
      groupVisibility: "public",
      joinPolicy: "free",
      state: "active",
      enabledFeatures: ["membership_management", "instances"],
      killSwitchEnabled: false,
      requestsPerMinute: 10,
      leaseGeneration: 1,
      publicMetrics: {
        currentPopulation: false,
        populationHistory: false,
        groupMemberCount: false,
        groupMemberGrowth: false,
        eventRecaps: false,
      },
      consecutiveFailures: 0,
      createdAt: now,
      updatedAt: now,
    });
    return id;
  });
  return {
    t,
    communityProfileId,
    owner: t.withIdentity({
      subject: "owner",
      issuer: "https://test.clerk.accounts.dev",
      tokenIdentifier: "https://test.clerk.accounts.dev|owner",
    }),
  };
}
it("batch cancellation stops unsent targets while preserving submitted work", async () => {
  const { t, owner, communityProfileId } = await setup();
  const batchId = await owner.mutation(ref("enqueue"), {
    communityProfileId,
    requestId: "cancel_batch_001",
    reviewedRecipients: [first, second],
    destination: { kind: "group" },
    schedule: { kind: "fixed", dueAt: Date.now() + 60000 },
  });
  const before = await owner.query(ref("outcomes"), { batchId });
  await t.run((ctx) =>
    ctx.db.patch(before.recipients[0].operationId, {
      state: "submitted",
      submittedAt: Date.now(),
    }),
  );
  await owner.mutation(ref("cancel"), { batchId });
  await owner.mutation(ref("cancel"), { batchId });
  const after = await owner.query(ref("outcomes"), { batchId });
  assert.deepEqual(
    after.recipients.map((item: any) => item.state),
    ["submitted", "cancelled"],
  );
});
it("disabled invitation feature rejects the whole batch without partial records", async () => {
  const { t, owner, communityProfileId } = await setup();
  await t.run(async (ctx) => {
    const integration = await ctx.db
      .query("communityVrchatIntegrations")
      .withIndex("by_communityProfileId", (q) =>
        q.eq("communityProfileId", communityProfileId),
      )
      .unique();
    await ctx.db.patch(integration!._id, { enabledFeatures: [] });
  });
  await assert.rejects(
    owner.mutation(ref("enqueue"), {
      communityProfileId,
      requestId: "disabled_batch01",
      reviewedRecipients: [first, second],
      destination: { kind: "group" },
      schedule: { kind: "fixed", dueAt: Date.now() + 60000 },
    }),
    /Feature disabled/,
  );
  assert.equal(
    (await t.run((ctx) => ctx.db.query("clubInvitationBatches").take(10)))
      .length,
    0,
  );
  assert.equal(
    (await t.run((ctx) => ctx.db.query("clubOperations").take(10))).length,
    0,
  );
});
it("recipient selection deduplicates and rejects malformed or oversized explicit inputs", () => {
  assert.deepEqual(normalizeRecipients([first, first, second]), [
    first,
    second,
  ]);
  assert.throws(() => normalizeRecipients([]));
  assert.throws(() => normalizeRecipients(["all-members"]));
  assert.throws(() => normalizeRecipients(Array(101).fill(first)));
});
it("reviewed recipients stay frozen when reusable lists change and enqueue retries are idempotent", async () => {
  const { t, owner, communityProfileId } = await setup();
  const listId = await owner.mutation(ref("saveList"), {
    communityProfileId,
    name: "Guests",
    recipients: [first],
  });
  const args = {
    communityProfileId,
    requestId: "invitations_0001",
    reviewedRecipients: [first, first],
    destination: { kind: "group" },
    schedule: { kind: "fixed", dueAt: Date.now() + 60000 },
  };
  const batchId = await owner.mutation(ref("enqueue"), args);
  assert.equal(await owner.mutation(ref("enqueue"), args), batchId);
  await owner.mutation(ref("saveList"), {
    communityProfileId,
    listId,
    expectedRevision: 1,
    name: "Guests",
    recipients: [second],
  });
  const result = await owner.query(ref("outcomes"), { batchId });
  assert.equal(result.recipients.length, 1);
  assert.equal(result.recipients[0].userId, first);
  assert.equal(
    (await t.run((ctx) => ctx.db.query("clubOperations").take(10))).length,
    1,
  );
  await assert.rejects(
    owner.mutation(ref("enqueue"), { ...args, reviewedRecipients: [second] }),
    /Request ID already used/,
  );
  await assert.rejects(
    owner.mutation(ref("saveList"), {
      communityProfileId,
      listId,
      expectedRevision: 1,
      name: "Stale",
      recipients: [first],
    }),
    /List changed/,
  );
});
it("non-staff cannot enumerate lists, preview recipients or inspect outcomes", async () => {
  const { t, owner, communityProfileId } = await setup();
  const batchId = await owner.mutation(ref("enqueue"), {
    communityProfileId,
    requestId: "invitations_0002",
    reviewedRecipients: [first],
    destination: { kind: "group" },
    schedule: { kind: "fixed", dueAt: Date.now() + 60000 },
  });
  await assert.rejects(
    t.query(ref("preview"), { communityProfileId, recipients: [first] }),
  );
  await assert.rejects(t.query(ref("outcomes"), { batchId }));
  await assert.rejects(
    t.query(ref("lists"), {
      communityProfileId,
      paginationOpts: { numItems: 20, cursor: null },
    }),
  );
});

it("scheduled invitation enqueue uses the caller reviewed creation revision", async () => {
  const { t, owner, communityProfileId } = await setup();
  const operations = (name: string) => makeFunctionReference<any>(`clubOperations:${name}`);
  const schedule = { kind: "fixed", dueAt: Date.now() + 60000 };
  const creation = { kind: "create_instance", worldId: "wrld_44444444-4444-4444-4444-444444444444", access: "members", region: "us" };
  const [creationOperationId] = await owner.mutation(operations("enqueue"), {
    communityProfileId, requestId: "review_creation", payloads: [creation], schedule,
  });
  const page = await owner.query(operations("list"), {
    communityProfileId, paginationOpts: { numItems: 20, cursor: null },
  });
  const reviewed = page.page.find((row: { id: string }) => row.id === creationOperationId);
  assert.equal(reviewed.revision, 1);
  await owner.mutation(operations("edit"), {
    operationId: creationOperationId, payload: { ...creation, access: "plus" }, schedule,
  });
  const input = { communityProfileId, requestId: "review_batch", reviewedRecipients: [first],
    destination: { kind: "scheduled_instance", creationOperationId, creationRevision: reviewed.revision }, schedule };
  await assert.rejects(owner.mutation(ref("enqueue"), input), /Instance creation is unavailable/);
  await assert.rejects(owner.mutation(operations("enqueue"), {
    communityProfileId, requestId: "missing_evidence", schedule,
    payloads: [{ kind: "invite_to_created_instance", creationOperationId, targetUserId: first }],
  }), /Instance creation is unavailable/);
  const batchId = await owner.mutation(ref("enqueue"), {
    ...input, destination: { ...input.destination, creationRevision: 2 },
  });
  const batch = await t.run((ctx) => ctx.db.get(batchId));
  const job = await t.run((ctx) => ctx.db.get(batch!.operationIds[0]));
  assert.equal(job!.dependencyRevision, 2);
  assert.equal(job!.payload.creationRevision, 2);
});
