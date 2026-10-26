import { bindVrcdnTestAccount } from "./_eventOutputAccountFixture";
import assert from "node:assert/strict";
import { it } from "node:test";
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { api } from "../../convex/_generated/api";
import schemaModule from "../../convex/schema";
import { newClerkUserId } from "./_clerkTestIdentity";

const schema =
  (schemaModule as unknown as { default?: typeof schemaModule }).default ??
  schemaModule;
const worker = (name: string) =>
  makeFunctionReference<"mutation">(`eventMediaWorker:${name}`);
const modules = {
  "../../convex/_generated/api.ts": () => import("../../convex/_generated/api"),
  "../../convex/events.ts": () => import("../../convex/events"),
  "../../convex/eventMediaSources.ts": () =>
    import("../../convex/eventMediaSources"),
  "../../convex/eventMediaControlMigration.ts": () =>
    import("../../convex/eventMediaControlMigration"),
  "../../convex/eventMediaWorker.ts": () =>
    import("../../convex/eventMediaWorker"),
};
const bridgeToken = "worker-test-only-credential";
process.env.VRDEX_EVENT_MEDIA_BRIDGE_TOKEN = bridgeToken;

async function setupFixture() {
  const t = convexTest({ schema, modules });
  const subject = newClerkUserId();
  await t.run(async ({ db }) => {
    const now = Date.now();
    const userId = await db.insert("users", {
      clerkUserId: subject,
      name: "Owner",
      email: "owner@example.test",
      emailVerificationTime: now,
    });
    const profileId = await db.insert("profiles", {
      slug: "club",
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
    bindVrcdnTestAccount(profileId, "event-media/vrcdn/main");
    await db.insert("profileOwners", {
      profileId,
      userId,
      roleKey: "owner",
      state: "active",
      grantedAt: now,
      updatedAt: now,
    });
  });
  const owner = t.withIdentity({
    subject,
    emailVerified: true,
    issuer: "test",
    tokenIdentifier: `test|${subject}`,
  });
  const event = await owner.mutation(api.events.createCommunityEvent, {
    title: "Worker event",
    communitySlug: "club",
    startAt: Date.now() + 600_000,
    timezone: "UTC",
  });
  const output = await owner.mutation(api.events.configureVrcdnOutput, {
    currentSlug: event.slug,
    key: "main",
    label: "Main",
    credentialRef: "event-media/vrcdn/main",
    sourceConsentAccepted: true,
    destinationAuthorityAccepted: true,
    providerRulesAccepted: true,
    rightsClearedMediaAccepted: true,
    playbackLinks: [{ platform: "browser", url: "https://example.test/watch" }],
  });
  async function schedule() {
    // Seed an already admitted session: these tests exercise control mutations,
    // not capacity admission. The production measured allocation map stays empty.
    const scheduled = await t.run(async ({ db }) => {
      const now = Date.now();
      const sessionId = await db.insert("eventMediaSessions", {
        programId: output.programId, eventId: event.eventId,
        outputId: output.outputId, controlProtocolVersion: 2,
        committedIntent: { kind: "automatic" }, intentSequence: 0,
        status: "scheduled", nextCommandSequence: 2,
        scheduledStartAt: now, readyDeadlineAt: now + 180_000,
        createdAt: now, updatedAt: now,
      });
      const startCommandId = await db.insert("eventMediaCommands", {
        programId: output.programId, eventId: event.eventId, sessionId,
        commandType: "start_program", sequence: 1, status: "queued",
        targetOutputId: output.outputId, publicFallbackLinks: [],
        actorSurface: "web", availableAt: now, createdAt: now, updatedAt: now,
      });
      await db.patch(output.programId, {
        activeSessionId: sessionId, currentOutputId: output.outputId,
        state: "ready", updatedAt: now,
      });
      return { sessionId, startCommandId };
    });
    // Make the scheduled start eligible without replacing Convex's clock.
    await t.run(async (ctx) => {
      await ctx.db.patch(scheduled.sessionId, {
        scheduledStartAt: Date.now() - 1000,
      });
      if (scheduled.startCommandId)
        await ctx.db.patch(scheduled.startCommandId, {
          availableAt: Date.now() - 1000,
        });
    });
    const args = {
      protocolVersion: 2,
      bridgeToken,
      eventId: event.eventId,
      sessionId: scheduled.sessionId,
      workerId: "worker-a",
      epoch: 0,
    };
    return { scheduled, args };
  }
  return { t, owner, event, output, schedule };
}
async function fixture() {
  const f = await setupFixture();
  return { ...f, ...(await f.schedule()) };
}

async function controlFixture() {
  const f = await fixture();
  const sourceId = await f.t.run((ctx) =>
    ctx.db.insert("eventMediaSources", {
      programId: f.output.programId,
      eventId: f.event.eventId,
      key: "source_a",
      position: 0,
      type: "vrcdn_link",
      purpose: "program",
      state: "ready",
      label: "A",
      revision: 1,
      input: { kind: "vrcdn", streamId: "source_a" },
      publicUrl: "https://stream.vrcdn.live/live/source_a.live.ts",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }),
  );
  const lease = await f.t.mutation(worker("acquireSession"), f.args);
  const args = { ...f.args, epoch: lease.epoch };
  const take = (key = "take") =>
    f.owner.mutation(api.events.queueEventMediaCommand, {
      currentSlug: f.event.slug,
      type: "switch_source",
      targetSourceKey: "source_a",
      idempotencyKey: key,
    });
  const receipt = async (id: any) =>
    (await f.t.run((ctx) => ctx.db.get(id))) as any;
  const begin = async (id: any) => {
    const c = await receipt(id);
    return f.t.mutation(worker("beginPreparation"), {
      ...args,
      commandId: id,
      sequence: c.sequence,
    });
  };
  const promote = async (id: any) => {
    const c = await receipt(id);
    return f.t.mutation(worker("promoteOperation"), {
      ...args,
      commandId: id,
      sequence: c.sequence,
      target: c.controlTarget,
    });
  };
  const ack = async (id: any, more = {}) => {
    const c = await receipt(id);
    return f.t.mutation(worker("acknowledgeCommand"), {
      ...args,
      commandId: id,
      sequence: c.sequence,
      outcome: "succeeded",
      intentSequence: c.sequence,
      outputMs: 100,
      observedSourceId: sourceId,
      sourceRevision: 1,
      slotKey: `manual-${sourceId}`,
      observedOutputId: f.output.outputId,
      observedState: "live",
      ...more,
    });
  };
  return { ...f, args, sourceId, take, receipt, begin, promote, ack };
}
it("scoped idempotency and one pending operation", async () => {
  const f = await controlFixture();
  const a = await f.take();
  const b = await f.take();
  assert.equal(a.commandId, b.commandId);
  await assert.rejects(f.take("second"), /pending/i);
  await assert.rejects(
    f.owner.mutation(api.events.queueEventMediaCommand, {
      currentSlug: f.event.slug,
      type: "switch_hold",
      idempotencyKey: "take",
    }),
    /idempotency/i,
  );
  const s = await f.receipt(f.args.sessionId);
  assert.deepEqual(s.committedIntent, { kind: "automatic" });
  assert.equal(s.pendingControlCommandId, a.commandId);
});
it("first automatic slate and fallback observations persist policy mode in public status", async () => {
  const f = await controlFixture();
  assert.equal((await f.receipt(f.args.sessionId)).broadcastMode, undefined);
  for (const [state, outputMs] of [["hold", 10], ["fallback", 20]] as const) {
    assert.deepEqual(await f.t.mutation(worker("observeProgram"), {
      ...f.args, intentSequence: 0, state, outputMs, publishing: true,
      outputId: f.output.outputId, mode: "automatic",
    }), { kind: "ok" });
    assert.equal((await f.receipt(f.args.sessionId)).broadcastMode, "automatic");
    const status = await f.owner.query(api.events.getEventMediaControlStatus, {
      currentSlug: f.event.slug,
    });
    assert.equal(status.sessions.find(row => row.sessionId === f.args.sessionId)?.broadcastMode, "automatic");
  }
});
for (const mode of ["manual", "hold"] as const)
  it(`automatic slate rejects contradictory ${mode} mode without writes`, async () => {
    const f = await controlFixture();
    const before = await f.receipt(f.args.sessionId);
    assert.deepEqual(await f.t.mutation(worker("observeProgram"), {
      ...f.args, intentSequence: 0, state: "hold", outputMs: 10,
      publishing: true, outputId: f.output.outputId, mode,
    }), { kind: "superseded" });
    assert.deepEqual(await f.receipt(f.args.sessionId), before);
  });
it("promotion commits before ack, and duplicate completion cannot rewrite evidence", async () => {
  const f = await controlFixture();
  await f.t.mutation(worker("observeProgram"), {
    ...f.args, intentSequence: 0, state: "hold", outputMs: 10,
    publishing: true, outputId: f.output.outputId,
  });
  const c = await f.take();
  assert.equal((await f.receipt(f.args.sessionId)).broadcastMode, "automatic");
  assert.equal((await f.begin(c.commandId)).kind, "ok");
  assert.equal((await f.receipt(f.args.sessionId)).broadcastMode, "automatic");
  assert.equal((await f.promote(c.commandId)).kind, "ok");
  assert.deepEqual((await f.receipt(f.args.sessionId)).committedIntent, {
    kind: "manual", sourceId: f.sourceId, revision: 1,
  });
  assert.equal((await f.receipt(f.args.sessionId)).broadcastMode, "automatic");
  assert.equal((await f.ack(c.commandId)).kind, "ok");
  assert.equal((await f.receipt(f.args.sessionId)).broadcastMode, "manual");
  const command = await f.receipt(c.commandId);
  assert.equal((await f.t.mutation(worker("observeProgram"), {
    ...f.args, intentSequence: command.sequence, state: "fallback", outputMs: 200,
    publishing: true, outputId: f.output.outputId,
  })).kind, "ok");
  const newer = await f.receipt(f.args.sessionId);
  assert.equal(newer.broadcastMode, "manual");
  assert.equal((await f.ack(c.commandId)).duplicate, true);
  assert.deepEqual(await f.receipt(f.args.sessionId), newer);
  assert.equal((await f.ack(c.commandId, { outputMs: 101 })).kind, "superseded");
  assert.deepEqual(await f.receipt(f.args.sessionId), newer);
});
for (const phase of ["preparing", "promoting", "cut"] as const)
  it(`periodic slate cannot establish mode during pending ${phase}`, async () => {
    const f = await controlFixture();
    const request = {
      ...f.args, intentSequence: 0, state: "hold", outputMs: 10,
      publishing: true, outputId: f.output.outputId,
    };
    await f.t.mutation(worker("observeProgram"), request);
    const c = phase === "cut"
      ? await f.owner.mutation(api.events.queueEventMediaCommand, {
          currentSlug: f.event.slug, type: "switch_hold", idempotencyKey: "cut",
        })
      : await f.take();
    await f.begin(c.commandId);
    if (phase === "promoting") await f.promote(c.commandId);
    const before = await f.receipt(f.args.sessionId);
    assert.equal((await f.t.mutation(worker("observeProgram"), {
      ...request, intentSequence: before.intentSequence, outputMs: 20,
    })).kind, "superseded");
    assert.deepEqual(await f.receipt(f.args.sessionId), before);
  });
for (const promoteFirst of [false, true])
  it(`Cut supersedes ${promoteFirst ? "promoting" : "preparing"} receipt`, async () => {
    const f = await controlFixture();
    const c = await f.take();
    await f.begin(c.commandId);
    if (promoteFirst) await f.promote(c.commandId);
    await f.owner.mutation(api.events.queueEventMediaCommand, {
      currentSlug: f.event.slug,
      type: "switch_hold",
      idempotencyKey: "cut",
    });
    assert.equal((await f.promote(c.commandId)).kind, "superseded");
    const lateAck = await f.ack(c.commandId);
    const session = await f.receipt(f.args.sessionId);
    assert.equal(session.committedIntent.kind, "slate");
    assert.equal(lateAck.kind, "superseded");
    assert.ok(session.leaseExpiresAt > Date.now());
  });
it("preparation deadline starts once and takeover retains identity", async () => {
  const f = await controlFixture();
  const c = await f.take();
  await f.begin(c.commandId);
  const original = await f.receipt(c.commandId);
  await f.begin(c.commandId);
  assert.equal(
    (await f.receipt(c.commandId)).preparationExpiresAt,
    original.preparationExpiresAt,
  );
  await f.t.run((ctx) => ctx.db.patch(f.args.sessionId, { leaseExpiresAt: 0 }));
  const a = { ...f.args, workerId: "replacement" };
  const lease = await f.t.mutation(worker("acquireSession"), a);
  await f.t.mutation(worker("beginPreparation"), {
    ...a,
    epoch: lease.epoch,
    commandId: c.commandId,
    sequence: original.sequence,
  });
  assert.equal(
    (await f.receipt(c.commandId)).preparationExpiresAt,
    original.preparationExpiresAt,
  );
});
it("expired preparation retains automatic intent", async () => {
  const f = await controlFixture();
  await f.t.mutation(worker("observeProgram"), {
    ...f.args, intentSequence: 0, state: "hold", outputMs: 10,
    publishing: true, outputId: f.output.outputId,
  });
  const c = await f.take();
  await f.begin(c.commandId);
  await f.t.run((ctx) =>
    ctx.db.patch(c.commandId, { preparationExpiresAt: Date.now() - 1 }),
  );
  assert.deepEqual(await f.promote(c.commandId), {
    kind: "failed",
    reason: "expired",
  });
  assert.deepEqual((await f.receipt(f.args.sessionId)).committedIntent, {
    kind: "automatic",
  });
  assert.equal((await f.receipt(f.args.sessionId)).broadcastMode, "automatic");
});
for (const promoteFirst of [false, true])
  it(`removal atomically settles ${promoteFirst ? "committed" : "pending"} target`, async () => {
    const f = await controlFixture();
    const c = await f.take();
    await f.begin(c.commandId);
    if (promoteFirst) await f.promote(c.commandId);
    await f.owner.mutation(
      makeFunctionReference<"mutation">("eventMediaSources:remove"),
      { currentSlug: f.event.slug, sourceId: f.sourceId },
    );
    assert.equal((await f.receipt(f.sourceId)).state, "disabled");
    const s = await f.receipt(f.args.sessionId);
    assert.equal(s.committedIntent.kind, promoteFirst ? "slate" : "automatic");
    assert.equal(s.pendingControlCommandId, undefined);
    assert.notEqual((await f.promote(c.commandId)).kind, "ok");
  });
it("v2 rejects omitted worker protocol", async () => {
  const f = await fixture();
  const { protocolVersion, ...args } = f.args;
  await assert.rejects(
    f.t.mutation(worker("acquireSession"), args),
    /protocol/i,
  );
});
const cancelRef = makeFunctionReference<"mutation">(
  "events:cancelEventMediaOperation",
);
const migrationRef = makeFunctionReference<"mutation">(
  "eventMediaControlMigration:backfill",
);
for (const phase of ["preparing", "promoting"] as const)
  it(`Cancel eligibility in ${phase}`, async () => {
    const f = await controlFixture();
    const c = await f.take();
    await f.begin(c.commandId);
    if (phase === "promoting") await f.promote(c.commandId);
    const cancel = () =>
      f.owner.mutation(cancelRef, {
        currentSlug: f.event.slug,
        commandId: c.commandId,
        idempotencyKey: "cancel",
      });
    if (phase === "promoting") await assert.rejects(cancel(), /preparing/);
    else {
      assert.deepEqual(await cancel(), { kind: "cancelled" });
      assert.deepEqual(await cancel(), { kind: "cancelled" });
      assert.equal((await f.promote(c.commandId)).kind, "cancelled");
      await f.take("retry");
    }
  });
for (const authority of ["owner", "delegate"] as const)
  for (const committed of [false, true])
    it(`${authority} revocation ${committed ? "after" : "before"} promotion`, async () => {
      const f = await controlFixture();
      if (authority === "delegate")
        await f.t.run(async ({ db }) => {
          const owner = (await db.query("profileOwners").collect())[0];
          const user = (await db.get(owner.userId))!;
          await db.delete(owner._id);
          await db.insert("communityAuthorities", {
            communityProfileId: owner.profileId,
            subjectTokenIdentifier: `test|${user.clerkUserId}`,
            subject: {
              subject: user.clerkUserId,
              issuer: "test",
              tokenIdentifier: `test|${user.clerkUserId}`,
            },
            capabilities: ["manage_event_media"],
            state: "active",
            grantedAt: Date.now(),
            updatedAt: Date.now(),
          });
        });
      const c = await f.take();
      await f.begin(c.commandId);
      if (committed) await f.promote(c.commandId);
      await f.t.run(async ({ db }) => {
        for (const row of await db.query("profileOwners").collect())
          await db.delete(row._id);
        for (const row of await db.query("communityAuthorities").collect())
          await db.patch(row._id, { state: "revoked" });
      });
      if (committed) {
        assert.equal((await f.promote(c.commandId)).kind, "ok");
        assert.equal((await f.ack(c.commandId)).kind, "ok");
      } else {
        assert.deepEqual(await f.promote(c.commandId), {
          kind: "failed",
          reason: "actor_revoked",
        });
        assert.equal(
          (await f.receipt(f.args.sessionId)).committedIntent.kind,
          "automatic",
        );
      }
    });
for (const committed of [false, true])
  it(`destination revocation fences ${committed ? "completion" : "grant"}`, async () => {
    const f = await controlFixture();
    await f.t.mutation(worker("observeProgram"), {
      ...f.args, intentSequence: 0, state: "hold", outputMs: 10,
      publishing: true, outputId: f.output.outputId,
    });
    const c = await f.take();
    await f.begin(c.commandId);
    if (committed) await f.promote(c.commandId);
    await f.t.run((ctx) =>
      ctx.db.patch(f.output.outputId, { state: "disabled" }),
    );
    assert.deepEqual(
      committed ? await f.ack(c.commandId) : await f.promote(c.commandId),
      { kind: "fenced", reason: "destination" },
    );
    assert.equal((await f.receipt(f.args.sessionId)).broadcastMode, "automatic");
  });
for (const stopFirst of [false, true])
  it(`Stop outranks Cut ${stopFirst ? "before" : "after"} admission`, async () => {
    const f = await controlFixture();
    await f.t.mutation(worker("observeProgram"), {
      ...f.args, intentSequence: 0, state: "hold", outputMs: 10,
      publishing: true, outputId: f.output.outputId,
    });
    const c = await f.take();
    await f.begin(c.commandId);
    await f.promote(c.commandId);
    const cut = () =>
      f.owner.mutation(api.events.queueEventMediaCommand, {
        currentSlug: f.event.slug,
        type: "switch_hold",
        idempotencyKey: "cut",
      });
    if (!stopFirst) await cut();
    await f.owner.mutation(api.events.stopEventMediaWorker, {
      currentSlug: f.event.slug,
      sessionId: f.args.sessionId,
    });
    await assert.rejects(cut(), /stopp/);
    await assert.rejects(f.take("late"), /stopp/);
    await assert.rejects(
      f.owner.mutation(cancelRef, {
        currentSlug: f.event.slug,
        commandId: c.commandId,
        idempotencyKey: "cancel",
      }),
      /stopp/,
    );
    assert.deepEqual(await f.ack(c.commandId), {
      kind: "fenced",
      reason: "stopped",
    });
    assert.equal((await f.receipt(f.args.sessionId)).broadcastMode, "automatic");
    const claims = await f.t.mutation(worker("claimCommands"), f.args);
    assert.equal(claims.commands[0].commandType, "stop_program");
  });
it("coherent observations reject stale intent, revision, slot, destination and regressing watermark without writes", async () => {
  const f = await controlFixture();
  const c = await f.take();
  await f.begin(c.commandId);
  await f.promote(c.commandId);
  await f.ack(c.commandId);
  const receipt = await f.receipt(c.commandId);
  const good = {
    ...f.args,
    state: "live",
    publishing: true,
    intentSequence: receipt.sequence,
    outputMs: 200,
    sourceId: f.sourceId,
    sourceRevision: 1,
    slotKey: `manual-${f.sourceId}`,
    outputId: f.output.outputId,
  };
  assert.deepEqual(await f.t.mutation(worker("observeProgram"), good), {
    kind: "ok",
  });
  const before = await f.receipt(f.args.sessionId);
  for (const change of [
    { mode: "automatic" },
    { mode: "hold" },
    { intentSequence: 0 },
    { sourceRevision: 2 },
    { slotKey: "wrong" },
    { outputId: undefined },
    { outputMs: 199 },
    { sourceId: undefined },
  ]) {
    assert.equal(
      (await f.t.mutation(worker("observeProgram"), { ...good, ...change }))
        .kind,
      "superseded",
    );
    assert.deepEqual(await f.receipt(f.args.sessionId), before);
  }
  assert.equal(
    (
      await f.t.mutation(worker("observeProgram"), {
        ...good,
        state: "hold",
        mode: "manual",
        outputMs: 201,
        sourceId: undefined,
        sourceRevision: undefined,
        slotKey: undefined,
      })
    ).kind,
    "ok",
  );
  assert.equal(
    (await f.receipt(f.args.sessionId)).committedIntent.kind,
    "manual",
  );
  assert.equal((await f.receipt(f.args.sessionId)).broadcastMode, "manual");
});
it("ack then Cut leaves old observation superseded and Cut bypasses future ordinary heads", async () => {
  const f = await controlFixture();
  const c = await f.take();
  await f.begin(c.commandId);
  await f.promote(c.commandId);
  await f.ack(c.commandId);
  await f.t.run((ctx) =>
    ctx.db.insert("eventMediaCommands", {
      programId: f.output.programId,
      eventId: f.event.eventId,
      sessionId: f.args.sessionId,
      commandType: "hold_current",
      status: "claimed",
      sequence: 999,
      availableAt: Date.now() + 60000,
      publicFallbackLinks: [],
      actorSurface: "worker",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }),
  );
  const cut = await f.owner.mutation(api.events.queueEventMediaCommand, {
    currentSlug: f.event.slug,
    type: "switch_hold",
    idempotencyKey: "cut",
  });
  assert.equal((await f.receipt(f.args.sessionId)).broadcastMode, "manual");
  const claims = await f.t.mutation(worker("claimCommands"), f.args);
  assert.equal(claims.commands[0]._id, cut.commandId);
  assert.equal((await f.ack(c.commandId)).kind, "superseded");
  assert.equal(
    (await f.receipt(f.args.sessionId)).committedIntent.kind,
    "slate",
  );
  const r = await f.receipt(cut.commandId);
  await f.begin(cut.commandId);
  assert.equal(
    (
      await f.ack(cut.commandId, {
        intentSequence: r.sequence,
        observedSourceId: null,
        sourceRevision: undefined,
        slotKey: undefined,
        observedState: "hold",
        outputMs: 200,
      })
    ).kind,
    "ok",
  );
  const confirmed = await f.receipt(f.args.sessionId);
  assert.equal(confirmed.broadcastMode, "hold");
  assert.equal((await f.ack(c.commandId)).kind, "superseded");
  assert.deepEqual(await f.receipt(f.args.sessionId), confirmed);
});
for (const prior of ["manual", "slate"] as const)
  it(`failed Return to auto preserves ${prior} intent`, async () => {
    const f = await controlFixture();
    const c = await f.take();
    await f.begin(c.commandId);
    await f.promote(c.commandId);
    await f.ack(c.commandId);
    if (prior === "slate") {
      const cut = await f.owner.mutation(api.events.queueEventMediaCommand, {
        currentSlug: f.event.slug,
        type: "switch_hold",
        idempotencyKey: "cut",
      });
      await f.begin(cut.commandId);
      await f.ack(cut.commandId, {
        outputMs: 101,
        observedSourceId: null,
        sourceRevision: undefined,
        slotKey: undefined,
        observedState: "hold",
      });
    }
    const beforeMode = (await f.receipt(f.args.sessionId)).broadcastMode;
    assert.equal(beforeMode, prior === "slate" ? "hold" : "manual");
    const before = (await f.receipt(f.args.sessionId)).committedIntent;
    const auto = await f.owner.mutation(api.events.queueEventMediaCommand, {
      currentSlug: f.event.slug,
      type: "set_automatic_mode",
      idempotencyKey: "auto",
    });
    await f.begin(auto.commandId);
    const row = await f.receipt(auto.commandId);
    assert.equal(row.controlTarget.kind, "slate");
    const result = await f.t.mutation(worker("acknowledgeCommand"), {
      ...f.args,
      commandId: auto.commandId,
      sequence: row.sequence,
      outcome: "failed",
      failureReason: "source_unavailable",
    });
    assert.equal(result.kind, "failed");
    assert.deepEqual(
      (await f.receipt(f.args.sessionId)).committedIntent,
      before,
    );
    assert.equal((await f.receipt(f.args.sessionId)).broadcastMode, beforeMode);
  });
it("promoting takeover keeps phase, original expiry and committed target after timeout", async () => {
  const f = await controlFixture();
  const c = await f.take();
  await f.begin(c.commandId);
  await f.promote(c.commandId);
  const original = await f.receipt(c.commandId);
  await f.t.run((ctx) => ctx.db.patch(f.args.sessionId, { leaseExpiresAt: 0 }));
  const next = { ...f.args, workerId: "new" };
  const lease = await f.t.mutation(worker("acquireSession"), next);
  await f.t.mutation(worker("beginPreparation"), {
    ...next,
    epoch: lease.epoch,
    commandId: c.commandId,
    sequence: original.sequence,
  });
  assert.equal((await f.receipt(c.commandId)).controlPhase, "promoting");
  assert.equal(
    (await f.receipt(c.commandId)).preparationExpiresAt,
    original.preparationExpiresAt,
  );
  await assert.rejects(
    f.owner.mutation(cancelRef, {
      currentSlug: f.event.slug,
      commandId: c.commandId,
      idempotencyKey: "cancel",
    }),
    /preparing/,
  );
  await f.t.run((ctx) =>
    ctx.db.patch(c.commandId, { preparationExpiresAt: 0 }),
  );
  assert.deepEqual(
    await f.t.mutation(worker("promoteOperation"), {
      ...next,
      epoch: lease.epoch,
      commandId: c.commandId,
      sequence: original.sequence,
      target: original.controlTarget,
    }),
    { kind: "failed", reason: "expired" },
  );
  assert.equal(
    (await f.receipt(f.args.sessionId)).committedIntent.kind,
    "manual",
  );
  assert.deepEqual(await f.ack(c.commandId), {
    kind: "fenced",
    reason: "lease",
  });
});
for (const status of [
  "scheduled",
  "starting",
  "live",
  "hold",
  "fallback",
  "stopping",
] as const)
  it(`migration rejects ${status} sessions even without active pointer`, async () => {
    const f = await controlFixture();
    await f.t.run(async ({ db }) => {
      await db.patch(f.args.sessionId, { status });
      await db.patch(f.output.programId, { activeSessionId: undefined });
    });
    await assert.rejects(
      f.t.mutation(migrationRef, { batchSize: 1 }),
      /no open sessions/,
    );
  });
it("migration is bounded, idempotent, preserves disabled/internal rows and normalizes known manual only", async () => {
  const f = await controlFixture();
  await f.t.run(async ({ db }) => {
    await db.patch(f.args.sessionId, {
      status: "ended",
      committedIntent: undefined,
      broadcastMode: "manual",
      currentSourceId: f.sourceId,
    });
    await db.patch(f.sourceId, { input: undefined, revision: undefined });
  });
  const step = { phase: "eventMediaSessions", batchSize: 1 };
  assert.equal((await f.t.mutation(migrationRef, step)).processed, 1);
  assert.equal(
    (await f.receipt(f.args.sessionId)).committedIntent.kind,
    "manual",
  );
  const before = await f.receipt(f.args.sessionId);
  await f.t.mutation(migrationRef, step);
  assert.deepEqual(await f.receipt(f.args.sessionId), before);
  await assert.rejects(
    f.t.mutation(migrationRef, { batchSize: 101 }),
    /between/,
  );
  const old = await f.t.run(async ({ db }) => {
    await db.patch(f.sourceId, { state: "disabled" });
    await db.patch(f.args.sessionId, { committedIntent: undefined });
    const internal = await db.insert("eventMediaSources", {
      programId: f.output.programId,
      eventId: f.event.eventId,
      key: "internal",
      position: 2,
      type: "rtmp_source",
      purpose: "program",
      state: "ready",
      label: "Internal",
      publicUrl: "rtmp://operator.example/live",
      createdAt: 1,
      updatedAt: 1,
    });
    const command = await db.insert("eventMediaCommands", {
      programId: f.output.programId,
      eventId: f.event.eventId,
      commandType: "switch_source",
      status: "claimed",
      sequence: 77,
      targetSourceId: f.sourceId,
      publicFallbackLinks: [],
      actorSurface: "worker",
      createdAt: 1,
      updatedAt: 1,
    });
    return { internal, command };
  });
  await f.t.mutation(migrationRef, {
    phase: "eventMediaSources",
    batchSize: 100,
  });
  assert.equal((await f.receipt(f.sourceId)).state, "disabled");
  assert.equal((await f.receipt(old.internal)).input, undefined);
  await f.t.mutation(migrationRef, step);
  assert.equal(
    (await f.receipt(f.args.sessionId)).committedIntent.kind,
    "slate",
  );
  await f.t.mutation(migrationRef, { phase: "eventMediaCommands" });
  const command = await f.receipt(old.command);
  assert.equal(command.status, "cancelled");
  assert.equal(command.sequence, 77);
  await f.t.mutation(migrationRef, { phase: "eventMediaCommands" });
  assert.deepEqual(await f.receipt(old.command), command);
});
it("equal output watermark cannot describe two rendered identities", async () => {
  const f = await controlFixture();
  const c = await f.take();
  await f.begin(c.commandId);
  await f.promote(c.commandId);
  await f.ack(c.commandId);
  const row = await f.receipt(c.commandId);
  const before = await f.receipt(f.args.sessionId);
  assert.equal(
    (
      await f.t.mutation(worker("observeProgram"), {
        ...f.args,
        intentSequence: row.sequence,
        outputMs: 100,
        outputId: f.output.outputId,
        state: "hold",
        publishing: true,
      })
    ).kind,
    "superseded",
  );
  assert.deepEqual(await f.receipt(f.args.sessionId), before);
});
it("successful control cannot use terminal lifecycle evidence", async () => {
  const f = await controlFixture();
  const c = await f.owner.mutation(api.events.queueEventMediaCommand, {
    currentSlug: f.event.slug,
    type: "switch_hold",
    idempotencyKey: "cut",
  });
  await f.begin(c.commandId);
  assert.equal(
    (
      await f.ack(c.commandId, {
        observedSourceId: null,
        sourceRevision: undefined,
        slotKey: undefined,
        observedState: "error",
      })
    ).kind,
    "superseded",
  );
});
it("concurrent admissions serialize one ordinary target and exact retry", async () => {
  const f = await controlFixture();
  const results = await Promise.allSettled([f.take("a"), f.take("b")]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(results.filter((r) => r.status === "rejected").length, 1);
  const winner = results.find((r) => r.status === "fulfilled")!;
  assert.equal(winner.status, "fulfilled");
  const c = await f.receipt(winner.value.commandId);
  assert.equal((await f.take(c.idempotencyKey)).commandId, c._id);
});
it("idempotency scopes stable actors and replacement sessions", async () => {
  const f = await controlFixture();
  const cut = {
    currentSlug: f.event.slug,
    type: "switch_hold" as const,
    idempotencyKey: "shared",
  };
  const first = await f.owner.mutation(api.events.queueEventMediaCommand, cut);
  const subject = newClerkUserId();
  await f.t.run(async ({ db }) => {
    const event = (await db.get(f.event.eventId))!;
    await db.insert("users", {
      clerkUserId: subject,
      name: "Delegate",
      emailVerificationTime: Date.now(),
    });
    await db.insert("communityAuthorities", {
      communityProfileId: event.communityProfileId!,
      subjectTokenIdentifier: `test|${subject}`,
      subject: { subject, issuer: "test", tokenIdentifier: `test|${subject}` },
      capabilities: ["manage_event_media"],
      state: "active",
      grantedAt: Date.now(),
      updatedAt: Date.now(),
    });
  });
  const delegate = f.t.withIdentity({
    subject,
    issuer: "test",
    tokenIdentifier: `test|${subject}`,
    emailVerified: true,
  });
  const second = await delegate.mutation(
    api.events.queueEventMediaCommand,
    cut,
  );
  assert.notEqual(second.commandId, first.commandId);
  await f.t.run((ctx) =>
    ctx.db.patch(f.args.sessionId, { status: "ended", leaseExpiresAt: 0 }),
  );
  const next = await f.owner.mutation(api.events.scheduleEventMediaWorker, {
    currentSlug: f.event.slug,
    startImmediately: true,
  });
  const third = await f.owner.mutation(api.events.queueEventMediaCommand, cut);
  assert.notEqual(third.commandId, first.commandId);
  assert.notEqual(next.sessionId, f.args.sessionId);
  assert.equal((await f.receipt(next.sessionId)).committedIntent.kind, "slate");
});
async function projectedControlFixture() {
  const f = await controlFixture();
  const profile = await f.t.run(async ({ db }) => {
    const person = await db.insert("profiles", {
      slug: "dj",
      displayName: "DJ",
      sortName: "dj",
      aliases: [],
      tags: [],
      claimState: "unclaimed",
      publicationState: "published",
      publicSurfacingState: "public",
      creationSource: "community",
      updatedAt: Date.now(),
      profileType: "person",
      person: { roleTags: [] },
      outboundLinks: [
        {
          type: "other",
          label: "Stream",
          source: "owner_authored",
          url: "vrcdn:source_a",
        },
      ],
    });
    const slot = await db.insert("eventSlots", {
      eventId: f.event.eventId,
      position: 0,
      startAt: Date.now() - 1000,
      personProfileId: person,
      selectedStreamId: "source_a",
      displayLabel: "DJ",
      roleLabel: "DJ",
      sourceType: "manual",
      sourceLabel: "Owner",
      confidence: 1,
      reviewState: "confirmed",
      updatedAt: Date.now(),
    });
    return { person, slot };
  });
  const config = (await f.t.mutation(worker("refreshConfiguration"), f.args))
    .configuration;
  const source = config.sources.find(
    (s: { eventSlotId: string }) => s.eventSlotId === profile.slot,
  )!;
  const c = await f.owner.mutation(api.events.queueEventMediaCommand, {
    currentSlug: f.event.slug,
    type: "switch_next",
    idempotencyKey: "profile",
  });
  await f.begin(c.commandId);
  return { ...f, profile, projectedSource: source, operation: c };
}
it("profile link removal during preparation is denied without waiting for projection refresh", async () => {
  const f = await projectedControlFixture();
  await f.t.run((ctx) => ctx.db.patch(f.profile.person, { outboundLinks: [] }));
  assert.deepEqual(await f.promote(f.operation.commandId), {
    kind: "failed",
    reason: "source_unavailable",
  });
});

it("migration rejects legacy failed tasks without confirmed stop", async () => {
  const f = await controlFixture();
  await f.t.run((ctx) =>
    ctx.db.patch(f.args.sessionId, {
      status: "ended",
      workerTaskId: "legacy-task",
      workerTaskStatus: "failed",
    }),
  );
  await assert.rejects(f.t.mutation(migrationRef, {}), /stop.*confirmed/i);
});
it("late Start observation cannot overwrite a committed Cut", async () => {
  const f = await controlFixture();
  await f.t.mutation(worker("claimCommands"), f.args);
  await f.owner.mutation(api.events.queueEventMediaCommand, {
    currentSlug: f.event.slug,
    type: "switch_hold",
    idempotencyKey: "cut",
  });
  const c = await f.receipt(f.scheduled.startCommandId);
  const before = await f.receipt(f.args.sessionId);
  assert.equal(
    (
      await f.t.mutation(worker("acknowledgeCommand"), {
        ...f.args,
        commandId: c._id,
        sequence: c.sequence,
        outcome: "succeeded",
        intentSequence: 0,
        outputMs: 100,
        observedSourceId: f.sourceId,
        sourceRevision: 1,
        slotKey: `manual-${f.sourceId}`,
        observedState: "live",
        observedOutputId: f.output.outputId,
      })
    ).kind,
    "superseded",
  );
  assert.deepEqual(await f.receipt(f.args.sessionId), before);
});
it("non-source queue requests also enforce scoped payload idempotency", async () => {
  const f = await controlFixture();
  const request = {
    currentSlug: f.event.slug,
    type: "mark_source_live" as const,
    targetSourceKey: "source_a",
    idempotencyKey: "mark",
  };
  const a = await f.owner.mutation(api.events.queueEventMediaCommand, request);
  const b = await f.owner.mutation(api.events.queueEventMediaCommand, request);
  assert.equal(a.commandId, b.commandId);
  await assert.rejects(
    f.owner.mutation(api.events.queueEventMediaCommand, {
      ...request,
      type: "mark_source_offline",
    }),
    /Idempotency/,
  );
});
it("source revision change does not re-resolve an idempotent receipt", async () => {
  const f = await controlFixture();
  const a = await f.take();
  await f.t.run((ctx) => ctx.db.patch(f.sourceId, { revision: 2 }));
  assert.equal((await f.take()).commandId, a.commandId);
  const row = await f.receipt(a.commandId);
  assert.equal(row.controlTarget.source.revision, 1);
  assert.deepEqual(await f.begin(a.commandId), {
    kind: "failed",
    reason: "source_unavailable",
  });
});
it("removing manual desired source while observing fallback is atomic and idempotent", async () => {
  const f = await controlFixture();
  const c = await f.take();
  await f.begin(c.commandId);
  await f.promote(c.commandId);
  await f.ack(c.commandId);
  const row = await f.receipt(c.commandId);
  await f.t.mutation(worker("observeProgram"), {
    ...f.args,
    intentSequence: row.sequence,
    outputMs: 101,
    outputId: f.output.outputId,
    state: "hold",
    publishing: true,
  });
  assert.equal((await f.receipt(f.args.sessionId)).currentSourceId, undefined);
  const remove = () =>
    f.owner.mutation(
      makeFunctionReference<"mutation">("eventMediaSources:remove"),
      { currentSlug: f.event.slug, sourceId: f.sourceId },
    );
  await remove();
  const before = await f.receipt(f.args.sessionId);
  await remove();
  assert.deepEqual(await f.receipt(f.args.sessionId), before);
  assert.equal(before.committedIntent.kind, "slate");
});
it("Return to auto with an unavailable current interval commits automatic slate", async () => {
  const f = await controlFixture();
  await f.t.run(async ({ db }) => {
    const slot = await db.insert("eventSlots", {
      eventId: f.event.eventId,
      position: 0,
      startAt: Date.now() - 1000,
      displayLabel: "DJ",
      roleLabel: "DJ",
      sourceType: "manual",
      sourceLabel: "Owner",
      confidence: 1,
      reviewState: "confirmed",
      updatedAt: Date.now(),
    });
    await db.patch(f.sourceId, { eventSlotId: slot, state: "disabled" });
    await db.patch(f.args.sessionId, { committedIntent: { kind: "slate" } });
  });
  const c = await f.owner.mutation(api.events.queueEventMediaCommand, {
    currentSlug: f.event.slug,
    type: "set_automatic_mode",
    idempotencyKey: "auto",
  });
  await f.begin(c.commandId);
  assert.equal((await f.promote(c.commandId)).kind, "ok");
  assert.equal(
    (await f.receipt(f.args.sessionId)).committedIntent.kind,
    "automatic",
  );
  assert.equal(
    (
      await f.ack(c.commandId, {
        observedSourceId: null,
        sourceRevision: undefined,
        slotKey: undefined,
        observedState: "hold",
      })
    ).kind,
    "ok",
  );
  assert.equal((await f.receipt(f.args.sessionId)).broadcastMode, "automatic");
});
it("Return to auto confirms an available scheduled source", async () => {
  const f = await controlFixture();
  const take = await f.take();
  await f.begin(take.commandId);
  await f.promote(take.commandId);
  await f.ack(take.commandId);
  const slot = await f.t.run(async ({ db }) => {
    const id = await db.insert("eventSlots", {
      eventId: f.event.eventId, position: 0, startAt: Date.now() - 1000,
      displayLabel: "DJ", roleLabel: "DJ", sourceType: "manual",
      sourceLabel: "Owner", confidence: 1, reviewState: "confirmed", updatedAt: Date.now(),
    });
    await db.patch(f.sourceId, { eventSlotId: id });
    return id;
  });
  const auto = await f.owner.mutation(api.events.queueEventMediaCommand, {
    currentSlug: f.event.slug, type: "set_automatic_mode", idempotencyKey: "auto",
  });
  await f.begin(auto.commandId);
  await f.promote(auto.commandId);
  assert.equal((await f.receipt(f.args.sessionId)).broadcastMode, "manual");
  assert.equal((await f.ack(auto.commandId, { outputMs: 200, slotKey: slot })).kind, "ok");
  assert.equal((await f.receipt(f.args.sessionId)).broadcastMode, "automatic");
});
it("Next joins the current interval, advances early, and Previous preserves authored adjacency", async () => {
  const f = await controlFixture();
  const slots = await f.t.run(async ({ db }) => {
    const now = Date.now();
    const a = await db.insert("eventSlots", {
      eventId: f.event.eventId,
      position: 0,
      startAt: now - 1000,
      endAt: now + 60000,
      displayLabel: "A",
      roleLabel: "DJ",
      sourceType: "manual",
      sourceLabel: "Owner",
      confidence: 1,
      reviewState: "confirmed",
      updatedAt: now,
    });
    const b = await db.insert("eventSlots", {
      eventId: f.event.eventId,
      position: 1,
      startAt: now + 60000,
      displayLabel: "B",
      roleLabel: "DJ",
      sourceType: "manual",
      sourceLabel: "Owner",
      confidence: 1,
      reviewState: "confirmed",
      updatedAt: now,
    });
    await db.patch(f.sourceId, { eventSlotId: a });
    const source = await db.insert("eventMediaSources", {
      programId: f.output.programId,
      eventId: f.event.eventId,
      eventSlotId: b,
      key: "source_b",
      position: 1,
      type: "vrcdn_link",
      purpose: "program",
      state: "ready",
      label: "B",
      publicUrl: "vrcdn:source_b",
      revision: 1,
      createdAt: now,
      updatedAt: now,
    });
    return { a, b, source };
  });
  let outputMs = 100;
  for (const [type, sourceId, slotKey] of [
    ["switch_next", f.sourceId, slots.a],
    ["switch_next", slots.source, slots.b],
    ["switch_previous", f.sourceId, slots.a],
  ] as const) {
    const c = await f.owner.mutation(api.events.queueEventMediaCommand, {
      currentSlug: f.event.slug,
      type,
      idempotencyKey: crypto.randomUUID(),
    });
    const row = await f.receipt(c.commandId);
    assert.equal(row.controlTarget.source.slotKey, slotKey);
    await f.begin(c.commandId);
    await f.promote(c.commandId);
    assert.equal(
      (
        await f.ack(c.commandId, {
          observedSourceId: sourceId,
          slotKey,
          outputMs: outputMs++,
        })
      ).kind,
      "ok",
    );
  }
});
it("migration allows confirmed task stop even if a later diagnostic says failed", async () => {
  const f = await controlFixture();
  await f.t.run((ctx) =>
    ctx.db.patch(f.args.sessionId, {
      status: "ended",
      workerTaskId: "task",
      workerTaskStatus: "failed",
      dispatchId: "dispatch",
      dispatchStopConfirmedAt: Date.now(),
    }),
  );
  assert.equal(
    (await f.t.mutation(migrationRef, { batchSize: 1 })).processed,
    1,
  );
});
for (const visibility of ["link", "profile"] as const)
  it(`hidden ${visibility} before grant fails without worker refresh`, async () => {
    const f = await projectedControlFixture();
    await f.t.run((ctx) =>
      ctx.db.patch(
        f.profile.person,
        visibility === "link"
          ? { fieldVisibility: { outboundLinks: "private" } }
          : { publicationState: "draft_private" },
      ),
    );
    assert.deepEqual(await f.promote(f.operation.commandId), {
      kind: "failed",
      reason: "source_unavailable",
    });
    assert.equal(
      (await f.receipt(f.args.sessionId)).committedIntent.kind,
      "automatic",
    );
  });
for (const promoted of [false, true])
  it(`removed and reappeared projection cannot restore ${promoted ? "promoting" : "preparing"} pinned revision on takeover`, async () => {
    const f = await projectedControlFixture();
    const original = await f.receipt(f.operation.commandId);
    if (promoted) await f.promote(f.operation.commandId);
    const profile = await f.receipt(f.profile.person);
    await f.t.run((ctx) =>
      ctx.db.patch(f.profile.person, { outboundLinks: [] }),
    );
    await f.t.mutation(worker("refreshConfiguration"), f.args);
    const unavailable = await f.receipt(f.projectedSource.id);
    assert.equal(unavailable.projectionAvailable, false);
    assert.ok(unavailable.revision > original.controlTarget.source.revision);
    await f.t.run(async ({ db }) => {
      await db.patch(f.profile.person, {
        outboundLinks: profile.outboundLinks,
      });
      await db.patch(f.args.sessionId, { leaseExpiresAt: 0 });
    });
    const replacement = { ...f.args, workerId: "replacement" };
    const lease = await f.t.mutation(worker("acquireSession"), replacement);
    const current = lease.configuration.sources.find(
      (s: { id: string }) => s.id === f.projectedSource.id,
    );
    assert.ok(current.revision > unavailable.revision);
    const result = await f.t.mutation(worker("beginPreparation"), {
      ...replacement,
      epoch: lease.epoch,
      commandId: original._id,
      sequence: original.sequence,
    });
    assert.deepEqual(result, { kind: "failed", reason: "source_unavailable" });
    const session = await f.receipt(f.args.sessionId);
    assert.equal(
      session.committedIntent.kind,
      promoted ? "manual" : "automatic",
    );
    if (promoted)
      assert.equal(
        session.committedIntent.revision,
        original.controlTarget.source.revision,
      );
    assert.equal(
      (await f.receipt(original._id)).preparationExpiresAt,
      original.preparationExpiresAt,
    );
  });
for (const visibility of ["removed", "hidden"] as const)
  it(`migration never revives ${visibility} public profile links or old commands`, async () => {
    const f = await projectedControlFixture();
    await f.t.run(async ({ db }) => {
      await db.patch(
        f.profile.person,
        visibility === "removed"
          ? { outboundLinks: [] }
          : { fieldVisibility: { outboundLinks: "private" } },
      );
      await db.patch(f.args.sessionId, {
        status: "ended",
        committedIntent: undefined,
        broadcastMode: "manual",
        currentSourceId: f.projectedSource.id,
        observedSourceRevision: f.projectedSource.revision,
      });
    });
    const profileBefore = await f.receipt(f.profile.person);
    await f.t.mutation(migrationRef, { phase: "eventMediaSources" });
    await f.t.mutation(migrationRef, { phase: "eventMediaSessions" });
    await f.t.mutation(migrationRef, { phase: "eventMediaCommands" });
    assert.deepEqual(await f.receipt(f.profile.person), profileBefore);
    assert.equal(
      (await f.receipt(f.args.sessionId)).committedIntent.kind,
      "slate",
    );
    assert.equal((await f.receipt(f.operation.commandId)).status, "cancelled");
    const next = await f.owner.mutation(api.events.scheduleEventMediaWorker, {
      currentSlug: f.event.slug,
      startImmediately: true,
    });
    const lease = await f.t.mutation(worker("acquireSession"), {
      ...f.args,
      sessionId: next.sessionId,
      epoch: 0,
    });
    assert.deepEqual(lease.configuration.committedIntent, {
      kind: "automatic",
    });
    assert.equal(
      lease.configuration.sources.some(
        (s: { id: string }) => s.id === f.projectedSource.id,
      ),
      false,
    );
    assert.equal(
      (
        await f.t.mutation(worker("claimCommands"), {
          ...f.args,
          sessionId: next.sessionId,
          epoch: lease.epoch,
        })
      ).commands.some((c: { _id: string }) => c._id === f.operation.commandId),
      false,
    );
  });
it("Cut and Stop remain claimable beyond an ordinary batch backlog", async () => {
  const f = await controlFixture();
  await f.t.run(async ({ db }) => {
    for (let i = 0; i < 45; i++)
      await db.insert("eventMediaCommands", {
        programId: f.output.programId,
        eventId: f.event.eventId,
        sessionId: f.args.sessionId,
        commandType: "mark_source_live",
        status: "queued",
        sequence: 10 + i,
        availableAt: Date.now() + 60000,
        publicFallbackLinks: [],
        actorSurface: "worker",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
  });
  const cut = await f.owner.mutation(api.events.queueEventMediaCommand, {
    currentSlug: f.event.slug,
    type: "switch_hold",
    idempotencyKey: "cut",
  });
  assert.equal(
    (await f.t.mutation(worker("claimCommands"), f.args)).commands[0]._id,
    cut.commandId,
  );
  await f.owner.mutation(api.events.stopEventMediaWorker, {
    currentSlug: f.event.slug,
    sessionId: f.args.sessionId,
  });
  assert.equal(
    (await f.t.mutation(worker("claimCommands"), f.args)).commands[0]
      .commandType,
    "stop_program",
  );
});
it("idempotency keys do not collide between events", async () => {
  const f = await controlFixture();
  const first = await f.owner.mutation(api.events.queueEventMediaCommand, {
    currentSlug: f.event.slug,
    type: "switch_hold",
    idempotencyKey: "shared",
  });
  const event = await f.owner.mutation(api.events.createCommunityEvent, {
    communitySlug: "club",
    title: "Second",
    startAt: Date.now() + 600000,
    timezone: "UTC",
  });
  await f.owner.mutation(api.events.configureVrcdnOutput, {
    currentSlug: event.slug,
    key: "main",
    label: "Main",
    credentialRef: "event-media/vrcdn/main",
    sourceConsentAccepted: true,
    destinationAuthorityAccepted: true,
    providerRulesAccepted: true,
    rightsClearedMediaAccepted: true,
    playbackLinks: [{ platform: "browser", url: "https://example.test/watch" }],
  });
  await f.owner.mutation(api.events.scheduleEventMediaWorker, {
    currentSlug: event.slug,
    startImmediately: true,
  });
  const second = await f.owner.mutation(api.events.queueEventMediaCommand, {
    currentSlug: event.slug,
    type: "switch_hold",
    idempotencyKey: "shared",
  });
  assert.notEqual(second.commandId, first.commandId);
});
for (const protocolVersion of [0, 1, 3])
  it(`protocol ${protocolVersion} cannot acquire version 2 session`, async () => {
    const f = await fixture();
    await assert.rejects(
      f.t.mutation(worker("acquireSession"), { ...f.args, protocolVersion }),
      /protocol 2/,
    );
  });
it("Cut confirmation requires the persisted worker receipt budget", async () => {
  const f = await controlFixture();
  const cut = await f.owner.mutation(api.events.queueEventMediaCommand, {
    currentSlug: f.event.slug,
    type: "switch_hold",
    idempotencyKey: "cut",
  });
  const evidence = {
    observedSourceId: null,
    sourceRevision: undefined,
    slotKey: undefined,
    observedState: "hold",
  };
  assert.equal((await f.ack(cut.commandId, evidence)).kind, "superseded");
  assert.equal(
    (await f.receipt(f.args.sessionId)).pendingControlCommandId,
    cut.commandId,
  );
  assert.equal((await f.receipt(f.args.sessionId)).broadcastMode, undefined);
  await f.begin(cut.commandId);
  assert.equal((await f.ack(cut.commandId, evidence)).kind, "ok");
  assert.equal((await f.receipt(f.args.sessionId)).broadcastMode, "hold");
});
for (const commandType of ["start_program", "mark_source_live"] as const)
  it(`confirmed Cut supersedes older ${commandType} receipt without accepting its evidence`, async () => {
    const f = await controlFixture();
    const commandId =
      commandType === "start_program"
        ? f.scheduled.startCommandId!
        : await f.t.run(({ db }) =>
            db.insert("eventMediaCommands", {
              programId: f.output.programId,
              eventId: f.event.eventId,
              sessionId: f.args.sessionId,
              commandType,
              sequence: 2,
              status: "queued",
              publicFallbackLinks: [],
              actorSurface: "worker",
              createdAt: Date.now(),
              updatedAt: Date.now(),
            }),
          );
    await f.t.mutation(worker("claimCommands"), f.args);
    const cut = await f.owner.mutation(api.events.queueEventMediaCommand, {
      currentSlug: f.event.slug,
      type: "switch_hold",
      idempotencyKey: "cut",
    });
    await f.begin(cut.commandId);
    assert.equal(
      (
        await f.ack(cut.commandId, {
          observedSourceId: null,
          sourceRevision: undefined,
          slotKey: undefined,
          observedState: "hold",
        })
      ).kind,
      "ok",
    );
    const before = await f.receipt(f.args.sessionId);
    assert.equal(before.broadcastMode, "hold");
    const command = await f.receipt(commandId);
    const late = {
      ...f.args,
      commandId,
      sequence: command.sequence,
      outcome: "succeeded",
      intentSequence: 0,
      outputMs: 200,
      observedSourceId: f.sourceId,
      sourceRevision: 1,
      slotKey: `manual-${f.sourceId}`,
      observedOutputId: f.output.outputId,
      observedState: "live",
    };
    assert.deepEqual(await f.t.mutation(worker("acknowledgeCommand"), late), {
      kind: "superseded",
    });
    assert.deepEqual(await f.receipt(f.args.sessionId), before);
    const settled = await f.receipt(commandId);
    assert.equal(settled.status, "cancelled");
    assert.equal(settled.controlOutcome, "superseded");
    assert.equal(settled.observedSourceId, undefined);
    assert.deepEqual(await f.t.mutation(worker("acknowledgeCommand"), late), {
      kind: "superseded",
    });
    assert.deepEqual(await f.receipt(commandId), settled);
    assert.equal(
      (await f.t.mutation(worker("claimCommands"), f.args)).commands.some(
        (c: any) => c._id === commandId,
      ),
      false,
    );
    assert.equal(
      (
        await f.t.mutation(worker("acknowledgeCommand"), {
          ...late,
          epoch: f.args.epoch - 1,
        })
      ).accepted,
      false,
    );
    await f.t.run(({ db }) =>
      db.patch(f.output.outputId, { state: "disabled" }),
    );
    assert.deepEqual(await f.t.mutation(worker("acknowledgeCommand"), late), {
      kind: "fenced",
      reason: "destination",
    });
    await f.t.run(({ db }) => db.patch(f.output.outputId, { state: "active" }));
    await f.owner.mutation(api.events.stopEventMediaWorker, {
      currentSlug: f.event.slug,
      sessionId: f.args.sessionId,
    });
    assert.deepEqual(await f.t.mutation(worker("acknowledgeCommand"), late), {
      kind: "fenced",
      reason: "stopped",
    });
    const stop = (await f.t.mutation(worker("claimCommands"), f.args))
      .commands[0];
    assert.equal(stop.commandType, "stop_program");
    assert.equal(
      (
        await f.t.mutation(worker("acknowledgeCommand"), {
          ...f.args,
          commandId: stop._id,
          sequence: stop.sequence,
          outcome: "succeeded",
          observedState: "ended",
          observedSourceId: null,
        })
      ).accepted,
      true,
    );
  });

for (const fence of ["epoch", "lease", "replacement"] as const)
  it(`stale ${fence} rejects completion and periodic mode without observation writes`, async () => {
    const f = await controlFixture();
    await f.t.mutation(worker("observeProgram"), {
      ...f.args, intentSequence: 0, state: "hold", outputMs: 10,
      publishing: true, outputId: f.output.outputId,
    });
    const c = await f.take();
    await f.begin(c.commandId);
    await f.promote(c.commandId);
    await f.t.run(async ({ db }) => {
      if (fence === "epoch") await db.patch(f.args.sessionId, { epoch: f.args.epoch + 1 });
      if (fence === "lease") await db.patch(f.args.sessionId, { leaseExpiresAt: 0 });
      if (fence === "replacement") {
        const session = (await db.get(f.args.sessionId))!;
        const { _id, _creationTime, ...record } = session;
        const replacement = await db.insert("eventMediaSessions", { ...record, workerId: "new" });
        await db.patch(f.output.programId, { activeSessionId: replacement });
      }
    });
    const before = await f.receipt(f.args.sessionId);
    assert.deepEqual(await f.ack(c.commandId), { kind: "fenced", reason: "lease" });
    assert.deepEqual(await f.t.mutation(worker("observeProgram"), {
      ...f.args, intentSequence: before.intentSequence, state: "hold", outputMs: 20,
      publishing: true, outputId: f.output.outputId,
    }), { kind: "fenced", reason: "lease" });
    assert.deepEqual(await f.receipt(f.args.sessionId), before);
    assert.equal(before.broadcastMode, "automatic");
  });
