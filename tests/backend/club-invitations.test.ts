import assert from "node:assert/strict";
import { it, after } from "node:test";
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import schemaModule from "../../convex/schema";
import { normalizeRecipients } from "../../convex/_clubInvitations";
import { cancel as cancelBatch } from "../../convex/clubInvitations";
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
async function cancellationSetup(count = 100) {
  const s = await setup();
  const subject = { subject: "canceller", issuer: "https://test.clerk.accounts.dev",
    tokenIdentifier: "https://test.clerk.accounts.dev|canceller" };
  const roles = await s.t.run(async ctx => {
    await ctx.db.insert("users", { clerkUserId: subject.subject });
    const ids = [];
    for (let index = 0; index < 100; index++) {
      const roleId = await ctx.db.insert("communityRoles", {
        communityProfileId: s.communityProfileId, key: `role${index}`, label: `Role ${index}`,
        description: "x".repeat(500), permissions: index === 0 ? ["invite_group_members"] : [],
        assignableRoleIds: [], state: "active", createdAt: Date.now(), updatedAt: Date.now(),
      });
      ids.push(roleId);
      await ctx.db.insert("communityAuthorities", {
        communityProfileId: s.communityProfileId, subject, subjectTokenIdentifier: subject.tokenIdentifier,
        roleId, roleKey: `role${index}`, roleLabel: `Role ${index}`, state: "active",
        grantedAt: Date.now(), updatedAt: Date.now(),
      });
    }
    return ids;
  });
  const staff = s.t.withIdentity(subject);
  const batchId = await staff.mutation(ref("enqueue"), {
    communityProfileId: s.communityProfileId, requestId: "bounded_cancel_batch",
    reviewedRecipients: Array.from({ length: count }, (_, i) => `usr_11111111-1111-1111-1111-${String(i).padStart(12, "0")}`),
    destination: { kind: "group" }, schedule: { kind: "fixed", dueAt: Date.now() + 60_000 },
  });
  const batch = await s.t.run(ctx => ctx.db.get(batchId));
  return { ...s, staff, subject, roleId: roles[0], batchId, operationIds: batch!.operationIds };
}
it("maximum batch cancellation resolves current authority once with many roles", async () => {
  const s = await cancellationSetup();
  await s.t.run(async ctx => {
    await ctx.db.patch(s.operationIds[0], { state: "submitted", submittedAt: Date.now() });
    await ctx.db.patch(s.operationIds[1], { state: "claimed" });
  });
  const queries = new Map<string, number>();
  const reads = new Map<string, number>();
  await s.staff.run(async ctx => {
    const db = new Proxy(ctx.db, { get(target, property) {
      if (property === "query") return (table: string) => {
        queries.set(table, (queries.get(table) ?? 0) + 1);
        return target.query(table as never);
      };
      if (property === "get") return (id: string) => {
        reads.set(id, (reads.get(id) ?? 0) + 1);
        return target.get(id as never);
      };
      return Reflect.get(target, property);
    } });
    await (cancelBatch as any)._handler({ ...ctx, db }, { batchId: s.batchId });
  });
  assert.equal(queries.get("communityAuthorities"), 1);
  assert.equal(queries.get("communityRoles"), 1);
  // The cancellation patch's existing notification bookkeeping rereads cancelled
  // jobs once. There must be no second preauthorization read per job.
  assert.equal(reads.get(s.operationIds[1]), 2);
  const jobs = await s.t.run(ctx => Promise.all(s.operationIds.map(id => ctx.db.get(id))));
  assert.equal(jobs[0]!.state, "submitted");
  assert.ok(jobs.slice(1).every(job => job!.state === "cancelled"));
  await s.staff.mutation(ref("cancel"), { batchId: s.batchId });
  assert.deepEqual(await s.t.run(ctx => ctx.db.query("clubOperationNotifications").collect()), []);
});
it("batch cancellation checks each current payload, original actor and community atomically", async () => {
  for (const change of ["revoked", "payload", "actor", "community"] as const) {
    const s = await cancellationSetup(2);
    const original = await s.t.run(ctx => ctx.db.get(s.operationIds[1]));
    await s.t.run(async ctx => {
      if (change === "revoked") await ctx.db.patch(s.roleId, { permissions: [] });
      if (change === "payload") await ctx.db.patch(s.operationIds[1], {
        payload: { kind: "close_instance", worldId: "wrld_11111111-1111-1111-1111-111111111111", instanceId: "123" },
      });
      if (change === "actor") await ctx.db.patch(s.operationIds[1], {
        actor: { ...s.subject, subject: "other", tokenIdentifier: `${s.subject.issuer}|other` },
      });
      if (change === "community") {
        const profile = await ctx.db.get(s.communityProfileId);
        const { _id, _creationTime, ...fields } = profile!;
        const other = await ctx.db.insert("profiles", { ...fields, slug: "other-club" });
        await ctx.db.patch(s.operationIds[1], { communityProfileId: other });
        // Make the current actor owner there too: the expected-community guard
        // must reject even when an independent authorization would succeed.
        const owner = await ctx.db.query("profileOwners").first();
        const { _id: ownerId, _creationTime: created, ...ownerFields } = owner!;
        await ctx.db.insert("profileOwners", { ...ownerFields, profileId: other });
      }
    });
    const caller = change === "community" ? s.owner : s.staff;
    await assert.rejects(caller.mutation(ref("cancel"), { batchId: s.batchId }));
    const jobs = await s.t.run(ctx => Promise.all(s.operationIds.map(id => ctx.db.get(id))));
    assert.ok(jobs.every(job => job!.state === "pending"), `${change} denial must roll back earlier cancellation`);
    if (change === "actor") {
      await s.t.run(ctx => ctx.db.patch(s.roleId, { permissions: ["invite_group_members", "manage_scheduled_actions"] }));
      await s.staff.mutation(ref("cancel"), { batchId: s.batchId });
      assert.equal((await s.t.run(ctx => ctx.db.get(original!._id)))!.state, "cancelled");
    }
    assert.deepEqual(await s.t.run(ctx => ctx.db.query("clubOperationNotifications").collect()), []);
  }
});
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
    await owner.mutation(ref("removeList"), { communityProfileId, listId, expectedRevision: 1 });
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
  const mixedCase = "usr_AaAaAaAa-bBbB-cCcC-dDdD-eEeEeEeEeEeE";
  assert.deepEqual(normalizeRecipients([mixedCase, mixedCase.toLowerCase()]), [
    mixedCase.toLowerCase(),
  ]);
  assert.throws(() => normalizeRecipients([]));
  assert.throws(() => normalizeRecipients(["all-members"]));
  assert.throws(() => normalizeRecipients(Array(101).fill(first)));
});
it("preview and enqueue use one canonical target for differently cased user IDs", async () => {
  const { t, owner, communityProfileId } = await setup();
  const mixedCase = "usr_AaAaAaAa-bBbB-cCcC-dDdD-eEeEeEeEeEeE";
  const recipients = [mixedCase, mixedCase.toLowerCase()];
  const preview = await owner.query(ref("preview"), { communityProfileId, recipients });
  assert.deepEqual(preview, {
    recipients: [mixedCase.toLowerCase()],
    removedDuplicates: 1,
  });
  const batchId = await owner.mutation(ref("enqueue"), {
    communityProfileId,
    requestId: "case_insensitive_batch",
    reviewedRecipients: recipients,
    destination: { kind: "group" },
    schedule: { kind: "fixed", dueAt: Date.now() + 60_000 },
  });
  const batch = await t.run((ctx) => ctx.db.get(batchId));
  assert.deepEqual(batch!.recipients, [mixedCase.toLowerCase()]);
  assert.equal(batch!.operationIds.length, 1);
});
it("event invitation enqueue keeps the exact reviewed time across event edits", async () => {
  const { t, owner, communityProfileId } = await setup();
  const reviewedDueAt = Date.now() + 3600_000;
  const eventId = await t.run((ctx) => ctx.db.insert("events", {
    slug: "invitation-event", title: "Invitation event", sortTitle: "invitation event",
    sourceType: "manual", sourceLabel: "test", communityProfileId,
    startAt: reviewedDueAt, publicationState: "published",
    eventStatus: "scheduled", updatedAt: Date.now(),
  }));
  const args = {
    communityProfileId,
    requestId: "reviewed_event_batch",
    reviewedRecipients: [first],
    destination: { kind: "group" as const },
    schedule: { kind: "event_relative" as const, eventId, offsetMs: 0 },
    reviewedDueAt,
  };
  await t.run((ctx) => ctx.db.patch(eventId, { startAt: reviewedDueAt + 3600_000 }));
  await assert.rejects(owner.mutation(ref("enqueue"), args), /Refresh to continue/);
  assert.equal((await t.run((ctx) => ctx.db.query("clubOperations").collect())).length, 0);
  await assert.rejects(owner.mutation(ref("enqueue"), { ...args, reviewedDueAt: undefined }), /Refresh to continue/);
  const updated = { ...args, reviewedDueAt: reviewedDueAt + 3600_000 };
  const batchId = await owner.mutation(ref("enqueue"), updated);
  const batch = await t.run((ctx) => ctx.db.get(batchId));
  const operation = await t.run((ctx) => ctx.db.get(batch!.operationIds[0]));
  assert.equal(operation!.dueAt, updated.reviewedDueAt);
  await t.run((ctx) => ctx.db.patch(eventId, { startAt: reviewedDueAt + 7200_000 }));
  assert.equal(await owner.mutation(ref("enqueue"), updated), batchId);
  await assert.rejects(owner.mutation(ref("enqueue"), {
    ...updated, requestId: "expired_review_batch", reviewedDueAt: Date.now() - 1000,
  }), /Refresh to continue/);
  await assert.rejects(owner.mutation(ref("enqueue"), {
    ...updated, requestId: "changed_fixed_review_batch",
    schedule: { kind: "fixed", dueAt: reviewedDueAt + 9000_000 },
  }), /Refresh to continue/);
});
it("a stale displayed recipient list cannot be deleted after another staff edit", async () => {
  const { t, owner, communityProfileId } = await setup();
  const listId = await owner.mutation(ref("saveList"), {
    communityProfileId, name: "Guests", recipients: [first],
  });
  await owner.mutation(ref("saveList"), {
    communityProfileId, listId, expectedRevision: 1,
    name: "Updated guests", recipients: [second],
  });
  await assert.rejects(owner.mutation(ref("removeList"), {
    communityProfileId, listId, expectedRevision: 1,
  }), /List changed/);
  const current = await t.run((ctx) => ctx.db.get(listId));
  assert.equal(current?.revision, 2);
  assert.deepEqual(current?.recipients, [second]);
  await owner.mutation(ref("removeList"), {
    communityProfileId, listId, expectedRevision: 2,
  });
  assert.equal(await t.run((ctx) => ctx.db.get(listId)), null);
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
    operationId: creationOperationId, expectedRevision: reviewed.revision, payload: { ...creation, access: "plus" }, schedule,
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

it("immediate batches replay stable server times and reject changed review inputs", async (test) => {
  const { t, owner, communityProfileId } = await setup();
  const now = Date.now();
  test.mock.method(Date, "now", () => now);
  const args = {
    communityProfileId,
    requestId: "immediate_batch",
    reviewedRecipients: [first, second],
    destination: { kind: "group" },
    schedule: { kind: "immediate" },
  };
  const id = await owner.mutation(ref("enqueue"), args);
  const original = await t.run(async (ctx) => {
    const batch = await ctx.db.get(id);
    return Promise.all(
      batch!.operationIds.map((operationId) => ctx.db.get(operationId)),
    );
  });
  assert.ok(
    original.every((job) => job!.dueAt === now && job!.readyAt === now),
  );
  test.mock.method(Date, "now", () => now + 3600000);
  assert.equal(await owner.mutation(ref("enqueue"), args), id);
  assert.deepEqual(
    await t.run((ctx) =>
      Promise.all(original.map((job) => ctx.db.get(job!._id))),
    ),
    original,
  );
  for (const change of [
    { reviewedRecipients: [first] },
    {
      destination: {
        kind: "instance",
        worldId: "wrld_11111111-1111-1111-1111-111111111111",
        instanceId: "123",
      },
    },
    { schedule: { kind: "fixed", dueAt: now + 7200000 } },
  ])
    await assert.rejects(
      owner.mutation(ref("enqueue"), { ...args, ...change }),
    );
});
