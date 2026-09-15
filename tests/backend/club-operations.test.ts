import assert from "node:assert/strict";
import { it, after } from "node:test";
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import schemaModule from "../../convex/schema";
const schema =
  (schemaModule as unknown as { default?: typeof schemaModule }).default ??
  schemaModule;
const modules = {
  "../../convex/communityTelemetry.ts": () =>
    import("../../convex/communityTelemetry"),
  "../../convex/clubOperations.ts": () => import("../../convex/clubOperations"),
  "../../convex/_generated/api.ts": () => import("../../convex/_generated/api"),
};
const ref = (name: string) =>
  makeFunctionReference<any>(`clubOperations:${name}`);
const oldIssuer = process.env.CLERK_JWT_ISSUER_DOMAIN;
process.env.CLERK_JWT_ISSUER_DOMAIN = "https://test.clerk.accounts.dev";
after(() => {
  if (oldIssuer === undefined) delete process.env.CLERK_JWT_ISSUER_DOMAIN;
  else process.env.CLERK_JWT_ISSUER_DOMAIN = oldIssuer;
});
async function setup() {
  const t = convexTest({ schema, modules });
  const now = Date.now();
  const identity = {
    subject: "owner",
    issuer: "https://test.clerk.accounts.dev",
    tokenIdentifier: "https://test.clerk.accounts.dev|owner",
  };
  const ids = await t.run(async (ctx) => {
    const user = await ctx.db.insert("users", { clerkUserId: "owner" });
    const communityProfileId = await ctx.db.insert("profiles", {
      slug: "connection-club",
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
      profileId: communityProfileId,
      userId: user,
      roleKey: "owner",
      state: "active",
      grantedAt: now,
      updatedAt: now,
    });
    const collectorAccountId = await ctx.db.insert("collectorAccounts", {
      vrchatUserId: "usr_22222222-2222-2222-2222-222222222222",
      accountAlias: "bot",
      state: "ready",
      capacity: 10,
      reservedHeadroom: 0,
      assignedGroupCount: 1,
      requestsPerMinute: 30,
      secretRef: "secret",
      workerKeyHash: "hash",
      credentialGeneration: 1,
      killSwitchEnabled: false,
      createdAt: now,
      updatedAt: now,
    });
    const integrationId = await ctx.db.insert("communityVrchatIntegrations", {
      communityProfileId,
      vrchatGroupId: "grp_11111111-1111-1111-1111-111111111111",
      groupVisibility: "public",
      joinPolicy: "free",
      state: "active",
      assignedCollectorAccountId: collectorAccountId,
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
      telemetryEpochStartedAt: now - 1000,
      createdAt: now - 1000,
      updatedAt: now,
    });
    const leaseId = await ctx.db.insert("collectorAccountLeases", {
      integrationId,
      collectorAccountId,
      workerId: "worker",
      fencingToken: 1,
      state: "active",
      claimedAt: now,
      expiresAt: now + 60000,
      updatedAt: now,
    });
    const roleId = await ctx.db.insert("communityRoles", {
      communityProfileId,
      key: "staff",
      label: "Staff",
      permissions: ["manage_integrations"],
      assignableRoleIds: [],
      state: "active",
      createdAt: now,
      updatedAt: now,
    });
    return {
      communityProfileId,
      collectorAccountId,
      integrationId,
      leaseId,
      roleId,
    };
  });
  return {
    t,
    owner: t.withIdentity(identity),
    ...ids,
    snapshot: {
      collectorAccountId: ids.collectorAccountId,
      integrationId: ids.integrationId,
      workerKeyHash: "hash",
      workerId: "worker",
      fencingToken: 1,
      epochStartedAt: now - 1000,
      authority: {
        groupId: "grp_11111111-1111-1111-1111-111111111111",
        userId: "usr_22222222-2222-2222-2222-222222222222",
        membershipStatus: "member",
        permissions: ["group-members-manage"],
        observedAt: now,
      },
    },
  };
}
async function queued() {
  const s = await setup();
  await s.t.run((ctx) =>
    ctx.db.patch(s.integrationId, {
      enabledFeatures: ["posts", "membership_management", "instances"],
    }),
  );
  const payload = {
    kind: "publish_post",
    title: "Test post",
    text: "Fixture post",
    visibility: "group",
    sendNotification: false,
  };
  const ids = await s.owner.mutation(ref("enqueue"), {
    communityProfileId: s.communityProfileId,
    requestId: "request_123",
    payloads: [payload],
    schedule: { kind: "fixed", dueAt: Date.now() },
  });
  const worker = {
    collectorAccountId: s.collectorAccountId,
    integrationId: s.integrationId,
    workerKeyHash: "hash",
    workerId: "worker",
    fencingToken: 1,
  };
  const authority = {
    ...s.snapshot.authority,
    ownerUserId: "usr_33333333-3333-3333-3333-333333333333",
    permissions: ["group-announcement-manage"],
  };
  return { ...s, operationId: ids[0], worker, authority };
}
it("dependent invitations wait for the selected creation and use only its confirmed destination", async () => {
  const s = await queued();
  const worldId = "wrld_44444444-4444-4444-4444-444444444444";
  const targetUserId = "usr_55555555-5555-5555-5555-555555555555";
  await s.t.run((ctx) =>
    ctx.db.patch(s.operationId, {
      payload: {
        kind: "create_instance",
        worldId,
        access: "members",
        region: "us",
      },
      readyAt: Date.now() + 3600000,
    }),
  );
  const [inviteId] = await s.owner.mutation(ref("enqueue"), {
    communityProfileId: s.communityProfileId,
    requestId: "dependent_invite",
    payloads: [
      {
        kind: "invite_to_created_instance",
        creationOperationId: s.operationId,
        targetUserId,
      },
    ],
    schedule: { kind: "fixed", dueAt: Date.now() },
  });
  assert.equal(await s.t.mutation(ref("claim"), s.worker), null);
  assert.equal(
    (await s.t.run((ctx) => ctx.db.get(inviteId)))!.state,
    "pending",
  );
  const instanceId =
    "123~group(grp_11111111-1111-1111-1111-111111111111)~groupAccessType(members)";
  await s.t.run(async (ctx) => {
    await ctx.db.patch(s.operationId, {
      state: "succeeded",
      result: { worldId, instanceId },
    });
    await ctx.db.patch(inviteId, { readyAt: Date.now() });
  });
  const claim = await s.t.mutation(ref("claim"), s.worker);
  assert.deepEqual(claim.payload, {
    kind: "invite_to_instance",
    targetUserId,
    worldId,
    instanceId,
  });
  assert.equal(
    (await s.t.run((ctx) => ctx.db.get(inviteId)))!.payload.kind,
    "invite_to_created_instance",
  );
  assert.deepEqual(
    await s.t.mutation(ref("authorizeSubmission"), {
      ...s.worker,
      operationId: inviteId,
      nonce: claim.nonce,
      authority: s.authority,
      friendship: "friend",
    }),
    { authorized: true, code: null },
  );
});
it("dependent invitations cannot precede creation and later parent timing changes reject without detaching schedules", async () => {
  const s = await queued();
  const dueAt = Date.now() + 60000;
  await s.t.run((ctx) =>
    ctx.db.patch(s.operationId, {
      payload: {
        kind: "create_instance",
        worldId: "wrld_44444444-4444-4444-4444-444444444444",
        access: "members",
        region: "us",
      },
      dueAt,
      readyAt: dueAt,
      schedule: { kind: "fixed", dueAt },
    }),
  );
  const payload = {
    kind: "invite_to_created_instance",
    creationOperationId: s.operationId,
    targetUserId: "usr_55555555-5555-5555-5555-555555555555",
  };
  const args = {
    communityProfileId: s.communityProfileId,
    requestId: "timing_invite",
    payloads: [payload],
    schedule: { kind: "fixed", dueAt: Date.now() },
  };
  await assert.rejects(
    s.owner.mutation(ref("enqueue"), args),
    /before instance creation/,
  );
  const [id] = await s.owner.mutation(ref("enqueue"), {
    ...args,
    schedule: { kind: "fixed", dueAt },
  });
  await assert.rejects(
    s.owner.mutation(ref("edit"), {
      operationId: id,
      payload,
      schedule: args.schedule,
    }),
    /before instance creation/,
  );
  await s.t.run(async (ctx) => {
    await ctx.db.patch(s.operationId, {
      dueAt: dueAt + 60000,
      schedule: { kind: "fixed", dueAt: dueAt + 60000 },
    });
    await ctx.db.patch(id, { readyAt: Date.now() });
  });
  assert.equal(await s.t.mutation(ref("claim"), s.worker), null);
  const rejected = await s.t.run((ctx) => ctx.db.get(id));
  assert.equal(rejected!.code, "instance_creation_rescheduled");
  assert.deepEqual(rejected!.schedule, { kind: "fixed", dueAt });
  assert.equal(rejected!.payload.kind, "invite_to_created_instance");
  const eventId = await s.t.run(async (ctx) => {
    const eventId = await ctx.db.insert("events", {
      slug: "dependency-time",
      title: "Event",
      sortTitle: "event",
      startAt: dueAt + 120000,
      communityProfileId: s.communityProfileId,
      sourceType: "manual",
      sourceLabel: "test",
      eventStatus: "scheduled",
      publicationState: "published",
      publishedAt: Date.now(),
      updatedAt: Date.now(),
    });
    await ctx.db.patch(s.operationId, {
      eventId,
      schedule: { kind: "event_relative", eventId, offsetMs: 0 },
      dueAt: Date.now(),
    });
    return eventId;
  });
  await assert.rejects(
    s.owner.mutation(ref("enqueue"), {
      ...args,
      requestId: "event_timing_invite",
      schedule: { kind: "fixed", dueAt },
    }),
    /before instance creation/,
  );
  const [relativeId] = await s.owner.mutation(ref("enqueue"), {
    ...args,
    requestId: "relative_invite",
    schedule: { kind: "event_relative", eventId, offsetMs: 60000 },
  });
  const relative = await s.t.run((ctx) => ctx.db.get(relativeId));
  assert.equal(relative!.dueAt, dueAt + 180000);
});
it("failed or foreign creation never substitutes another destination", async () => {
  const s = await queued();
  const worldId = "wrld_44444444-4444-4444-4444-444444444444";
  await s.t.run((ctx) =>
    ctx.db.patch(s.operationId, {
      payload: {
        kind: "create_instance",
        worldId,
        access: "members",
        region: "us",
      },
      readyAt: Date.now() + 3600000,
    }),
  );
  const [inviteId] = await s.owner.mutation(ref("enqueue"), {
    communityProfileId: s.communityProfileId,
    requestId: "dependent_failure",
    payloads: [
      {
        kind: "invite_to_created_instance",
        creationOperationId: s.operationId,
        targetUserId: "usr_55555555-5555-5555-5555-555555555555",
      },
    ],
    schedule: { kind: "fixed", dueAt: Date.now() },
  });
  await s.t.run((ctx) =>
    ctx.db.patch(s.operationId, { state: "indeterminate" }),
  );
  assert.equal(await s.t.mutation(ref("claim"), s.worker), null);
  assert.equal(
    (await s.t.run((ctx) => ctx.db.get(inviteId)))!.code,
    "instance_creation_failed",
  );
  await assert.rejects(
    s.owner.mutation(ref("enqueue"), {
      communityProfileId: s.communityProfileId,
      requestId: "failed_reuse",
      payloads: [
        {
          kind: "invite_to_created_instance",
          creationOperationId: s.operationId,
          targetUserId: "usr_55555555-5555-5555-5555-555555555555",
        },
      ],
      schedule: { kind: "fixed", dueAt: Date.now() },
    }),
  );
});
it("more than100 deferred targets cannot hide a runnable target", async () => {
  const s = await queued();
  const readyId = await s.t.run(async (ctx) => {
    const stored = await ctx.db.get(s.operationId);
    const { _id, _creationTime, ...job } = stored!;
    await ctx.db.patch(s.operationId, {
      retryAt: Date.now() + 60000,
      readyAt: Date.now() + 60000,
    });
    for (let i = 0; i < 101; i++)
      await ctx.db.insert("clubOperations", {
        ...job,
        requestId: `deferred_${i}`,
        readyAt: Date.now() + 60000,
        retryAt: Date.now() + 60000,
      });
    return await ctx.db.insert("clubOperations", {
      ...job,
      requestId: "ready_after_deferred",
      readyAt: Date.now(),
    });
  });
  assert.equal(
    (await s.t.mutation(ref("claim"), s.worker)).operationId,
    readyId,
  );
});
it("claims survive rate-budget waits over60 seconds but never outlive their lease", async () => {
  const s = await queued();
  const now = Date.now();
  await s.t.run((ctx) => ctx.db.patch(s.leaseId, { expiresAt: now + 300000 }));
  const claim = await s.t.mutation(ref("claim"), s.worker);
  const stored = await s.t.run((ctx) => ctx.db.get(s.operationId));
  assert.equal(claim.executeBefore, stored!.dueAt + 15 * 60000);
  assert.ok(stored!.claim!.expiresAt > now + 60000);
  assert.ok(stored!.claim!.expiresAt <= now + 241000);
  const realNow = Date.now;
  try {
    Date.now = () => now + 90000;
    assert.deepEqual(
      await s.t.mutation(ref("authorizeSubmission"), {
        ...s.worker,
        operationId: s.operationId,
        nonce: claim.nonce,
        authority: { ...s.authority, observedAt: Date.now() },
      }),
      { authorized: true, code: null },
    );
  } finally {
    Date.now = realNow;
  }
  const other = await queued();
  const otherClaim = await other.t.mutation(ref("claim"), other.worker);
  await other.t.run((ctx) => ctx.db.patch(other.leaseId, { expiresAt: 0 }));
  assert.deepEqual(
    await other.t.mutation(ref("authorizeSubmission"), {
      ...other.worker,
      operationId: other.operationId,
      nonce: otherClaim.nonce,
      authority: other.authority,
    }),
    { authorized: false, code: "claim_unavailable" },
  );
});
it("preflight retries preserve schedule, are bounded, and cannot requeue submitted writes", async () => {
  const s = await queued();
  const original = (await s.t.run((ctx) => ctx.db.get(s.operationId)))!.dueAt;
  for (let i = 0; i < 3; i++) {
    const claim = await s.t.mutation(ref("claim"), s.worker);
    assert.ok(claim);
    const result = await s.t.mutation(ref("deferClaim"), {
      ...s.worker,
      operationId: s.operationId,
      nonce: claim.nonce,
      code: "rate_limit",
      retryAfterMs: 1000,
    });
    assert.equal(result.recorded, true);
    const job = await s.t.run((ctx) => ctx.db.get(s.operationId));
    assert.equal(job!.dueAt, original);
    if (i < 2) {
      assert.equal(await s.t.mutation(ref("claim"), s.worker), null);
      await s.t.run((ctx) =>
        ctx.db.patch(s.operationId, { retryAt: 0, readyAt: 0 }),
      );
    } else assert.equal(job!.code, "preflight_retries_exhausted");
  }
  const other = await queued();
  const claim = await other.t.mutation(ref("claim"), other.worker);
  await other.t.mutation(ref("authorizeSubmission"), {
    ...other.worker,
    operationId: other.operationId,
    nonce: claim.nonce,
    authority: other.authority,
  });
  assert.deepEqual(
    await other.t.mutation(ref("deferClaim"), {
      ...other.worker,
      operationId: other.operationId,
      nonce: claim.nonce,
      code: "network",
      retryAfterMs: 1000,
    }),
    { recorded: false, retryAt: null },
  );
});
it("releasing telemetry leases restores immediate and future queued operation wakeups", async () => {
  for (const delay of [0, 120000]) {
    const s = await queued();
    const now = Date.now();
    await s.t.run(async (ctx) => {
      await ctx.db.patch(s.operationId, {
        dueAt: now + delay,
        readyAt: now + delay,
      });
      await ctx.db.patch(s.integrationId, { nextPollAt: now + 300000 });
    });
    const { workerKeyHash, ...lease } = s.worker;
    await s.t.mutation(
      makeFunctionReference<any>("communityTelemetry:releaseLease"),
      { ...lease, now },
    );
    assert.equal(
      (await s.t.run((ctx) => ctx.db.get(s.integrationId)))!.nextPollAt,
      now + delay,
    );
  }
});
it("rebases an event moved later before considering its old time missed", async () => {
  const s = await queued();
  const now = Date.now();
  const eventId = await s.t.run(async (ctx) => {
    const eventId = await ctx.db.insert("events", {
      title: "Event",
      sortTitle: "event",
      startAt: now + 3600000,
      communityProfileId: s.communityProfileId,
      sourceType: "manual",
      sourceLabel: "test",
      eventStatus: "scheduled",
      publicationState: "published",
      updatedAt: now,
    });
    await ctx.db.patch(s.operationId, {
      eventId,
      schedule: { kind: "event_relative", eventId, offsetMs: 0 },
      dueAt: now - 3600000,
    });
    return eventId;
  });
  assert.equal(await s.t.mutation(ref("claim"), s.worker), null);
  const job = await s.t.run((ctx) => ctx.db.get(s.operationId));
  assert.equal(job!.state, "pending");
  assert.equal(job!.dueAt, now + 3600000);
  await s.t.run(async (ctx) => {
    await ctx.db.patch(eventId, { eventStatus: "cancelled" });
    await ctx.db.patch(s.operationId, {
      dueAt: Date.now(),
      readyAt: Date.now(),
    });
  });
  assert.equal(await s.t.mutation(ref("claim"), s.worker), null);
  assert.equal(
    (await s.t.run((ctx) => ctx.db.get(s.operationId)))!.state,
    "cancelled",
  );
});
it("preflight failure records a rejection without submission and cannot affect another nonce", async () => {
  const s = await queued();
  const job = await s.t.mutation(ref("claim"), s.worker);
  assert.deepEqual(
    await s.t.mutation(ref("rejectClaim"), {
      ...s.worker,
      operationId: s.operationId,
      nonce: "wrong",
      code: "authentication",
    }),
    { recorded: false },
  );
  assert.deepEqual(
    await s.t.mutation(ref("rejectClaim"), {
      ...s.worker,
      operationId: s.operationId,
      nonce: job.nonce,
      code: "authentication",
    }),
    { recorded: true },
  );
  assert.equal(
    (await s.t.run((ctx) => ctx.db.get(s.operationId)))!.submittedAt,
    undefined,
  );
});
it("editing another actor's job requires scheduling authority and reattributes execution", async () => {
  const s = await queued();
  const subject = {
    subject: "staff",
    issuer: "https://test.clerk.accounts.dev",
    tokenIdentifier: "https://test.clerk.accounts.dev|staff",
  };
  await s.t.run(async (ctx) => {
    await ctx.db.insert("users", { clerkUserId: "staff" });
    await ctx.db.patch(s.roleId, { permissions: ["publish_posts"] });
    await ctx.db.insert("communityAuthorities", {
      communityProfileId: s.communityProfileId,
      subject,
      subjectTokenIdentifier: subject.tokenIdentifier,
      roleId: s.roleId,
      state: "active",
      grantedAt: Date.now(),
      updatedAt: Date.now(),
    });
  });
  const staff = s.t.withIdentity(subject);
  const payload = {
    kind: "publish_post",
    title: "Changed",
    text: "Changed body",
    visibility: "group",
    sendNotification: false,
  };
  const schedule = { kind: "fixed", dueAt: Date.now() };
  await assert.rejects(
    staff.mutation(ref("edit"), {
      operationId: s.operationId,
      payload,
      schedule,
    }),
  );
  await s.t.run((ctx) =>
    ctx.db.patch(s.roleId, {
      permissions: ["publish_posts", "manage_scheduled_actions"],
    }),
  );
  await staff.mutation(ref("edit"), {
    operationId: s.operationId,
    payload,
    schedule,
  });
  assert.equal(
    (await s.t.run((ctx) => ctx.db.get(s.operationId)))!.actor.subject,
    "staff",
  );
  const job = await s.t.mutation(ref("claim"), s.worker);
  await s.t.run((ctx) => ctx.db.patch(s.roleId, { permissions: [] }));
  assert.deepEqual(
    await s.t.mutation(ref("authorizeSubmission"), {
      ...s.worker,
      operationId: s.operationId,
      nonce: job.nonce,
      authority: s.authority,
    }),
    { authorized: false, code: "staff_permission" },
  );
});
it("claims, authorizes, completes once and never replays submitted writes", async () => {
  const s = await queued();
  const claim = await s.t.mutation(ref("claim"), s.worker);
  assert.equal(claim.operationId, s.operationId);
  assert.deepEqual(
    await s.t.mutation(ref("authorizeSubmission"), {
      ...s.worker,
      operationId: s.operationId,
      nonce: claim.nonce,
      authority: s.authority,
    }),
    { authorized: true, code: null },
  );
  assert.equal(await s.t.mutation(ref("claim"), s.worker), null);
  assert.deepEqual(
    await s.t.mutation(ref("complete"), {
      ...s.worker,
      operationId: s.operationId,
      nonce: claim.nonce,
      status: "succeeded",
    }),
    { recorded: true },
  );
  assert.deepEqual(
    await s.t.mutation(ref("complete"), {
      ...s.worker,
      operationId: s.operationId,
      nonce: claim.nonce,
      status: "succeeded",
    }),
    { recorded: false },
  );
});
it("authorized but definitively unsent completion is rejected and never automatically replayed", async () => {
  const s = await queued();
  const claim = await s.t.mutation(ref("claim"), s.worker);
  await s.t.mutation(ref("authorizeSubmission"), {...s.worker,operationId:s.operationId,nonce:claim.nonce,authority:s.authority});
  assert.deepEqual(await s.t.mutation(ref("complete"), {...s.worker,operationId:s.operationId,nonce:claim.nonce,status:"rejected",code:"submission_not_attempted"}), {recorded:true});
  assert.equal(await s.t.mutation(ref("claim"),s.worker),null);
  const stored = await s.t.run(ctx => ctx.db.get(s.operationId));
  assert.equal(stored!.state,"rejected");
  assert.equal(stored!.code,"submission_not_attempted");
});
it("feature revocation between claim and submit prevents the write", async () => {
  const s = await queued();
  const claim = await s.t.mutation(ref("claim"), s.worker);
  await s.t.run((ctx) =>
    ctx.db.patch(s.integrationId, { enabledFeatures: [] }),
  );
  assert.deepEqual(
    await s.t.mutation(ref("authorizeSubmission"), {
      ...s.worker,
      operationId: s.operationId,
      nonce: claim.nonce,
      authority: s.authority,
    }),
    { authorized: false, code: "feature_disabled" },
  );
});
it("submission timeout is indeterminate, while an expired unsubmitted claim can recover", async () => {
  const s = await queued();
  let claim = await s.t.mutation(ref("claim"), s.worker);
  await s.t.run(async (ctx) => {
    const job = await ctx.db.get(s.operationId);
    await ctx.db.patch(s.operationId, {
      claim: { ...job!.claim!, expiresAt: 0 },
    });
  });
  const recovered = await s.t.mutation(ref("claim"), s.worker);
  assert.notEqual(recovered.nonce, claim.nonce);
  claim = recovered;
  await s.t.mutation(ref("authorizeSubmission"), {
    ...s.worker,
    operationId: s.operationId,
    nonce: claim.nonce,
    authority: s.authority,
  });
  await s.t.run(async (ctx) => {
    const job = await ctx.db.get(s.operationId);
    await ctx.db.patch(s.operationId, {
      claim: { ...job!.claim!, expiresAt: 0 },
    });
  });
  assert.equal(await s.t.mutation(ref("claim"), s.worker), null);
  assert.equal(
    (await s.t.run((ctx) => ctx.db.get(s.operationId)))!.state,
    "indeterminate",
  );
});
it("expired grace is missed and cross-account claims are denied", async () => {
  const s = await queued();
  assert.equal(
    await s.t.mutation(ref("claim"), { ...s.worker, workerKeyHash: "foreign" }),
    null,
  );
  await s.t.run((ctx) =>
    ctx.db.patch(s.operationId, { dueAt: Date.now() - 16 * 60000 }),
  );
  assert.equal(await s.t.mutation(ref("claim"), s.worker), null);
  assert.equal(
    (await s.t.run((ctx) => ctx.db.get(s.operationId)))!.state,
    "missed",
  );
});
it("rejects bulk bans and invalid provider targets before persisting a batch", async () => {
  const s = await queued();
  const payload = {
    kind: "ban_member",
    targetUserId: "usr_44444444-4444-4444-4444-444444444444",
  };
  await assert.rejects(
    s.owner.mutation(ref("enqueue"), {
      communityProfileId: s.communityProfileId,
      requestId: "invalid_batch",
      payloads: [payload, payload],
      schedule: { kind: "fixed", dueAt: Date.now() },
    }),
  );
  assert.equal(
    (
      await s.t.run((ctx) =>
        ctx.db
          .query("clubOperations")
          .withIndex("by_community_requestId", (q) =>
            q
              .eq("communityProfileId", s.communityProfileId)
              .eq("requestId", "invalid_batch"),
          )
          .take(101),
      )
    ).length,
    0,
  );
});
