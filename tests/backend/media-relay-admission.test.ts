import assert from "node:assert/strict";
import { it } from "node:test";
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import schemaModule from "../../convex/schema";
import { AdmissionSchema, RELAY_POLICY } from "../../packages/media-relay/src";
const schema =
  (schemaModule as unknown as { default?: typeof schemaModule }).default ??
  schemaModule;
const modules = {
  "../../convex/mediaRelayWorker.ts": () =>
    import("../../convex/mediaRelayWorker"),
  "../../convex/_generated/api.ts": () => import("../../convex/_generated/api"),
  "../../convex/mediaRelayPlayback.ts": () =>
    import("../../convex/mediaRelayPlayback"),
};
const open = makeFunctionReference<"mutation">(
  "mediaRelayPlayback:openPlayback",
);
const get = makeFunctionReference<"query">("mediaRelayPlayback:getPlayback");
const release = makeFunctionReference<"mutation">(
  "mediaRelayPlayback:releasePlayback",
);
const resolve = makeFunctionReference<"query">(
  "mediaRelayPlayback:resolveGrant",
);
async function fixture(enabled = true) {
  process.env.MEDIA_RELAY_ENABLED = String(enabled);
  process.env.MEDIA_RELAY_MAX_SOURCES = "2";
  process.env.MEDIA_RELAY_MAX_GRANTS = "100";
  process.env.MEDIA_RELAY_ADMISSIONS_PER_MINUTE = "100";
  const t = convexTest({ schema, modules });
  const ids = await t.run(async (ctx) => {
    const profileId = await ctx.db.insert("profiles", {
      slug: "dj",
      displayName: "DJ",
      sortName: "dj",
      aliases: [],
      tags: [],
      claimState: "unclaimed",
      publicationState: "published",
      publicSurfacingState: "public",
      creationSource: "community",
      updatedAt: 1,
      profileType: "person",
      person: { roleTags: [] },
      outboundLinks: [
        {
          type: "vrcdn",
          url: "vrcdn:Alpha",
          label: "Live",
          source: "owner_authored",
        },
      ],
    });
    const eventId = await ctx.db.insert("events", {
      slug: "show",
      title: "Show",
      sortTitle: "show",
      startAt: Date.now() - 1000,
      endAt: Date.now() + 60000,
      watchSurfaceEnabled: true,
      watchMode: "event_stream",
      mediaLinks: [
        {
          type: "vrcdn",
          label: "Live",
          url: "vrcdn:Alpha",
          presentation: "open",
        },
      ],
      sourceType: "manual",
      sourceLabel: "test",
      eventStatus: "scheduled",
      publicationState: "published",
      updatedAt: 1,
    });
    return { profileId, eventId };
  });
  const context = {
    kind: "profile",
    profileId: ids.profileId,
    linkId: "Alpha",
  };
  const eventContext = {
    kind: "event",
    eventId: ids.eventId,
    selectedSourceId: "Alpha",
  };
  const play = (contextOverride = context, streamId = "Alpha") =>
    t.mutation(open, {
      context: contextOverride,
      streamId,
      preferredMode: "audio",
    });
  return { t, ...ids, context, eventContext, play };
}
function preparing(raw: unknown) {
  const value = AdmissionSchema.parse(raw);
  assert.equal(value.kind, "preparing", JSON.stringify(value));
  if (value.kind !== "preparing") throw Error("expected preparing");
  return value;
}
it("admits guests only for a real public source and refuses disabled/zero capacity", async () => {
  const h = await fixture(false);
  assert.equal(AdmissionSchema.parse(await h.play()).kind, "unavailable");
  process.env.MEDIA_RELAY_ENABLED = "true";
  process.env.MEDIA_RELAY_MAX_SOURCES = "0";
  assert.equal(AdmissionSchema.parse(await h.play()).kind, "unavailable");
  process.env.MEDIA_RELAY_MAX_SOURCES = "2";
  assert.equal(
    AdmissionSchema.parse(await h.play({ ...h.context, linkId: "invented" }))
      .kind,
    "unavailable",
  );
  assert.equal(
    AdmissionSchema.parse(await h.play(h.context, "foreign")).kind,
    "unavailable",
  );
  preparing(await h.play());
  await h.t.run((ctx) =>
    ctx.db.patch(h.profileId, {
      fieldVisibility: { outboundLinks: "private" },
    }),
  );
  assert.equal(AdmissionSchema.parse(await h.play()).kind, "unavailable");
});
it("20 concurrent Play requests share one queued source and retain independent grants", async () => {
  const h = await fixture();
  const results = await Promise.all(Array.from({ length: 20 }, () => h.play()));
  assert.equal(new Set(results.map((raw) => preparing(raw).grantId)).size, 20);
  const rows = await h.t.run((ctx) =>
    ctx.db.query("mediaRelaySources").collect(),
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.state, "queued");
  const grants = await h.t.run((ctx) =>
    ctx.db.query("mediaRelayGrants").collect(),
  );
  assert.equal(grants.length, 20);
  assert.ok(
    grants.every(
      (row) =>
        row.grantId !== row._id &&
        row.expiresAt - row.issuedAt === RELAY_POLICY.grantLifetimeMs,
    ),
  );
});
it("event removal revokes only its grant; metadata edits preserve source and grant", async () => {
  const h = await fixture();
  const profile = preparing(await h.play());
  const event = preparing(await h.play(h.eventContext));
  assert.notEqual(profile.grantId, event.grantId);
  await h.t.run((ctx) =>
    ctx.db.patch(h.profileId, { displayName: "New DJ", updatedAt: 9000 }),
  );
  const valid = await h.t.query(resolve, {
    grantId: profile.grantId,
    now: Date.now(),
  });
  assert.equal(valid.kind, "valid");
  assert.equal(valid.metadata.displayName, "New DJ");
  await h.t.run((ctx) => ctx.db.patch(h.eventId, { mediaLinks: [] }));
  assert.equal(
    (await h.t.query(resolve, { grantId: event.grantId, now: Date.now() }))
      .kind,
    "denied",
  );
  assert.equal(
    (await h.t.query(resolve, { grantId: profile.grantId, now: Date.now() }))
      .kind,
    "valid",
  );
  assert.equal(
    (await h.t.run((ctx) => ctx.db.query("mediaRelaySources").collect()))
      .length,
    1,
  );
});
it("existing event grants survive calendar end but new starts and cancellation are denied", async () => {
  const h = await fixture();
  const grant = preparing(await h.play(h.eventContext));
  await h.t.run((ctx) => ctx.db.patch(h.eventId, { endAt: Date.now() - 1 }));
  assert.equal(
    (await h.t.query(resolve, { grantId: grant.grantId, now: Date.now() }))
      .kind,
    "valid",
  );
  assert.equal(
    AdmissionSchema.parse(await h.play(h.eventContext)).kind,
    "unavailable",
  );
  await h.t.run((ctx) => ctx.db.patch(h.eventId, { eventStatus: "cancelled" }));
  assert.equal(
    (await h.t.query(resolve, { grantId: grant.grantId, now: Date.now() }))
      .kind,
    "denied",
  );
});
it("grants expire at the exact boundary and release is idempotent", async () => {
  const h = await fixture();
  const grant = preparing(await h.play());
  const valid = await h.t.query(resolve, {
    grantId: grant.grantId,
    now: Date.now(),
  });
  assert.equal(valid.kind, "valid");
  assert.equal(
    (
      await h.t.query(resolve, {
        grantId: grant.grantId,
        now: valid.grant.expiresAt - 1,
      })
    ).kind,
    "valid",
  );
  assert.equal(
    (
      await h.t.query(resolve, {
        grantId: grant.grantId,
        now: valid.grant.expiresAt,
      })
    ).kind,
    "denied",
  );
  await h.t.mutation(release, { grantId: grant.grantId });
  await h.t.mutation(release, { grantId: grant.grantId });
  assert.equal(
    AdmissionSchema.parse(await h.t.query(get, { grantId: grant.grantId }))
      .kind,
    "unavailable",
  );
});
it("bounded admission limits grants and new sources transactionally", async () => {
  const h = await fixture();
  process.env.MEDIA_RELAY_ADMISSIONS_PER_MINUTE = "1";
  preparing(await h.play());
  assert.equal(AdmissionSchema.parse(await h.play()).kind, "capacityLimited");
});
it("lineup slot authority follows the public performer and explicit selected stream", async () => {
  const h = await fixture();
  const slotId = await h.t.run(async (ctx) => {
    await ctx.db.patch(h.eventId, { watchMode: "performer_sequence" });
    return ctx.db.insert("eventSlots", {
      eventId: h.eventId,
      personProfileId: h.profileId,
      selectedStreamId: "Alpha",
      position: 0,
      startAt: Date.now() - 1000,
      displayLabel: "DJ",
      roleLabel: "DJ",
      sourceType: "manual",
      sourceLabel: "test",
      confidence: 1,
      reviewState: "confirmed",
      updatedAt: 1,
    });
  });
  const context = { ...h.eventContext, selectedSourceId: slotId };
  const grant = preparing(await h.play(context));
  assert.equal(
    AdmissionSchema.parse(
      await h.play({ ...context, selectedSourceId: "invented" }),
    ).kind,
    "unavailable",
  );
  assert.equal(
    AdmissionSchema.parse(await h.play(context, "foreign")).kind,
    "unavailable",
  );
  await h.t.run((ctx) =>
    ctx.db.patch(h.profileId, {
      fieldVisibility: { outboundLinks: "unlisted" },
    }),
  );
  assert.equal(
    (await h.t.query(resolve, { grantId: grant.grantId, now: Date.now() }))
      .kind,
    "denied",
  );
  assert.equal(
    AdmissionSchema.parse(await h.play(context)).kind,
    "unavailable",
  );
});
it("ready returns both capability URLs and release never stops another context", async () => {
  const h = await fixture();
  process.env.MEDIA_RELAY_PLAYBACK_ORIGIN = "https://relay.example";
  const profile = preparing(await h.play());
  const event = preparing(await h.play(h.eventContext));
  await h.t.run(async (ctx) => {
    const row = await ctx.db.query("mediaRelaySources").first();
    assert.ok(row);
    await ctx.db.patch(row._id, { state: "ready" });
  });
  const ready = AdmissionSchema.parse(
    await h.t.query(get, { grantId: profile.grantId }),
  );
  assert.equal(ready.kind, "ready");
  if (ready.kind !== "ready") throw Error("expected ready");
  assert.deepEqual(ready.grant.renditions, ["video", "audio"]);
  assert.equal(
    ready.videoPlaylist,
    `https://relay.example/p/${profile.grantId}/video/index.m3u8`,
  );
  assert.equal(
    ready.audioPlaylist,
    `https://relay.example/p/${profile.grantId}/audio/index.m3u8`,
  );
  await h.t.mutation(release, { grantId: profile.grantId });
  assert.equal(
    AdmissionSchema.parse(await h.t.query(get, { grantId: event.grantId }))
      .kind,
    "ready",
  );
  delete process.env.MEDIA_RELAY_PLAYBACK_ORIGIN;
});
it("public artwork metadata refreshes without revoking or rewriting original assets", async () => {
  const h = await fixture();
  const grant = preparing(await h.play());
  const assetId = await h.t.run(async (ctx) => {
    const assetId = await ctx.db.insert("profileAssets", {
      profileId: h.profileId,
      storageKey: "original.png",
      sourceStorageKey: "untouched.png",
      mimeType: "image/png",
      byteSize: 128,
      visibility: "public",
      source: "owner_authored",
      uploadedBy: {
        tokenIdentifier: "test:owner",
        issuer: "test",
        subject: "owner",
      },
      uploadedAt: 1,
      state: "active",
      updatedAt: 2,
    });
    await ctx.db.insert("profileAssetPlacements", {
      profileId: h.profileId,
      assetId,
      placement: "profile_image",
      position: 0,
      state: "active",
      updatedAt: 2,
    });
    return assetId;
  });
  const before = await h.t.run((ctx) => ctx.db.get(assetId));
  const resolved = await h.t.query(resolve, {
    grantId: grant.grantId,
    now: Date.now(),
  });
  assert.equal(resolved.kind, "valid");
  assert.equal(resolved.metadata.artworkAssetId, assetId);
  assert.equal(resolved.metadata.artworkRevision, "2");
  assert.deepEqual(await h.t.run((ctx) => ctx.db.get(assetId)), before);
  await h.t.run((ctx) =>
    ctx.db.patch(h.profileId, {
      fieldVisibility: { avatarImageUrl: "private" },
    }),
  );
  const hidden = await h.t.query(resolve, {
    grantId: grant.grantId,
    now: Date.now(),
  });
  assert.equal(hidden.kind, "valid");
  assert.equal(hidden.metadata.artworkAssetId, null);
});
it("source capacity is bounded while an existing shared source remains available", async () => {
  const h = await fixture();
  process.env.MEDIA_RELAY_MAX_SOURCES = "1";
  preparing(await h.play());
  await h.t.run((ctx) =>
    ctx.db.patch(h.profileId, {
      outboundLinks: [
        {
          type: "vrcdn",
          url: "vrcdn:Alpha",
          label: "Live",
          source: "owner_authored",
        },
        {
          type: "vrcdn",
          url: "vrcdn:Beta",
          label: "Live 2",
          source: "owner_authored",
        },
      ],
    }),
  );
  assert.equal(
    AdmissionSchema.parse(
      await h.play({ ...h.context, linkId: "Beta" }, "Beta"),
    ).kind,
    "capacityLimited",
  );
  preparing(await h.play());
  const rows = await h.t.run((ctx) =>
    ctx.db.query("mediaRelaySources").collect(),
  );
  assert.equal(rows.length, 1);
});
it("future and date-only events cannot start playback, and unpublished profiles revoke grants", async () => {
  const h = await fixture();
  const grant = preparing(await h.play());
  await h.t.run((ctx) =>
    ctx.db.patch(h.eventId, {
      startAt: Date.now() + 60000,
      endAt: Date.now() + 120000,
    }),
  );
  assert.equal(
    AdmissionSchema.parse(await h.play(h.eventContext)).kind,
    "unavailable",
  );
  await h.t.run((ctx) =>
    ctx.db.patch(h.eventId, {
      scheduleKind: "date_only",
      eventDate: "2026-10-28",
    }),
  );
  assert.equal(
    AdmissionSchema.parse(await h.play(h.eventContext)).kind,
    "unavailable",
  );
  await h.t.run((ctx) =>
    ctx.db.patch(h.profileId, { publicationState: "draft_private" }),
  );
  assert.equal(
    (await h.t.query(resolve, { grantId: grant.grantId, now: Date.now() }))
      .kind,
    "denied",
  );
});
it("release returns grant capacity while keeping admission rate history", async () => {
  const h = await fixture();
  process.env.MEDIA_RELAY_MAX_GRANTS = "1";
  const grant = preparing(await h.play());
  assert.equal(AdmissionSchema.parse(await h.play()).kind, "capacityLimited");
  await h.t.mutation(release, { grantId: grant.grantId });
  preparing(await h.play());
});
it("restored public source can revalidate an unexpired grant while explicit release stays latched", async () => {
  const h = await fixture();
  const grant = preparing(await h.play());
  const original = await h.t.run((ctx) => ctx.db.get(h.profileId));
  assert.ok(original);
  await h.t.run((ctx) => ctx.db.patch(h.profileId, { outboundLinks: [] }));
  assert.equal(
    (await h.t.query(resolve, { grantId: grant.grantId, now: Date.now() }))
      .kind,
    "denied",
  );
  await h.t.run((ctx) =>
    ctx.db.patch(h.profileId, { outboundLinks: original.outboundLinks }),
  );
  assert.equal(
    (await h.t.query(resolve, { grantId: grant.grantId, now: Date.now() }))
      .kind,
    "valid",
  );
  await h.t.mutation(release, { grantId: grant.grantId });
  await h.t.run((ctx) => ctx.db.patch(h.profileId, { outboundLinks: [] }));
  await h.t.run((ctx) =>
    ctx.db.patch(h.profileId, { outboundLinks: original.outboundLinks }),
  );
  assert.equal(
    (await h.t.query(resolve, { grantId: grant.grantId, now: Date.now() }))
      .kind,
    "denied",
  );
});

it("unsupported terminal result reaches existing playback grants and only new Play clears it", async () => {
  const h = await fixture();
  const grant = preparing(await h.play());
  const allocation = {
    cpuUnits: 1024,
    memoryMiB: 2048,
    evidenceId: "test-proof-1",
  };
  process.env.MEDIA_RELAY_WORKER_TOKEN = "relay-test-credential";
  process.env.MEDIA_RELAY_WORKERS = JSON.stringify([
    {
      workerId: "one",
      workerEpoch: 1,
      allocation,
      maxSources: 2,
      draining: false,
    },
  ]);
  const call = (name: string, args: Record<string, unknown>) =>
    h.t.mutation(
      makeFunctionReference<"mutation">(`mediaRelayWorker:${name}`),
      { credential: "relay-test-credential", ...args },
    );
  await call("registerWorker", {
    observation: {
      workerId: "one",
      workerEpoch: 1,
      allocation,
      observedAt: Date.now(),
      activeJobs: 0,
      resources: null,
      jobs: [],
    },
  });
  const identity = {
    workerId: "one",
    workerEpoch: 1,
    streamKey: "vrcdn/Alpha/1",
  };
  const lease = await call("claimSource", identity);
  await call("observeSource", {
    ...identity,
    epoch: lease.epoch,
    state: "unavailable",
    progressAt: 0,
    terminalReason: "unsupported",
  });
  assert.deepEqual(await h.t.query(get, { grantId: grant.grantId }), {
    kind: "unavailable",
    reason: "unsupported",
  });
  assert.deepEqual(await h.t.query(get, { grantId: grant.grantId }), {
    kind: "unavailable",
    reason: "unsupported",
  });
  preparing(await h.play());
  const row = await h.t.run((ctx) => ctx.db.query("mediaRelaySources").first());
  assert.equal(row?.terminalReason, undefined);
  await assert.rejects(
    call("observeSource", {
      ...identity,
      epoch: lease.epoch,
      state: "unavailable",
      progressAt: 0,
      terminalReason: "unsupported",
    }),
  );
});

it("external gateway query authenticates its own scope and rechecks grant context, epoch, expiry and unsupported without mutating admission", async () => {
  const h = await fixture();
  process.env.MEDIA_RELAY_GATEWAY_TOKEN = "gateway-only-token";
  process.env.MEDIA_RELAY_WORKER_TOKEN = "worker-only-token";
  const gateway = makeFunctionReference<"query">(
    "mediaRelayWorker:readGateway",
  );
  const grantId = preparing(await h.play()).grantId;
  const args = {
    credential: "gateway-only-token",
    grantId,
    rendition: "video",
  };
  await assert.rejects(
    h.t.query(gateway, { ...args, credential: "worker-only-token" }),
  );
  const queued = await h.t.query(gateway, args);
  assert.equal(queued.kind, "active");
  assert.equal(queued.snapshot, null);
  await h.t.run(async (ctx) => {
    const row = await ctx.db.query("mediaRelaySources").first();
    assert.ok(row);
    await ctx.db.patch(row._id, {
      state: "ready",
      epoch: 3,
      leaseExpiresAt: Date.now() + 30000,
    });
  });
  const ready = await h.t.query(gateway, args);
  assert.equal(ready.epoch, 3);
  assert.ok(ready.leaseExpiresAt > Date.now());
  assert.equal(ready.snapshot, null);
  await h.t.run(async (ctx) => {
    const row = await ctx.db.query("mediaRelaySources").first();
    assert.ok(row);
    const now = Date.now();
    await ctx.db.patch(row._id, {
      leaseExpiresAt: now - 1,
      snapshots: {
        video: {
          streamKey: "vrcdn/Alpha/1",
          epoch: 3,
          rendition: "video",
          targetDurationSeconds: 2,
          sequence: 0,
          discontinuitySequence: 0,
          generatedAt: now,
          segments: [
            {
              sequence: 0,
              objectKey: "vrcdn/Alpha/1/epochs/3/attempt-1-abc/video-0.ts",
              durationSeconds: 2,
              programDateTime: now,
              discontinuity: false,
            },
          ],
        },
      },
    });
  });
  assert.equal(
    (await h.t.query(gateway, args)).snapshot,
    null,
    "expired server lease must not expose an authoritative media pointer",
  );
  const sourceId = await h.t.run(async (ctx) => {
    const source = await ctx.db.query("mediaRelaySources").first();
    assert.ok(source);
    await ctx.db.patch(source._id, {
      state: "unavailable",
      terminalReason: "unsupported",
    });
    return source._id;
  });
  assert.deepEqual(await h.t.query(gateway, args), {
    kind: "unavailable",
    reason: "unsupported",
  });
  assert.deepEqual(await h.t.query(gateway, args), {
    kind: "unavailable",
    reason: "unsupported",
  });
  await h.t.run(async (ctx) => {
    const source = await ctx.db.get(sourceId);
    assert.equal(source?.state, "unavailable");
    assert.equal(source?.admissionRevision, undefined);
    await ctx.db.patch(h.profileId, { publicationState: "draft_private" });
  });
  assert.deepEqual(await h.t.query(gateway, args), { kind: "denied" });
  await h.t.run(async (ctx) => {
    await ctx.db.patch(h.profileId, { publicationState: "published" });
    const row = await ctx.db.query("mediaRelayGrants").first();
    assert.ok(row);
    await ctx.db.patch(row._id, { expiresAt: Date.now() });
  });
  assert.deepEqual(await h.t.query(gateway, args), { kind: "denied" });
  process.env.MEDIA_RELAY_GATEWAY_TOKEN = "worker-only-token";
  await assert.rejects(
    h.t.query(gateway, { ...args, credential: "worker-only-token" }),
  );
});

it("gateway credentials cannot register workers even when misconfigured to the same token", async () => {
  const h = await fixture();
  process.env.MEDIA_RELAY_GATEWAY_TOKEN = "same-token";
  process.env.MEDIA_RELAY_WORKER_TOKEN = "same-token";
  process.env.MEDIA_RELAY_WORKERS = JSON.stringify([
    {
      workerId: "one",
      workerEpoch: 1,
      allocation: {
        cpuUnits: 1024,
        memoryMiB: 2048,
        evidenceId: "test-proof-1",
      },
      maxSources: 2,
      draining: false,
    },
  ]);
  const register = makeFunctionReference<"mutation">(
    "mediaRelayWorker:registerWorker",
  );
  await assert.rejects(
    h.t.mutation(register, {
      credential: "same-token",
      observation: {
        workerId: "one",
        workerEpoch: 1,
        observedAt: Date.now(),
        allocation: {
          cpuUnits: 1024,
          memoryMiB: 2048,
          evidenceId: "test-proof-1",
        },
        activeJobs: 0,
        resources: null,
        jobs: [],
      },
    }),
  );
});

it("refresh extends only a near-expiry authorized grant, retaining ID and source without restarting", async () => {
  const h = await fixture();
  const admitted = preparing(await h.play());
  const refresh = makeFunctionReference<"mutation">(
    "mediaRelayPlayback:refreshPlayback",
  );
  const read = () =>
    h.t.run(async (ctx) => ({
      grant: await ctx.db.query("mediaRelayGrants").first(),
      source: await ctx.db.query("mediaRelaySources").first(),
    }));
  const original = await read();
  await h.t.mutation(refresh, { grantId: admitted.grantId });
  assert.deepEqual(await read(), original);
  await h.t.run(async (ctx) => {
    assert.ok(original.grant);
    await ctx.db.patch(original.grant._id, { expiresAt: Date.now() + 1000 });
  });
  await h.t.mutation(refresh, { grantId: admitted.grantId });
  const renewed = await read();
  assert.equal(renewed.grant?.grantId, admitted.grantId);
  assert.ok(
    (renewed.grant?.expiresAt ?? 0) >
      Date.now() + RELAY_POLICY.grantLifetimeMs - 10000,
  );
  assert.deepEqual(renewed.source, original.source);
  await h.t.mutation(release, { grantId: admitted.grantId });
  assert.equal(
    AdmissionSchema.parse(
      await h.t.mutation(refresh, { grantId: admitted.grantId }),
    ).kind,
    "unavailable",
  );
});
it("refresh refuses exact expiry and revoked context but allows valid post-window event continuation", async () => {
  const h = await fixture();
  const refresh = makeFunctionReference<"mutation">(
    "mediaRelayPlayback:refreshPlayback",
  );
  const admitted = preparing(
    await h.t.mutation(open, {
      context: h.eventContext,
      streamId: "Alpha",
      preferredMode: "video",
    }),
  );
  await h.t.run(async (ctx) => {
    await ctx.db.patch(h.eventId, { endAt: Date.now() - 1 });
    const row = await ctx.db.query("mediaRelayGrants").first();
    assert.ok(row);
    await ctx.db.patch(row._id, { expiresAt: Date.now() + 1000 });
  });
  assert.equal(
    AdmissionSchema.parse(
      await h.t.mutation(refresh, { grantId: admitted.grantId }),
    ).kind,
    "preparing",
  );
  await h.t.run(async (ctx) => {
    const row = await ctx.db.query("mediaRelayGrants").first();
    assert.ok(row);
    await ctx.db.patch(row._id, { expiresAt: Date.now() });
  });
  assert.equal(
    AdmissionSchema.parse(
      await h.t.mutation(refresh, { grantId: admitted.grantId }),
    ).kind,
    "unavailable",
  );
  const profile = preparing(await h.play());
  await h.t.run(async (ctx) => {
    await ctx.db.patch(h.profileId, { publicationState: "draft_private" });
  });
  assert.equal(
    AdmissionSchema.parse(
      await h.t.mutation(refresh, { grantId: profile.grantId }),
    ).kind,
    "unavailable",
  );
});
it("refresh keeps stable rendition URLs and accepts metadata-only edits", async () => {
  const h = await fixture();
  process.env.MEDIA_RELAY_PLAYBACK_ORIGIN = "https://playback.example";
  const admitted = preparing(await h.play());
  await h.t.run(async (ctx) => {
    const source = await ctx.db.query("mediaRelaySources").first();
    assert.ok(source);
    await ctx.db.patch(source._id, { state: "ready" });
  });
  const before = AdmissionSchema.parse(
    await h.t.query(get, { grantId: admitted.grantId }),
  );
  assert.equal(before.kind, "ready");
  if (before.kind !== "ready") return;
  await h.t.run(async (ctx) => {
    await ctx.db.patch(h.profileId, { displayName: "Renamed DJ" });
    const row = await ctx.db.query("mediaRelayGrants").first();
    assert.ok(row);
    await ctx.db.patch(row._id, { expiresAt: Date.now() + 1000 });
  });
  const after = AdmissionSchema.parse(
    await h.t.mutation(
      makeFunctionReference<"mutation">("mediaRelayPlayback:refreshPlayback"),
      { grantId: admitted.grantId },
    ),
  );
  assert.equal(after.kind, "ready");
  if (after.kind !== "ready") return;
  assert.equal(after.metadata.displayName, "Renamed DJ");
  assert.equal(after.videoPlaylist, before.videoPlaylist);
  assert.equal(after.audioPlaylist, before.audioPlaylist);
  assert.equal(after.grant.contextRevision, before.grant.contextRevision);
});
