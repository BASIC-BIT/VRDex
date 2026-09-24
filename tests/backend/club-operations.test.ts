import assert from "node:assert/strict";
import { it, after, beforeEach } from "node:test";
import { convexTest } from "convex-test";
import { getFunctionName, makeFunctionReference } from "convex/server";
import type { ActionCtx } from "../../convex/_generated/server";
import schemaModule from "../../convex/schema";
const schema =
  (schemaModule as unknown as { default?: typeof schemaModule }).default ??
  schemaModule;
const modules = {
  "../../convex/http.ts": () => import("../../convex/http"),
  "../../convex/communityTelemetry.ts": () =>
    import("../../convex/communityTelemetry"),
  "../../convex/clubOperations.ts": () => import("../../convex/clubOperations"),
  "../../convex/_generated/api.ts": () => import("../../convex/_generated/api"),
};
const ref = (name: string) =>
  makeFunctionReference<any>(`clubOperations:${name}`);
beforeEach((test) => test.mock.timers.enable({ apis: ["setTimeout"] }));
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
it("preflight retry validation retains zero, short and exact-deadline delays", async test => {
  const now = Date.now();
  test.mock.method(Date, "now", () => now);
  for (const delay of [-1, Infinity, NaN]) {
    const s = await queued();
    const claim = await s.t.mutation(ref("claim"), s.worker);
    await assert.rejects(s.t.mutation(ref("deferClaim"), { ...s.worker, operationId: s.operationId, nonce: claim.nonce, code: "rate_limit", retryAfterMs: delay }), /Invalid preflight retry delay/);
    assert.equal((await s.t.run(ctx => ctx.db.get(s.operationId)))!.state, "claimed");
  }
  for (const delay of [0, 1000, 15 * 60_000]) {
    const s = await queued();
    const claim = await s.t.mutation(ref("claim"), s.worker);
    const result = await s.t.mutation(ref("deferClaim"), { ...s.worker, operationId: s.operationId, nonce: claim.nonce, code: "rate_limit", retryAfterMs: delay });
    assert.deepEqual(result, { recorded: true, retryAt: now + Math.max(1000, delay) });
    assert.equal((await s.t.run(ctx => ctx.db.get(s.operationId)))!.state, "pending");
    assert.deepEqual(await s.t.run(ctx => ctx.db.query("clubOperationNotifications").collect()), []);
  }
});
it("long provider delays settle the exact claim once without truncating backoff", async () => {
  for (const retryAfterMs of [30 * 60_000, 60 * 60_000, Number.MAX_VALUE]) {
    const s = await queued();
    const claim = await s.t.mutation(ref("claim"), s.worker);
    const args = { ...s.worker, operationId: s.operationId, nonce: claim.nonce,
      code: "rate_limit", retryAfterMs };
    assert.deepEqual(await s.t.mutation(ref("deferClaim"), args), { recorded: true, retryAt: null });
    assert.deepEqual(await s.t.mutation(ref("deferClaim"), args), { recorded: false, retryAt: null });
    const job = await s.t.run(ctx => ctx.db.get(s.operationId));
    assert.equal(job!.state, "missed");
    assert.equal(job!.code, "late_window_elapsed");
    assert.equal(job!.claim, undefined);
    assert.equal(job!.retryAt, undefined);
    const notices = await s.t.run(ctx => ctx.db.query("clubOperationNotifications").collect());
    assert.equal(notices.length, 1);
    assert.equal(notices[0].outcome, "missed");
    assert.equal(await s.t.mutation(ref("claim"), s.worker), null);
    if (retryAfterMs !== Number.MAX_VALUE) {
      const now = Date.now();
      await s.t.mutation(makeFunctionReference<any>("communityTelemetry:recordPollFailure"), {
        integrationId: s.integrationId, collectorAccountId: s.collectorAccountId,
        workerId: s.worker.workerId, fencingToken: s.worker.fencingToken,
        statusClass: "429", coverageState: "degraded", detail: "rate_limit",
        nextPollAt: now + retryAfterMs, backoffUntil: now + retryAfterMs,
        collectorVersion: "test", now,
      });
      const integration = await s.t.run(ctx => ctx.db.get(s.integrationId));
      assert.equal(integration!.backoffUntil, now + retryAfterMs);
      assert.equal(integration!.nextPollAt, now + retryAfterMs);
    }
  }
});
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
    epochStartedAt: s.snapshot.epochStartedAt,
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
async function workerKeyHash(key: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(key),
  );
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
async function submittedOverHttp() {
  const s = await queued();
  const key = "submitted-operation-worker-key-".repeat(2);
  const hash = await workerKeyHash(key);
  await s.t.run((ctx) =>
    ctx.db.patch(s.collectorAccountId, { workerKeyHash: hash }),
  );
  const request = async (
    operation: string,
    extra: Record<string, unknown> = {},
    accountId = s.collectorAccountId,
    bearer = key,
  ) =>
    s.t.fetch("/telemetry/worker", {
      method: "POST",
      headers: {
        authorization: `Bearer ${bearer}`,
        "content-type": "application/json",
        "x-vrdex-collector-account": accountId,
      },
      body: JSON.stringify({
        operation,
        workerId: s.worker.workerId,
        vrchatUserId: s.authority.userId,
        integrationId: s.integrationId,
        fencingToken: s.worker.fencingToken,
        epochStartedAt: s.worker.epochStartedAt,
        ...extra,
      }),
    });
  const claimed = await request("club_operation_claim");
  assert.equal(claimed.status, 200);
  const claim = await claimed.json();
  const target = { operationId: s.operationId, nonce: claim.nonce };
  const authorized = await request("club_operation_authorize", {
    ...target,
    authority: s.authority,
  });
  assert.deepEqual(await authorized.json(), { authorized: true, code: null });
  return {
    ...s,
    worker: { ...s.worker, workerKeyHash: hash },
    key,
    hash,
    request,
    target,
  };
}

for (const change of [
  "disconnect",
  "new_epoch",
  "integration_kill",
  "fleet_kill",
  "account_kill",
  "account_quarantine",
  "reassignment",
  "credential_generation",
  "lease_released",
  "lease_replaced",
  "lease_expired",
  "claim_expired",
] as const) {
  it(`HTTP records an exact submitted result after ${change}`, async () => {
    const s = await submittedOverHttp();
    const telemetry = (name: string) =>
      makeFunctionReference<any>(`communityTelemetry:${name}`);
    if (change === "integration_kill")
      await s.t.mutation(telemetry("setIntegrationKillSwitch"), {
        integrationId: s.integrationId,
        enabled: true,
      });
    else if (change === "fleet_kill")
      await s.t.mutation(telemetry("configureFleet"), {
        killSwitchEnabled: true,
        globalRequestsPerMinute: 30,
      });
    else if (change === "account_kill" || change === "account_quarantine")
      await s.t.mutation(telemetry("setCollectorAccountState"), {
        collectorAccountId: s.collectorAccountId,
        state: change === "account_quarantine" ? "quarantined" : "ready",
        killSwitchEnabled: change === "account_kill",
      });
    else if (change === "credential_generation")
      await s.t.mutation(telemetry("registerCollectorAccount"), {
        vrchatUserId: s.authority.userId,
        accountAlias: "rotated",
        secretRef: "secret://rotated",
        workerKeyHash: s.hash,
      });
    else
      await s.t.run(async (ctx) => {
        if (change === "disconnect")
          await ctx.db.patch(s.integrationId, {
            state: "disconnected",
            assignedCollectorAccountId: undefined,
          });
        if (change === "new_epoch")
          await ctx.db.patch(s.integrationId, {
            telemetryEpochStartedAt: s.worker.epochStartedAt + 1,
          });
        if (change === "reassignment") {
          const original = (await ctx.db.get(s.collectorAccountId))!;
          const { _id, _creationTime, ...account } = original;
          const replacement = await ctx.db.insert("collectorAccounts", {
            ...account,
            vrchatUserId: "usr_replacement",
          });
          await ctx.db.patch(s.integrationId, {
            assignedCollectorAccountId: replacement,
          });
        }
        if (change === "lease_released")
          await ctx.db.patch(s.leaseId, { state: "released" });
        if (change === "lease_replaced")
          await ctx.db.patch(s.leaseId, {
            workerId: "replacement",
            fencingToken: 2,
          });
        if (change === "lease_expired")
          await ctx.db.patch(s.leaseId, { expiresAt: 0 });
        if (change === "claim_expired") {
          const job = (await ctx.db.get(s.operationId))!;
          await ctx.db.patch(s.operationId, {
            claim: { ...job.claim!, expiresAt: 0 },
          });
        }
      });
    // No lifecycle change grants another submission or a release of submitted work.
    for (const operation of [
      "club_operation_authorize",
      "club_operation_reject",
      "club_operation_defer",
    ]) {
      const response = await s.request(operation, {
        ...s.target,
        authority: s.authority,
        code: "rate_limit",
        retryAfterMs: 1000,
      });
      if (response.status !== 423) {
        assert.equal(response.status, 200, await response.clone().text());
        const result = await response.json();
        assert.notEqual(result.authorized, true);
        assert.notEqual(result.recorded, true);
        assert.equal(result.retryAt ?? null, null);
      }
    }
    const response = await s.request("club_operation_complete", {
      ...s.target,
      status: "succeeded",
      result: { postId: "post_recorded" },
    });
    assert.equal(response.status, 200, await response.clone().text());
    assert.deepEqual(await response.json(), { recorded: true });
    const job = (await s.t.run((ctx) => ctx.db.get(s.operationId)))!;
    assert.equal(job.state, "succeeded");
    assert.equal(job.result?.postId, "post_recorded");
    assert.equal(job.claim?.credentialGeneration, 1);
    const duplicate = await s.request("club_operation_complete", {
      ...s.target,
      status: "rejected",
      code: "late_conflict",
    });
    assert.deepEqual(await duplicate.json(), { recorded: false });
    assert.equal(
      (await s.t.run((ctx) => ctx.db.get(s.operationId)))!.state,
      "succeeded",
    );
  });
}

it("HTTP completion rejects every mismatched stored claim field and revoked credentials", async () => {
  const s = await submittedOverHttp();
  const other = await s.t.run(async (ctx) => {
    const { _id, _creationTime, ...account } = (await ctx.db.get(
      s.collectorAccountId,
    ))!;
    const accountId = await ctx.db.insert("collectorAccounts", account);
    const {
      _id: integrationId,
      _creationTime: creationTime,
      ...integration
    } = (await ctx.db.get(s.integrationId))!;
    return {
      accountId,
      integrationId: await ctx.db.insert(
        "communityVrchatIntegrations",
        integration,
      ),
    };
  });
  for (const mismatch of [
    { nonce: "wrong" },
    { workerId: "wrong" },
    { fencingToken: 2 },
    { epochStartedAt: s.worker.epochStartedAt + 1 },
    { integrationId: other.integrationId },
  ]) {
    const response = await s.request("club_operation_complete", {
      ...s.target,
      status: "succeeded",
      ...mismatch,
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { recorded: false });
  }
  const crossAccount = await s.request(
    "club_operation_complete",
    { ...s.target, status: "succeeded" },
    other.accountId,
  );
  assert.deepEqual(await crossAccount.json(), { recorded: false });
  const wrongIdentity = await s.request("club_operation_complete", {
    ...s.target,
    status: "succeeded",
    vrchatUserId: "wrong",
  });
  assert.equal(wrongIdentity.status, 401);
  await s.t.run((ctx) =>
    ctx.db.patch(s.collectorAccountId, {
      workerKeyHash: "a".repeat(64),
      credentialGeneration: 2,
    }),
  );
  const revoked = await s.request("club_operation_complete", {
    ...s.target,
    status: "succeeded",
  });
  assert.equal(revoked.status, 401);
  // Mutation authentication closes the race after HTTP authentication.
  assert.deepEqual(
    await s.t.mutation(ref("complete"), {
      ...s.worker,
      ...s.target,
      status: "succeeded",
    }),
    { recorded: false },
  );
  assert.equal(
    (await s.t.run((ctx) => ctx.db.get(s.operationId)))!.state,
    "submitted",
  );
});

for (const state of [
  "provisioning",
  "degraded",
  "cooldown",
  "auth_required",
  "quarantined",
  "retiring",
  "retired",
] as const) {
  it(`HTTP allows only submitted completion from a ${state} account`, async () => {
    const s = await submittedOverHttp();
    await s.t.mutation(
      makeFunctionReference<any>("communityTelemetry:setCollectorAccountState"),
      {
        collectorAccountId: s.collectorAccountId,
        state,
      },
    );
    for (const operation of [
      "club_operation_claim",
      "club_operation_authorize",
      "club_operation_reject",
      "club_operation_defer",
      "heartbeat",
      "budget",
    ]) {
      const response = await s.request(operation, {
        ...s.target,
        authority: s.authority,
        code: "rate_limit",
        retryAfterMs: 1000,
      });
      assert.equal(response.status, 423);
      assert.deepEqual(await response.json(), { error: "collector_disabled" });
    }
    const wrongIdentity = await s.request("club_operation_complete", {
      ...s.target,
      status: "succeeded",
      vrchatUserId: "wrong",
    });
    assert.equal(wrongIdentity.status, 401);
    const wrongClaim = await s.request("club_operation_complete", {
      ...s.target,
      status: "succeeded",
      nonce: "wrong",
    });
    assert.deepEqual(await wrongClaim.json(), { recorded: false });
    const response = await s.request("club_operation_complete", {
      ...s.target,
      status: "rejected",
      code: "submission_not_attempted",
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { recorded: true });
    assert.equal(
      (await s.t.run((ctx) => ctx.db.get(s.operationId)))!.state,
      "rejected",
    );
  });
}

it("HTTP replacement worker key can report only the exact historical submitted claim", async () => {
  const s = await submittedOverHttp();
  const replacementKey = "replacement-operation-key-".repeat(2);
  await s.t.mutation(
    makeFunctionReference<any>("communityTelemetry:registerCollectorAccount"),
    {
      vrchatUserId: s.authority.userId,
      accountAlias: "rotated",
      secretRef: "secret://rotated",
      workerKeyHash: await workerKeyHash(replacementKey),
    },
  );
  const revoked = await s.request("club_operation_complete", {
    ...s.target,
    status: "succeeded",
  });
  assert.equal(revoked.status, 401);
  for (const mismatch of [
    { nonce: "wrong" },
    { workerId: "replacement_worker" },
    { fencingToken: 2 },
    { epochStartedAt: s.worker.epochStartedAt + 1 },
  ]) {
    const response = await s.request(
      "club_operation_complete",
      { ...s.target, status: "succeeded", ...mismatch },
      s.collectorAccountId,
      replacementKey,
    );
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { recorded: false });
  }
  const wrongIdentity = await s.request(
    "club_operation_complete",
    { ...s.target, status: "succeeded", vrchatUserId: "wrong" },
    s.collectorAccountId,
    replacementKey,
  );
  assert.equal(wrongIdentity.status, 401);
  const exact = await s.request(
    "club_operation_complete",
    { ...s.target, status: "succeeded", result: { postId: "post_recorded" } },
    s.collectorAccountId,
    replacementKey,
  );
  assert.deepEqual(await exact.json(), { recorded: true });
  const stored = (await s.t.run((ctx) => ctx.db.get(s.operationId)))!;
  assert.equal(stored.claim!.credentialGeneration, 1);
  assert.equal(
    (await s.t.run((ctx) => ctx.db.get(s.collectorAccountId)))!
      .credentialGeneration,
    2,
  );
});

it("HTTP completion rejects a key rotated while its body is being read", async (test) => {
  const s = await submittedOverHttp();
  const readJson = Request.prototype.json;
  let bodyReads = 0;
  // The actual request reaches body parsing after the first real auth query.
  test.mock.method(Request.prototype, "json", async function (this: Request) {
    const body = await readJson.call(this);
    bodyReads++;
    await s.t.mutation(
      makeFunctionReference<any>("communityTelemetry:registerCollectorAccount"),
      {
        vrchatUserId: s.authority.userId,
        accountAlias: "rotated",
        secretRef: "secret://rotated",
        workerKeyHash: "a".repeat(64),
      },
    );
    return body;
  });
  const response = await s.request("club_operation_complete", {
    ...s.target,
    status: "succeeded",
  });
  assert.equal(bodyReads, 1);
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "unauthorized" });
  assert.equal(
    (await s.t.run((ctx) => ctx.db.get(s.operationId)))!.state,
    "submitted",
  );
});

it("HTTP completion rejects rotation after admission and before the real completion mutation", async (test) => {
  const s = await submittedOverHttp();
  const httpModule = await import("../../convex/http");
  const router =
    (httpModule.default as unknown as { default?: typeof httpModule.default })
      .default ?? httpModule.default;
  const [handler] = router.lookup("/telemetry/worker", "POST")!;
  const action = handler as unknown as {
    _handler: (ctx: ActionCtx, request: Request) => Promise<Response>;
  };
  const original = action._handler;
  let rotations = 0;
  // Run the real HTTP handler and real auth queries, injecting a competing
  // registration immediately before dispatch to the real completion mutation.
  test.mock.method(action, "_handler", (ctx: ActionCtx, request: Request) =>
    original(
      {
        ...ctx,
        runMutation: async (reference, args) => {
          if (getFunctionName(reference) === "clubOperations:complete") {
            rotations++;
            await ctx.runMutation(
              makeFunctionReference<any>(
                "communityTelemetry:registerCollectorAccount",
              ),
              {
                vrchatUserId: s.authority.userId,
                accountAlias: "rotated",
                secretRef: "secret://rotated",
                workerKeyHash: "b".repeat(64),
              },
            );
          }
          return ctx.runMutation(reference, args);
        },
      },
      request,
    ),
  );
  const response = await s.request("club_operation_complete", {
    ...s.target,
    status: "succeeded",
  });
  assert.equal(rotations, 1);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { recorded: false });
  assert.equal(
    (await s.t.run((ctx) => ctx.db.get(s.operationId)))!.state,
    "submitted",
  );
});

it("scheduled submission recovery works after disconnect and worker key revocation", async (test) => {
  const s = await submittedOverHttp();
  const job = (await s.t.run((ctx) => ctx.db.get(s.operationId)))!;
  const scheduled = await s.t.run((ctx) =>
    ctx.db.system.query("_scheduled_functions").collect(),
  );
  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0].scheduledTime, job.claim!.expiresAt);
  await s.t.run(async (ctx) => {
    await ctx.db.patch(s.integrationId, { state: "disconnected" });
    await ctx.db.patch(s.collectorAccountId, {
      workerKeyHash: "b".repeat(64),
      killSwitchEnabled: true,
    });
  });
  // The scheduled function must run without any future authenticated claim request.
  test.mock.method(Date, "now", () => job.claim!.expiresAt);
  test.mock.timers.tick(120_000);
  await s.t.finishInProgressScheduledFunctions();
  const expired = (await s.t.run((ctx) => ctx.db.get(s.operationId)))!;
  assert.equal(expired.state, "indeterminate");
  assert.equal(expired.code, "submission_outcome_unknown");
  assert.deepEqual(expired.claim, job.claim);
  // Even a now-authenticated exact late result cannot replace terminal uncertainty.
  await s.t.run((ctx) =>
    ctx.db.patch(s.collectorAccountId, { workerKeyHash: s.hash }),
  );
  const late = await s.request("club_operation_complete", {
    ...s.target,
    status: "succeeded",
  });
  assert.deepEqual(await late.json(), { recorded: false });
  assert.equal(
    (await s.t.run((ctx) => ctx.db.get(s.operationId)))!.state,
    "indeterminate",
  );
});

it("submission recovery checks the recorded nonce and expiry and preserves terminal results", async (test) => {
  const s = await submittedOverHttp();
  const job = (await s.t.run((ctx) => ctx.db.get(s.operationId)))!;
  const expiry = {
    operationId: s.operationId,
    nonce: job.claim!.nonce,
    expiresAt: job.claim!.expiresAt,
  };
  await s.t.mutation(ref("expireSubmission"), expiry);
  assert.equal(
    (await s.t.run((ctx) => ctx.db.get(s.operationId)))!.state,
    "submitted",
  );
  test.mock.method(Date, "now", () => expiry.expiresAt);
  for (const mismatch of [
    { nonce: "stale" },
    { expiresAt: expiry.expiresAt - 1 },
  ]) {
    await s.t.mutation(ref("expireSubmission"), { ...expiry, ...mismatch });
    assert.equal(
      (await s.t.run((ctx) => ctx.db.get(s.operationId)))!.state,
      "submitted",
    );
  }
  const completed = await s.request("club_operation_complete", {
    ...s.target,
    status: "succeeded",
  });
  assert.deepEqual(await completed.json(), { recorded: true });
  await s.t.mutation(ref("expireSubmission"), expiry);
  assert.equal(
    (await s.t.run((ctx) => ctx.db.get(s.operationId)))!.state,
    "succeeded",
  );
});
it("HTTP operation routes pass real mutation validators and fence the reported epoch", async () => {
  for (const completion of ["complete", "reject", "defer"]) {
    const s = await queued();
    const key = "http-operation-worker-key-".repeat(2);
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(key),
    );
    const hash = [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    await s.t.run((ctx) =>
      ctx.db.patch(s.collectorAccountId, { workerKeyHash: hash }),
    );
    const request = async (
      operation: string,
      extra: Record<string, unknown> = {},
      expectedStatus = 200,
    ) => {
      const response = await s.t.fetch("/telemetry/worker", {
        method: "POST",
        headers: {
          authorization: `Bearer ${key}`,
          "content-type": "application/json",
          "x-vrdex-collector-account": s.collectorAccountId,
        },
        body: JSON.stringify({
          operation,
          workerId: s.worker.workerId,
          vrchatUserId: s.authority.userId,
          integrationId: s.integrationId,
          fencingToken: s.worker.fencingToken,
          epochStartedAt: s.worker.epochStartedAt,
          ...extra,
        }),
      });
      assert.equal(
        response.status,
        expectedStatus,
        await response.clone().text(),
      );
      return response.json();
    };
    assert.deepEqual(
      await request("club_operation_claim", { epochStartedAt: undefined }, 400),
      { error: "invalid_epoch" },
    );
    assert.equal(
      await request("club_operation_claim", {
        epochStartedAt: s.worker.epochStartedAt - 1,
      }),
      null,
    );
    const claim = await request("club_operation_claim");
    assert.equal(claim.operationId, s.operationId);
    const target = { operationId: s.operationId, nonce: claim.nonce };
    assert.equal(
      (
        await request("club_operation_authorize", {
          ...target,
          authority: s.authority,
          epochStartedAt: s.worker.epochStartedAt - 1,
        })
      ).authorized,
      false,
    );
    if (completion === "complete") {
      assert.equal(
        (
          await request("club_operation_authorize", {
            ...target,
            authority: s.authority,
          })
        ).authorized,
        true,
      );
      assert.deepEqual(
        await request("club_operation_complete", {
          ...target,
          status: "succeeded",
        }),
        { recorded: true },
      );
    } else if (completion === "reject") {
      assert.deepEqual(
        await request("club_operation_reject", {
          ...target,
          code: "preflight_failed",
        }),
        { recorded: true },
      );
    } else {
      const result = await request("club_operation_defer", {
        ...target,
        code: "timeout",
        retryAfterMs: 1000,
      });
      assert.equal(result.recorded, true);
      assert.ok(result.retryAt > Date.now());
    }
  }
});
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
        creationRevision: 1,
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
it("creation edits invalidate reviewed invitations at claim and final authorization", async () => {
  const worldA = "wrld_44444444-4444-4444-4444-444444444444";
  const worldB = "wrld_66666666-6666-6666-6666-666666666666";
  const instanceId =
    "123~group(grp_11111111-1111-1111-1111-111111111111)~groupAccessType(members)";
  for (const changedField of ["world", "access"] as const) {
    for (const stage of ["claim", "authorize"] as const) {
      const s = await queued();
      const creation = {
        kind: "create_instance",
        worldId: worldA,
        access: "members",
        region: "us",
      } as const;
      const targetUserId = "usr_55555555-5555-5555-5555-555555555555";
      const schedule = { kind: "fixed", dueAt: Date.now() };
      await s.t.run((ctx) =>
        ctx.db.patch(s.operationId, {
          payload: creation,
          readyAt: Date.now() + 3600000,
        }),
      );
      const [inviteId] = await s.owner.mutation(ref("enqueue"), {
        communityProfileId: s.communityProfileId,
        requestId: `changed_${changedField}_${stage}`,
        payloads: [{
          kind: "invite_to_created_instance",
          creationOperationId: s.operationId,
          creationRevision: 1,
          targetUserId,
        }],
        schedule,
      });
      const reviewed = await s.t.run((ctx) => ctx.db.get(inviteId));
      assert.equal(reviewed!.dependencyRevision, 1);
      let claim;
      if (stage === "authorize") {
        await s.t.run((ctx) =>
          ctx.db.patch(s.operationId, {
            state: "succeeded",
            result: { worldId: worldA, instanceId },
          }),
        );
        claim = await s.t.mutation(ref("claim"), s.worker);
        assert.equal(claim.operationId, inviteId);
        // A pending creation can still be edited while an invitation is claimed.
        await s.t.run((ctx) =>
          ctx.db.patch(s.operationId, { state: "pending" }),
        );
      }
      const editedCreation = changedField === "world"
        ? { ...creation, worldId: worldB }
        : { ...creation, access: "plus" };
      await s.owner.mutation(ref("edit"), {
        expectedRevision: 1,
        operationId: s.operationId,
        payload: editedCreation,
        schedule,
      });
      await s.t.run((ctx) =>
        ctx.db.patch(s.operationId, {
          state: "succeeded",
          result: {
            worldId: editedCreation.worldId,
            instanceId,
          },
        }),
      );
      if (stage === "claim")
        assert.equal(await s.t.mutation(ref("claim"), s.worker), null);
      else
        assert.deepEqual(
          await s.t.mutation(ref("authorizeSubmission"), {
            ...s.worker,
            operationId: inviteId,
            nonce: claim.nonce,
            authority: s.authority,
            friendship: "friend",
          }),
          { authorized: false, code: "dependency_unavailable" },
        );
      const invite = await s.t.run((ctx) => ctx.db.get(inviteId));
      assert.equal(invite!.state, "rejected");
      assert.equal(invite!.code, "dependency_unavailable");
    }
  }
});
it("ordinary invitation edits preserve review and cannot approve a changed parent", async () => {
  const s = await queued();
  const worldA = "wrld_44444444-4444-4444-4444-444444444444";
  const worldB = "wrld_66666666-6666-6666-6666-666666666666";
  const schedule = { kind: "fixed", dueAt: Date.now() };
  const creation = { kind: "create_instance", worldId: worldA, access: "members", region: "us" };
  const payload = {
    kind: "invite_to_created_instance",
    creationOperationId: s.operationId,
    creationRevision: 1,
    targetUserId: "usr_55555555-5555-5555-5555-555555555555",
  };
  await s.t.run((ctx) => ctx.db.patch(s.operationId, {
    payload: creation, readyAt: Date.now() + 3600000,
  }));
  const [inviteId] = await s.owner.mutation(ref("enqueue"), {
    communityProfileId: s.communityProfileId, requestId: "reviewed_invite",
    payloads: [payload], schedule,
  });
  const editedPayload = { ...payload, targetUserId: "usr_77777777-7777-7777-7777-777777777777" };
  const editedSchedule = { ...schedule, dueAt: schedule.dueAt + 60000 };
  await s.owner.mutation(ref("edit"), {
    expectedRevision: 1,
    operationId: inviteId, payload: editedPayload, schedule: editedSchedule,
  });
  const edited = await s.t.run((ctx) => ctx.db.get(inviteId));
  assert.equal(edited!.dependencyRevision, 1);
  assert.deepEqual(edited!.payload, editedPayload);
  assert.equal(edited!.dueAt, editedSchedule.dueAt);
  const [otherCreation] = await s.owner.mutation(ref("enqueue"), {
    communityProfileId: s.communityProfileId, requestId: "other_creation",
    payloads: [{ ...creation, worldId: worldB }], schedule,
  });
  await assert.rejects(s.owner.mutation(ref("edit"), {
    expectedRevision: 2,
    operationId: inviteId,
    payload: { ...editedPayload, creationOperationId: otherCreation },
    schedule: editedSchedule,
  }), /Instance creation is unavailable/);
  await s.owner.mutation(ref("cancel"), { operationId: otherCreation });
  await s.owner.mutation(ref("edit"), {
    expectedRevision: 1,
    operationId: s.operationId, payload: { ...creation, worldId: worldB }, schedule,
  });
  // Neither the generic editor's old payload nor a caller supplying the live
  // revision can turn a timing/recipient edit into a new destination approval.
  for (const creationRevision of [1, 2]) {
    await assert.rejects(s.owner.mutation(ref("edit"), {
      expectedRevision: 2,
      operationId: inviteId, payload: { ...editedPayload, creationRevision }, schedule,
    }), /Instance creation is unavailable/);
  }
  assert.deepEqual(await s.t.run((ctx) => ctx.db.get(inviteId)), edited);
  await s.owner.mutation(ref("cancel"), { operationId: inviteId });
  const [replacement] = await s.owner.mutation(ref("enqueue"), {
    communityProfileId: s.communityProfileId, requestId: "rereview_invite",
    payloads: [{ ...editedPayload, creationRevision: 2 }], schedule,
  });
  await s.t.run((ctx) => ctx.db.patch(s.operationId, {
    state: "succeeded", result: { worldId: worldB,
      instanceId: "123~group(grp_11111111-1111-1111-1111-111111111111)~groupAccessType(members)" },
  }));
  const claim = await s.t.mutation(ref("claim"), s.worker);
  assert.equal(claim.operationId, replacement);
  assert.equal(claim.payload.worldId, worldB);
  assert.deepEqual(await s.t.mutation(ref("authorizeSubmission"), {
    ...s.worker, operationId: replacement, nonce: claim.nonce,
    authority: s.authority, friendship: "friend",
  }), { authorized: true, code: null });
});
it("older dependent invitations without a reviewed creation revision fail closed", async () => {
  for (const missing of ["caller", "stored"] as const) {
    for (const stage of ["claim", "authorize"] as const) {
      const s = await queued();
      const worldId = "wrld_44444444-4444-4444-4444-444444444444";
      await s.t.run((ctx) =>
        ctx.db.patch(s.operationId, {
          payload: { kind: "create_instance", worldId, access: "members", region: "us" },
          readyAt: Date.now() + 3600000,
        }),
      );
      const [inviteId] = await s.owner.mutation(ref("enqueue"), {
        communityProfileId: s.communityProfileId,
        requestId: `older_invite_${stage}`,
        payloads: [{
          kind: "invite_to_created_instance",
          creationOperationId: s.operationId,
          creationRevision: 1,
          targetUserId: "usr_55555555-5555-5555-5555-555555555555",
        }],
        schedule: { kind: "fixed", dueAt: Date.now() },
      });
      await s.t.run((ctx) =>
        ctx.db.patch(s.operationId, {
          state: "succeeded",
          result: {
            worldId,
            instanceId:
              "123~group(grp_11111111-1111-1111-1111-111111111111)~groupAccessType(members)",
          },
        }),
      );
      let claim;
      if (stage === "authorize") {
        claim = await s.t.mutation(ref("claim"), s.worker);
        assert.equal(claim.operationId, inviteId);
      }
      await s.t.run(async (ctx) => {
        const job = await ctx.db.get(inviteId);
        await ctx.db.patch(inviteId, missing === "stored"
          ? { dependencyRevision: undefined }
          : { payload: { ...job!.payload, creationRevision: undefined } });
      });
      if (stage === "claim") {
        const job = await s.t.run((ctx) => ctx.db.get(inviteId));
        await assert.rejects(s.owner.mutation(ref("edit"), {
          expectedRevision: 1,
          operationId: inviteId, payload: job!.payload, schedule: job!.schedule,
        }), /Instance creation is unavailable/);
      }
      if (stage === "claim")
        assert.equal(await s.t.mutation(ref("claim"), s.worker), null);
      else
        assert.deepEqual(
          await s.t.mutation(ref("authorizeSubmission"), {
            ...s.worker,
            operationId: inviteId,
            nonce: claim.nonce,
            authority: s.authority,
            friendship: "friend",
          }),
          { authorized: false, code: "dependency_unavailable" },
        );
      assert.equal(
        (await s.t.run((ctx) => ctx.db.get(inviteId)))!.code,
        "dependency_unavailable",
      );
    }
  }
});
it("creation event reassociation rejects reviewed dependent invitations at claim and final authorization", async () => {
  for (const stage of ["claim", "authorize"]) {
    const s = await queued();
    const worldId = "wrld_44444444-4444-4444-4444-444444444444";
    const payload = {
      kind: "create_instance",
      worldId,
      access: "members",
      region: "us",
    };
    const dueAt = Date.now();
    const [eventA, eventB] = await s.t.run(async (ctx) => {
      const events = [];
      for (const slug of ["event-a", "event-b"])
        events.push(
          await ctx.db.insert("events", {
            slug,
            title: slug,
            sortTitle: slug,
            startAt: dueAt,
            communityProfileId: s.communityProfileId,
            sourceType: "manual",
            sourceLabel: "test",
            eventStatus: "scheduled",
            publicationState: "published",
            publishedAt: dueAt,
            updatedAt: dueAt,
          }),
        );
      await ctx.db.patch(s.operationId, {
        payload: payload as any,
        eventId: events[0],
        schedule: { kind: "fixed", dueAt, eventId: events[0] },
        dueAt,
        readyAt: dueAt,
      });
      return events;
    });
    const [inviteId] = await s.owner.mutation(ref("enqueue"), {
      communityProfileId: s.communityProfileId,
      requestId: "event_dependency",
      payloads: [
        {
          kind: "invite_to_created_instance",
          creationOperationId: s.operationId,
          creationRevision: 1,
          targetUserId: "usr_55555555-5555-5555-5555-555555555555",
        },
      ],
      schedule: { kind: "fixed", dueAt },
    });
    const succeedCreation = async () =>
      s.t.run((ctx) =>
        ctx.db.patch(s.operationId, {
          state: "succeeded",
          result: {
            worldId,
            instanceId:
              "123~group(grp_11111111-1111-1111-1111-111111111111)~groupAccessType(members)",
          },
        }),
      );
    let claim;
    if (stage === "authorize") {
      await succeedCreation();
      claim = await s.t.mutation(ref("claim"), s.worker);
      // Simulate an in-flight invitation while a prior creation revision changes.
      await s.t.run((ctx) => ctx.db.patch(s.operationId, { state: "pending" }));
    }
    await s.owner.mutation(ref("edit"), {
      expectedRevision: 1,
      operationId: s.operationId,
      payload,
      schedule: { kind: "fixed", dueAt, eventId: eventB },
    });
    await succeedCreation();
    await s.t.run((ctx) => ctx.db.patch(eventB, { eventStatus: "cancelled" }));
    if (stage === "claim")
      assert.equal(await s.t.mutation(ref("claim"), s.worker), null);
    else
      assert.equal(
        (
          await s.t.mutation(ref("authorizeSubmission"), {
            ...s.worker,
            operationId: inviteId,
            nonce: claim.nonce,
            authority: s.authority,
            friendship: "friend",
          })
        ).authorized,
        false,
      );
    const invite = await s.t.run((ctx) => ctx.db.get(inviteId));
    assert.equal(invite!.state, "rejected");
    assert.equal(invite!.code, "dependency_unavailable");
    assert.equal(invite!.eventId, eventA);
    assert.deepEqual(invite!.schedule, { kind: "fixed", dueAt });
  }
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
    creationRevision: 1,
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
      expectedRevision: 1,
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
        creationRevision: 1,
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
          creationRevision: 1,
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
    const { workerKeyHash, epochStartedAt, ...lease } = s.worker;
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
      expectedRevision: 1,
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
    expectedRevision: 1,
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
  await s.t.mutation(ref("authorizeSubmission"), {
    ...s.worker,
    operationId: s.operationId,
    nonce: claim.nonce,
    authority: s.authority,
  });
  assert.deepEqual(
    await s.t.mutation(ref("complete"), {
      ...s.worker,
      operationId: s.operationId,
      nonce: claim.nonce,
      status: "rejected",
      code: "submission_not_attempted",
    }),
    { recorded: true },
  );
  assert.equal(await s.t.mutation(ref("claim"), s.worker), null);
  const stored = await s.t.run((ctx) => ctx.db.get(s.operationId));
  assert.equal(stored!.state, "rejected");
  assert.equal(stored!.code, "submission_not_attempted");
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

it("immediate schedules use server time and preserve the original time on replay", async (test) => {
  const s = await setup();
  await s.t.run((ctx) =>
    ctx.db.patch(s.integrationId, {
      enabledFeatures: ["membership_management"],
    }),
  );
  const now = Date.now();
  test.mock.method(Date, "now", () => now);
  const args = {
    communityProfileId: s.communityProfileId,
    requestId: "immediate_replay",
    payloads: [
      {
        kind: "invite_member",
        targetUserId: "usr_33333333-3333-3333-3333-333333333333",
      },
    ],
    schedule: { kind: "immediate" },
  };
  const ids = await s.owner.mutation(ref("enqueue"), args);
  const original = await s.t.run((ctx) => ctx.db.get(ids[0]));
  assert.equal(original!.dueAt, now);
  assert.equal(original!.readyAt, now);
  assert.equal(original!.createdAt, now);
  test.mock.method(Date, "now", () => now + 3600000);
  assert.deepEqual(await s.owner.mutation(ref("enqueue"), args), ids);
  assert.deepEqual(await s.t.run((ctx) => ctx.db.get(ids[0])), original);
  await assert.rejects(
    s.owner.mutation(ref("enqueue"), {
      ...args,
      schedule: { kind: "fixed", dueAt: now },
    }),
    /request/i,
  );
  await assert.rejects(
    s.owner.mutation(ref("enqueue"), {
      ...args,
      payloads: [
        {
          ...args.payloads[0],
          targetUserId: "usr_44444444-4444-4444-4444-444444444444",
        },
      ],
    }),
    /request/i,
  );
  await assert.rejects(
    s.owner.mutation(ref("enqueue"), {
      ...args,
      requestId: "past_fixed",
      schedule: { kind: "fixed", dueAt: now },
    }),
    /Invalid execution time/,
  );
  const future = now + 7200000;
  const fixedIds = await s.owner.mutation(ref("enqueue"), {
    ...args,
    requestId: "future_fixed",
    schedule: { kind: "fixed", dueAt: future },
  });
  assert.equal(
    (await s.t.run((ctx) => ctx.db.get(fixedIds[0])))!.dueAt,
    future,
  );
});

it("immediate dependent invitations retain review, server ordering and event cancellation", async () => {
  const s = await queued();
  const creation = {
    kind: "create_instance",
    worldId: "wrld_44444444-4444-4444-4444-444444444444",
    access: "members",
    region: "us",
  } as const;
  const eventId = await s.t.run(async (ctx) => {
    const eventId = await ctx.db.insert("events", {
      slug: "immediate-event",
      title: "Immediate event",
      sortTitle: "event",
      communityProfileId: s.communityProfileId,
      startAt: Date.now() + 3600000,
      sourceType: "manual",
      sourceLabel: "test",
      eventStatus: "scheduled",
      publicationState: "published",
      updatedAt: Date.now(),
    });
    await ctx.db.patch(s.operationId, {
      payload: creation,
      eventId,
      schedule: { kind: "fixed", dueAt: Date.now() + 3600000, eventId },
      dueAt: Date.now() + 3600000,
      readyAt: Date.now() + 3600000,
    });
    return eventId;
  });
  const args = {
    communityProfileId: s.communityProfileId,
    requestId: "immediate_dependency",
    payloads: [
      {
        kind: "invite_to_created_instance",
        creationOperationId: s.operationId,
        creationRevision: 1,
        targetUserId: "usr_55555555-5555-5555-5555-555555555555",
      },
    ],
    schedule: { kind: "immediate" },
  };
  await assert.rejects(
    s.owner.mutation(ref("enqueue"), args),
    /before instance creation/,
  );
  await s.owner.mutation(ref("edit"), {
    expectedRevision: 1,
    operationId: s.operationId,
    payload: creation,
    schedule: { kind: "immediate", eventId },
  });
  await assert.rejects(
    s.owner.mutation(ref("enqueue"), args),
    /Instance creation is unavailable/,
  );
  args.payloads[0].creationRevision = 2;
  const [inviteId] = await s.owner.mutation(ref("enqueue"), args);
  const invite = await s.t.run((ctx) => ctx.db.get(inviteId));
  assert.equal(invite!.dependencyRevision, 2);
  assert.equal(invite!.eventId, eventId);
  const parent = await s.t.run((ctx) => ctx.db.get(s.operationId));
  assert.ok(invite!.dueAt >= parent!.dueAt);
  assert.deepEqual(parent!.schedule, { kind: "immediate", eventId });
  const revisions = await s.t.run((ctx) =>
    ctx.db.query("clubOperationRevisions").take(10),
  );
  assert.equal(revisions[0].schedule.kind, "fixed");
  await s.t.run(async (ctx) => {
    await ctx.db.patch(s.operationId, {
      state: "succeeded",
      result: { worldId: creation.worldId, instanceId: "123" },
    });
    await ctx.db.patch(eventId, { startAt: Date.now() + 7200000 });
  });
  const [secondInvite] = await s.owner.mutation(ref("enqueue"), {
    ...args,
    requestId: "immediate_after_success",
  });
  assert.ok(
    (await s.t.run((ctx) => ctx.db.get(secondInvite)))!.dueAt <
      Date.now() + 60000,
  );
  await s.t.run((ctx) => ctx.db.patch(eventId, { eventStatus: "cancelled" }));
  await assert.rejects(
    s.owner.mutation(ref("enqueue"), {
      ...args,
      requestId: "explicit_cancelled",
      schedule: { kind: "immediate", eventId },
    }),
    /unavailable/i,
  );
  assert.equal(await s.t.mutation(ref("claim"), s.worker), null);
  assert.equal(
    (await s.t.run((ctx) => ctx.db.get(inviteId)))!.state,
    "cancelled",
  );
});

it("internal enqueue replay compares payload values independent of key order", async () => {
  const s = await queued();
  const { enqueueClubOperations } = await import("../../convex/clubOperations");
  const payload = {
    kind: "publish_post",
    title: "Order",
    text: "Body",
    visibility: "group",
    sendNotification: false,
    roleIds: [
      "grol_11111111-1111-1111-1111-111111111111",
      "grol_22222222-2222-2222-2222-222222222222",
    ],
    imageId: undefined,
  } as const;
  const args = {
    communityProfileId: s.communityProfileId,
    requestId: "key_order_replay",
    payloads: [{ ...payload, roleIds: [...payload.roleIds] }],
    schedule: { kind: "immediate" as const },
  };
  const ids = await s.owner.run((ctx) => enqueueClubOperations(ctx, args));
  const reordered = {
    ...args,
    payloads: [
      {
        roleIds: [...payload.roleIds],
        text: payload.text,
        title: payload.title,
        visibility: payload.visibility,
        sendNotification: false,
        kind: payload.kind,
      },
    ],
  };
  assert.deepEqual(
    await s.owner.run((ctx) => enqueueClubOperations(ctx, reordered)),
    ids,
  );
  await assert.rejects(
    s.owner.run((ctx) =>
      enqueueClubOperations(ctx, {
        ...reordered,
        payloads: [{ ...reordered.payloads[0], roleIds: [] }],
      }),
    ),
    /Request ID already used/,
  );
  await assert.rejects(
    s.owner.run((ctx) =>
      enqueueClubOperations(ctx, {
        ...reordered,
        payloads: [
          { ...reordered.payloads[0], roleIds: [...payload.roleIds].reverse() },
        ],
      }),
    ),
    /Request ID already used/,
  );
});

it("immediate request replay rejects another authorized actor", async () => {
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
  const args = {
    communityProfileId: s.communityProfileId,
    requestId: "immediate_actor_replay",
    payloads: [
      {
        kind: "publish_post",
        title: "Reviewed post",
        text: "Same content",
        visibility: "group",
        sendNotification: false,
      },
    ],
    schedule: { kind: "immediate" },
  };
  const ids = await s.owner.mutation(ref("enqueue"), args);
  const original = await s.t.run((ctx) => ctx.db.get(ids[0]));
  await assert.rejects(
    staff.mutation(ref("enqueue"), args),
    /Request ID already used/,
  );
  assert.deepEqual(await s.t.run((ctx) => ctx.db.get(ids[0])), original);
  assert.deepEqual(await s.owner.mutation(ref("enqueue"), args), ids);
  // A fresh request succeeds, proving the rejected replay was not a permission denial.
  const staffIds = await staff.mutation(ref("enqueue"), {
    ...args,
    requestId: "immediate_staff_request",
  });
  assert.notEqual(staffIds[0], ids[0]);
  assert.equal(
    (await s.t.run((ctx) => ctx.db.get(staffIds[0])))!.createdBy
      .tokenIdentifier,
    subject.tokenIdentifier,
  );
});
it("pending edits reject another authorized editor's obsolete revision without side effects", async () => {
  const s = await queued();
  const subject = {
    subject: "editor",
    issuer: "https://test.clerk.accounts.dev",
    tokenIdentifier: "https://test.clerk.accounts.dev|editor",
  };
  const worldA = "wrld_11111111-1111-1111-1111-111111111111";
  const worldB = "wrld_22222222-2222-2222-2222-222222222222";
  const payload = {
    kind: "create_instance",
    worldId: worldA,
    access: "members",
    region: "use",
  };
  await s.t.run(async (ctx) => {
    await ctx.db.insert("users", { clerkUserId: "editor" });
    await ctx.db.patch(s.roleId, {
      permissions: ["manage_instances", "manage_scheduled_actions"],
    });
    await ctx.db.insert("communityAuthorities", {
      communityProfileId: s.communityProfileId,
      subject,
      subjectTokenIdentifier: subject.tokenIdentifier,
      roleId: s.roleId,
      state: "active",
      grantedAt: Date.now(),
      updatedAt: Date.now(),
    });
    await ctx.db.patch(s.operationId, { payload });
  });
  const other = s.t.withIdentity(subject);
  const original = await s.t.run((ctx) => ctx.db.get(s.operationId));
  await s.owner.mutation(ref("edit"), {
    operationId: s.operationId,
    expectedRevision: original!.revision,
    payload: { ...payload, worldId: worldB },
    schedule: { kind: "immediate" },
  });
  const before = await s.t.run(async (ctx) => ({
    job: await ctx.db.get(s.operationId),
    revisions: await ctx.db.query("clubOperationRevisions").collect(),
    integration: await ctx.db.get(s.integrationId),
  }));
  await assert.rejects(
    other.mutation(ref("edit"), {
      operationId: s.operationId,
      expectedRevision: original!.revision,
      payload,
      schedule: { kind: "fixed", dueAt: Date.now() + 1200000 },
    }),
    /Refresh to continue/,
  );
  assert.deepEqual(
    await s.t.run(async (ctx) => ({
      job: await ctx.db.get(s.operationId),
      revisions: await ctx.db.query("clubOperationRevisions").collect(),
      integration: await ctx.db.get(s.integrationId),
    })),
    before,
  );
  await other.mutation(ref("edit"), {
    operationId: s.operationId,
    expectedRevision: before.job!.revision,
    payload: before.job!.payload,
    schedule: { kind: "immediate" },
  });
  const after = await s.t.run((ctx) => ctx.db.get(s.operationId));
  assert.equal(after!.revision, original!.revision + 2);
  assert.deepEqual(after!.payload, { ...payload, worldId: worldB });
});
it("telemetry-only failures preserve management availability and fresh authorization", async () => {
  const s = await queued();
  await s.t.run((ctx) =>
    ctx.db.patch(s.integrationId, { enabledFeatures: ["analytics", "posts"] }),
  );
  const now = Date.now();
  const failure = makeFunctionReference<any>(
    "communityTelemetry:recordPollFailure",
  );
  for (let i = 0; i < 5; i++)
    await s.t.mutation(failure, {
      integrationId: s.integrationId,
      collectorAccountId: s.collectorAccountId,
      workerId: "worker",
      fencingToken: 1,
      telemetryOnly: true,
      statusClass: "403",
      coverageState: "unknown",
      detail: "visibility",
      collectorVersion: "test",
      nextPollAt: now + 3600000,
      backoffUntil: now + 3600000,
      now: now + i,
    });
  const state = await s.t.run(async (ctx) => ({
    integration: await ctx.db.get(s.integrationId),
    coverage: await ctx.db.query("collectionCoverageWindows").collect(),
  }));
  assert.equal(state.integration!.state, "active");
  assert.equal(state.integration!.consecutiveFailures, 5);
  assert.equal(state.integration!.backoffUntil, undefined);
  assert.equal(state.integration!.nextPollAt, now + 4 + 60000);
  assert.equal(state.coverage.at(-1)!.state, "unknown");
  const claim = await s.t.mutation(ref("claim"), s.worker);
  assert.equal(claim.operationId, s.operationId);
  await s.t.run((ctx) =>
    ctx.db.patch(s.integrationId, { enabledFeatures: ["analytics"] }),
  );
  const denied = await s.t.mutation(ref("authorizeSubmission"), {
    ...s.worker,
    operationId: s.operationId,
    nonce: claim.nonce,
    authority: s.authority,
  });
  assert.equal(denied.authorized, false);
});
for (const [statusClass, detail] of [
  ["401", "authentication"],
  ["429", "rate_limit"],
  ["403", "membership"],
]) {
  it(`telemetry-only flag cannot suppress ${detail} lifecycle and backoff`, async () => {
    const s = await queued();
    const now = Date.now();
    await s.t.run((ctx) =>
      ctx.db.patch(s.integrationId, {
        enabledFeatures: ["analytics", "posts"],
        consecutiveFailures: 2,
      }),
    );
    await s.t.mutation(
      makeFunctionReference<any>("communityTelemetry:recordPollFailure"),
      {
        integrationId: s.integrationId,
        collectorAccountId: s.collectorAccountId,
        workerId: "worker",
        fencingToken: 1,
        telemetryOnly: true,
        statusClass,
        detail,
        coverageState: "degraded",
        collectorVersion: "test",
        now,
        nextPollAt: now + 300000,
        backoffUntil: now + 300000,
      },
    );
    const state = await s.t.run(async (ctx) => ({
      integration: await ctx.db.get(s.integrationId),
      account: await ctx.db.get(s.collectorAccountId),
    }));
    assert.equal(
      state.integration!.state,
      statusClass === "401" ? "auth_required" : "degraded",
    );
    assert.equal(state.integration!.backoffUntil, now + 300000);
    if (statusClass === "401")
      assert.equal(state.account!.state, "auth_required");
  });
}

it("HTTP worker failure forwards analytics-only phase without disabling management", async () => {
  const s = await submittedOverHttp();
  await s.t.run((ctx) => ctx.db.patch(s.integrationId, { consecutiveFailures: 2 }));
  const response = await s.request("failure", {
    telemetryOnly: true, statusClass: "403", detail: "visibility", coverageState: "unknown",
    collectorVersion: "test", nextPollAt: Date.now() + 3600000, backoffUntil: Date.now() + 3600000,
  });
  assert.equal(response.status, 200);
  const integration = await s.t.run((ctx) => ctx.db.get(s.integrationId));
  assert.equal(integration!.consecutiveFailures, 3);
  assert.equal(integration!.state, "active");
  assert.equal(integration!.backoffUntil, undefined);
});

for (const unavailable of ["disabled", "killed", "no-lease", "expired-claim"] as const) {
  it(`independent deadline sweep expires unsent work with ${unavailable}`, async (test) => {
    const s = await queued();
    const job = (await s.t.run(ctx => ctx.db.get(s.operationId)))!;
    await s.t.run(async ctx => {
      if (unavailable === "disabled") await ctx.db.patch(s.collectorAccountId, { state: "retired" });
      if (unavailable === "killed") await ctx.db.insert("collectorFleetSettings", { key: "global", globalRequestsPerMinute: 100, killSwitchEnabled: true, updatedAt: Date.now() });
      if (unavailable === "no-lease") await ctx.db.delete(s.leaseId);
      if (unavailable === "expired-claim") await ctx.db.patch(job._id, { state: "claimed", claim: { nonce: "expired", collectorAccountId: s.collectorAccountId, credentialGeneration: 1, workerId: "worker", fencingToken: 1, expiresAt: job.dueAt + 1 } });
    });
    test.mock.method(Date, "now", () => job.dueAt + 15 * 60_000);
    await s.t.mutation(ref("expireUnsent"), { state: unavailable === "expired-claim" ? "claimed" : "pending" });
    assert.equal((await s.t.run(ctx => ctx.db.get(job._id)))!.state, unavailable === "expired-claim" ? "claimed" : "pending");
    test.mock.method(Date, "now", () => job.dueAt + 15 * 60_000 + 1);
    await s.t.mutation(ref("expireUnsent"), { state: unavailable === "expired-claim" ? "claimed" : "pending" });
    // The bounded first pass schedules the claimed pass.
    test.mock.timers.tick(0);
    await s.t.finishInProgressScheduledFunctions();
    const expired = (await s.t.run(ctx => ctx.db.get(job._id)))!;
    assert.equal(expired.state, "missed");
    assert.equal(expired.code, "late_window_elapsed");
    assert.equal(expired.claim, undefined);
    await s.t.mutation(ref("expireUnsent"), { state: unavailable === "expired-claim" ? "claimed" : "pending" });
    const notifications = await s.t.run(ctx => ctx.db.query("clubOperationNotifications").collect());
    assert.equal(notifications.length, 1);
    assert.equal(notifications[0].outcome, "missed");
  });
}

for (const kind of ["immediate", "fixed", "event_relative"] as const) {
  it(`deadline sweep respects a revision-aware ${kind} edit and current event timing`, async (test) => {
    const s = await queued();
    const original = (await s.t.run(ctx => ctx.db.get(s.operationId)))!;
    const editAt = original.dueAt + 10 * 60_000;
    test.mock.method(Date, "now", () => editAt);
    const eventId = await s.t.run(ctx => ctx.db.insert("events", { slug: "deadline-event", title: "Deadline event", sortTitle: "deadline event", sourceType: "manual", sourceLabel: "test", communityProfileId: s.communityProfileId, startAt: editAt + 3600_000, publicationState: "published", eventStatus: "scheduled", updatedAt: editAt }));
    const schedule = kind === "immediate" ? { kind } : kind === "fixed" ? { kind, dueAt: editAt + 3600_000 } : { kind, eventId, offsetMs: 0 };
    await s.owner.mutation(ref("edit"), { operationId: s.operationId, expectedRevision: 1, payload: original.payload, schedule });
    test.mock.method(Date, "now", () => original.dueAt + 15 * 60_000 + 1);
    await s.t.mutation(ref("expireUnsent"), { state: "pending", scanStartedAt: editAt });
    assert.equal((await s.t.run(ctx => ctx.db.get(s.operationId)))!.state, "pending");
    let dueAt = (await s.t.run(ctx => ctx.db.get(s.operationId)))!.dueAt;
    if (kind === "event_relative") {
      // Simulate an event update before its asynchronous rebase page arrives.
      await s.t.run(ctx => ctx.db.patch(eventId, { startAt: dueAt + 3600_000 }));
      test.mock.method(Date, "now", () => dueAt + 15 * 60_000 + 1);
      await s.t.mutation(ref("expireUnsent"), { state: "pending" });
      assert.equal((await s.t.run(ctx => ctx.db.get(s.operationId)))!.state, "pending");
      await s.t.run(ctx => ctx.db.patch(eventId, { startAt: dueAt - 3600_000 }));
      dueAt -= 3600_000;
    }
    test.mock.method(Date, "now", () => dueAt + 15 * 60_000 + 1);
    await s.t.mutation(ref("expireUnsent"), { state: "pending" });
    assert.equal((await s.t.run(ctx => ctx.db.get(s.operationId)))!.state, "missed");
  });
}

it("deadline sweep preserves cancelled, submitted and terminal work and serializes with submission", async (test) => {
  const s = await queued();
  const original = (await s.t.run(ctx => ctx.db.get(s.operationId)))!;
  await s.t.mutation(ref("claim"), s.worker);
  const claimed = (await s.t.run(ctx => ctx.db.get(s.operationId)))!;
  const target = { ...s.worker, operationId: s.operationId, nonce: claimed.claim!.nonce };
  await s.t.mutation(ref("authorizeSubmission"), { ...target, authority: s.authority });
  const submitted = (await s.t.run(ctx => ctx.db.get(s.operationId)))!;
  assert.equal(submitted.state, "submitted");
  test.mock.method(Date, "now", () => original.dueAt + 15 * 60_000 + 1);
  for (const state of ["pending", "claimed"] as const) await s.t.mutation(ref("expireUnsent"), { state });
  assert.deepEqual(await s.t.run(ctx => ctx.db.get(s.operationId)), submitted);
  for (const state of ["cancelled", "succeeded", "rejected", "indeterminate", "missed"] as const) {
    await s.t.run(ctx => ctx.db.patch(s.operationId, { state }));
    const before = await s.t.run(ctx => ctx.db.get(s.operationId));
    for (const unsent of ["pending", "claimed"] as const) await s.t.mutation(ref("expireUnsent"), { state: unsent });
    assert.deepEqual(await s.t.run(ctx => ctx.db.get(s.operationId)), before);
  }
  // The reverse transaction order clears the claim before authorization.
  await s.t.run(ctx => ctx.db.patch(s.operationId, { state: "claimed", submittedAt: undefined, claim: claimed.claim }));
  await s.t.mutation(ref("expireUnsent"), { state: "claimed" });
  assert.equal((await s.t.run(ctx => ctx.db.get(s.operationId)))!.state, "missed");
  await s.t.run(ctx => ctx.db.patch(s.leaseId, { expiresAt: Date.now() + 60_000 }));
  const outcome = await s.t.mutation(ref("authorizeSubmission"), { ...target, authority: { ...s.authority, observedAt: Date.now() } });
  assert.equal(outcome.authorized, false);
  assert.equal(outcome.code, "claim_unavailable");
  assert.equal((await s.t.run(ctx => ctx.db.query("clubOperationNotifications").collect())).length, 1);
});
