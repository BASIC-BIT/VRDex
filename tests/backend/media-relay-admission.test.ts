import assert from "node:assert/strict";
import { it } from "node:test";
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import schemaModule from "../../convex/schema";
import { AdmissionSchema, PlaybackRebindSchema, RELAY_POLICY } from "../../packages/media-relay/src";
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
  const neutral = await h.t.query(resolve, { grantId: event.grantId, now: Date.now() });
  assert.equal(neutral.kind, "valid");
  assert.deepEqual(neutral.metadata, { displayName: "Show", artworkAssetId: null, artworkRevision: null });
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

it("owner retry retains a valid post-window grant through native failure and terminal source restart", async () => {
  const { EventPlaybackOwner } =
    await import("../../apps/web/src/lib/event-playback-owner");
  const { createRelayPlaybackAdapter } =
    await import("../../apps/web/src/lib/relay-playback-adapter");
  const h = await fixture();
  process.env.MEDIA_RELAY_PLAYBACK_ORIGIN = "https://playback.example";
  let opens = 0,
    releases = 0,
    created = 0;
  let notifyNative: (state: { status: "unavailable" }) => void = () => {};
  const restart = makeFunctionReference<"mutation">(
    "mediaRelayPlayback:restartPlayback",
  );
  const request = {
    kind: "vrcdn",
    eventId: h.eventId,
    eventSlug: "show",
    title: "Show",
    href: "/show",
    startAt: Date.now() - 1000,
    sourceId: "Alpha",
    src: "https://legacy",
    transport: "mpegts",
  } as const;
  const owner = new EventPlaybackOwner((request, notify, mode) => {
    assert.equal(request.kind, "vrcdn");
    if (request.kind !== "vrcdn") throw Error("fixture");
    return createRelayPlaybackAdapter({
      request,
      notify,
      mode,
      mount: {} as HTMLElement,
      client: {
        open: async (context, streamId, preferredMode) => {
          opens++;
          const result = await h.t.mutation(open, {
            context,
            streamId,
            preferredMode,
          });
          await h.t.run(async (ctx) => {
            const source = await ctx.db.query("mediaRelaySources").first();
            assert.ok(source);
            await ctx.db.patch(source._id, { state: "ready" });
          });
          return result;
        },
        get: async (grantId) => {
          await h.t.run(async (ctx) => {
            const source = await ctx.db.query("mediaRelaySources").first();
            assert.ok(source);
            if (source.state === "queued")
              await ctx.db.patch(source._id, { state: "ready" });
          });
          return h.t.query(get, { grantId });
        },
        restart: (grantId) => h.t.mutation(restart, { grantId }),
        refresh: (grantId) =>
          h.t.mutation(
            makeFunctionReference<"mutation">(
              "mediaRelayPlayback:refreshPlayback",
            ),
            { grantId },
          ),
        release: async (grantId) => {
          releases++;
          await h.t.mutation(release, { grantId });
        },
      },
      createNative: ({ notify }) => {
        created++;
        notifyNative = notify;
        return {
          async play() {
            return true;
          },
          pause() {},
          setVolume() {},
          setMuted() {},
          update() {},
          dispose() {},
        };
      },
    });
  });
  try {
    await owner.play(request);
    assert.equal(owner.getSnapshot().status, "playing");
    const before = await h.t.run((ctx) =>
      ctx.db.query("mediaRelayGrants").collect(),
    );
    assert.equal(before.length, 1);
    await h.t.run((ctx) => ctx.db.patch(h.eventId, { endAt: Date.now() - 1 }));
    owner.update({ ...request, endAt: 1 });
    notifyNative({ status: "unavailable" });
    await owner.play({ ...request, endAt: 1 });
    assert.equal(owner.getSnapshot().status, "playing");
    assert.equal(opens, 1);
    assert.equal(releases, 0);
    assert.equal(created, 2);
    for (const state of ["stopped", "unavailable"] as const) {
      await h.t.run(async (ctx) => {
        const source = await ctx.db.query("mediaRelaySources").first();
        assert.ok(source);
        await ctx.db.patch(source._id, {
          state,
          terminalReason: state === "unavailable" ? "unavailable" : undefined,
        });
      });
      if (state === "unavailable") await owner.refresh();
      else notifyNative({ status: "unavailable" });
      assert.equal(owner.getSnapshot().status, "unavailable");
      await owner.play({ ...request, endAt: 1 });
      assert.equal(owner.getSnapshot().status, "playing");
    }
    const after = await h.t.run((ctx) =>
      ctx.db.query("mediaRelayGrants").collect(),
    );
    assert.deepEqual(after, before);
    assert.equal(opens, 1);
    assert.equal(releases, 0);
    assert.equal(created, 4);
    await h.t.run(async (ctx) => {
      await ctx.db.patch(before[0]._id, { expiresAt: Date.now() });
    });
    notifyNative({ status: "unavailable" });
    await owner.play({ ...request, endAt: 1 });
    assert.equal(owner.getSnapshot().status, "unavailable");
    assert.equal(
      opens,
      2,
      "actual expiry returns to fresh admission and its event-window gate",
    );
    assert.equal(
      (await h.t.run((ctx) => ctx.db.query("mediaRelayGrants").collect()))
        .length,
      1,
    );
  } finally {
    owner.close();
  }
});
it("explicit restart reauthorizes capabilities and refuses unsupported without changing grants or sources", async () => {
  const restart = makeFunctionReference<"mutation">(
    "mediaRelayPlayback:restartPlayback",
  );
  for (const denial of [
    "expired",
    "released",
    "revoked",
    "unsupported",
  ] as const) {
    const h = await fixture();
    const admitted = preparing(await h.play());
    await h.t.run(async (ctx) => {
      const row = await ctx.db.query("mediaRelayGrants").first();
      const source = await ctx.db.query("mediaRelaySources").first();
      assert.ok(row && source);
      await ctx.db.patch(source._id, {
        state: "unavailable",
        terminalReason:
          denial === "unsupported" ? "unsupported" : "unavailable",
      });
      if (denial === "expired")
        await ctx.db.patch(row._id, { expiresAt: Date.now() });
      if (denial === "released")
        await ctx.db.patch(row._id, { releasedAt: Date.now() });
      if (denial === "revoked")
        await ctx.db.patch(h.profileId, { publicationState: "draft_private" });
    });
    const before = await h.t.run((ctx) =>
      ctx.db.query("mediaRelaySources").collect(),
    );
    const result = AdmissionSchema.parse(
      await h.t.mutation(restart, { grantId: admitted.grantId }),
    );
    assert.equal(result.kind, "unavailable");
    if (result.kind === "unavailable")
      assert.equal(
        result.reason,
        denial === "unsupported"
          ? "unsupported"
          : denial === "expired"
            ? "expired"
            : "unavailable",
      );
    assert.deepEqual(
      await h.t.run((ctx) => ctx.db.query("mediaRelaySources").collect()),
      before,
    );
  }
});
it("shared rolling admission quota bounds concurrent restarts and fresh opens without consuming another grant slot", async () => {
  const h = await fixture();
  const admitted = preparing(await h.play());
  const restart = makeFunctionReference<"mutation">(
    "mediaRelayPlayback:restartPlayback",
  );
  process.env.MEDIA_RELAY_ADMISSIONS_PER_MINUTE = "2";
  process.env.MEDIA_RELAY_MAX_GRANTS = "1";
  const terminal = () =>
    h.t.run(async (ctx) => {
      const source = await ctx.db.query("mediaRelaySources").first();
      assert.ok(source);
      await ctx.db.patch(source._id, { state: "stopped" });
    });
  await terminal();
  const results = await Promise.all([
    h.t.mutation(restart, { grantId: admitted.grantId }),
    h.t.mutation(restart, { grantId: admitted.grantId }),
  ]);
  assert.equal(
    results.every(
      (result) => AdmissionSchema.parse(result).kind === "preparing",
    ),
    true,
  );
  const rate = await h.t.run((ctx) =>
    ctx.db.query("mediaRelayRestartRate").unique(),
  );
  assert.equal(rate?.attempts.length, 1);
  assert.equal(
    (await h.t.run((ctx) => ctx.db.query("mediaRelayGrants").collect())).length,
    1,
  );
  await terminal();
  assert.equal(
    AdmissionSchema.parse(
      await h.t.mutation(restart, { grantId: admitted.grantId }),
    ).kind,
    "capacityLimited",
  );
  process.env.MEDIA_RELAY_MAX_GRANTS = "10";
  assert.equal(AdmissionSchema.parse(await h.play()).kind, "capacityLimited");
  // Exact rolling cutoff is expired history, not a permanent counter.
  await h.t.run(async (ctx) => {
    assert.ok(rate);
    await ctx.db.patch(rate._id, { attempts: [Date.now() - 60000] });
  });
  assert.equal(
    AdmissionSchema.parse(
      await h.t.mutation(restart, { grantId: admitted.grantId }),
    ).kind,
    "preparing",
  );
  assert.equal(
    (await h.t.run((ctx) => ctx.db.query("mediaRelayRestartRate").unique()))
      ?.attempts.length,
    1,
  );
});
it("restart keeps source capacity and context-current checks while get/refresh cannot restart", async () => {
  const h = await fixture();
  const admitted = preparing(await h.play());
  const restart = makeFunctionReference<"mutation">(
    "mediaRelayPlayback:restartPlayback",
  );
  await h.t.run(async (ctx) => {
    const source = await ctx.db.query("mediaRelaySources").first();
    assert.ok(source);
    await ctx.db.patch(source._id, { state: "stopped" });
    await ctx.db.insert("mediaRelaySources", {
      streamKey: "vrcdn/Other/1",
      streamId: "Other",
      inputFormat: "vrcdn_fmp4",
      packagingVersion: 1,
      state: "ready",
      createdAt: 1,
      updatedAt: 1,
    });
  });
  process.env.MEDIA_RELAY_MAX_SOURCES = "1";
  assert.equal(
    AdmissionSchema.parse(await h.t.query(get, { grantId: admitted.grantId }))
      .kind,
    "unavailable",
  );
  assert.equal(
    AdmissionSchema.parse(
      await h.t.mutation(
        makeFunctionReference<"mutation">("mediaRelayPlayback:refreshPlayback"),
        { grantId: admitted.grantId },
      ),
    ).kind,
    "unavailable",
  );
  assert.equal(
    AdmissionSchema.parse(
      await h.t.mutation(restart, { grantId: admitted.grantId }),
    ).kind,
    "capacityLimited",
  );
  await h.t.run((ctx) => ctx.db.patch(h.profileId, { outboundLinks: [] }));
  assert.equal(
    AdmissionSchema.parse(
      await h.t.mutation(restart, { grantId: admitted.grantId }),
    ).kind,
    "unavailable",
  );
  assert.equal(
    await h.t.run((ctx) => ctx.db.query("mediaRelayRestartRate").unique()),
    null,
  );
});
it("concurrent terminal restarts for different sources share the final admission-rate slot", async () => {
  const h = await fixture();
  const first = preparing(await h.play());
  await h.t.run((ctx) =>
    ctx.db.patch(h.profileId, {
      outboundLinks: [
        {
          type: "vrcdn",
          url: "vrcdn:Alpha",
          label: "A",
          source: "owner_authored",
        },
        {
          type: "vrcdn",
          url: "vrcdn:Beta",
          label: "B",
          source: "owner_authored",
        },
      ],
    }),
  );
  const second = preparing(
    await h.play({ ...h.context, linkId: "Beta" }, "Beta"),
  );
  await h.t.run(async (ctx) => {
    for (const source of await ctx.db.query("mediaRelaySources").collect())
      await ctx.db.patch(source._id, { state: "stopped" });
  });
  process.env.MEDIA_RELAY_ADMISSIONS_PER_MINUTE = "3";
  const restart = makeFunctionReference<"mutation">(
    "mediaRelayPlayback:restartPlayback",
  );
  const results = await Promise.all(
    [first, second].map(({ grantId }) => h.t.mutation(restart, { grantId })),
  );
  assert.deepEqual(
    results.map((result) => AdmissionSchema.parse(result).kind).sort(),
    ["capacityLimited", "preparing"],
  );
  assert.equal(
    (await h.t.run((ctx) => ctx.db.query("mediaRelayRestartRate").unique()))
      ?.attempts.length,
    1,
  );
});

const rebind = makeFunctionReference<"mutation">("mediaRelayPlayback:rebindPlayback");
async function sequenceFixture() {
  const h = await fixture();
  const slots = await h.t.run(async ctx => {
    await ctx.db.patch(h.eventId, { watchMode: "performer_sequence" });
    await ctx.db.patch(h.profileId, { outboundLinks: ["Alpha", "Beta"].map(id => ({ type: "vrcdn", url: `vrcdn:${id}`, label: "Live", source: "owner_authored" })) });
    const slot = (position: number, selectedStreamId: string) => ctx.db.insert("eventSlots", { eventId: h.eventId, personProfileId: h.profileId, selectedStreamId, position, startAt: Date.now() - 1000 + position * 1000, displayLabel: "DJ", roleLabel: "DJ", sourceType: "manual", sourceLabel: "test", confidence: 1, reviewState: "confirmed", updatedAt: 1 });
    return { a: await slot(0, "Alpha"), b: await slot(1, "Beta"), same: await slot(2, "Alpha") };
  });
  const context = (selectedSourceId: string) => ({ ...h.eventContext, selectedSourceId });
  const first = preparing(await h.t.mutation(open, { context: context(slots.a), streamId: "Alpha", preferredMode: "audio" }));
  const end = () => h.t.run(ctx => ctx.db.patch(h.eventId, { endAt: Date.now() - 1 }));
  const openNext = (proof = first.grantId, eventId = h.eventId, selectedSourceId = slots.b, streamId = "Beta") => h.t.mutation(open, { context: { kind: "event", eventId, selectedSourceId }, streamId, preferredMode: "audio", continuationGrantId: proof });
  return { ...h, slots, context, first, end, openNext };
}
it("same-event postwindow continuation admits an independently authorized slot with a distinct bounded grant", async () => {
  const h = await sequenceFixture(); await h.end();
  assert.equal(AdmissionSchema.parse(await h.t.mutation(open, { context: h.context(h.slots.b), streamId: "Beta", preferredMode: "audio" })).kind, "unavailable");
  const next = preparing(await h.openNext()); assert.notEqual(next.grantId, h.first.grantId);
  const rows = await h.t.run(ctx => ctx.db.query("mediaRelayGrants").collect()); assert.equal(rows.length, 2);
  process.env.MEDIA_RELAY_MAX_GRANTS = "2";
  assert.equal(AdmissionSchema.parse(await h.openNext()).kind, "capacityLimited");
});
for (const invalid of ["expired", "released", "revoked", "profile", "other-event", "event-stream", "target-revoked"] as const) it(`continuation denies ${invalid} authority`, async () => {
  const h = await sequenceFixture();
  let proof = h.first.grantId;
  if (invalid === "profile") proof = preparing(await h.play()).grantId;
  if (invalid === "expired") await h.t.run(async ctx => { const row = await ctx.db.query("mediaRelayGrants").withIndex("by_grantId", q => q.eq("grantId", proof)).unique(); await ctx.db.patch(row!._id, { expiresAt: Date.now() }); });
  if (invalid === "released") await h.t.mutation(release, { grantId: proof });
  if (invalid === "revoked") await h.t.run(ctx => ctx.db.patch(h.slots.a, { selectedStreamId: "Beta" }));
  if (invalid === "target-revoked") await h.t.run(ctx => ctx.db.patch(h.slots.b, { selectedStreamId: "Alpha" }));
  if (invalid === "event-stream") await h.t.run(ctx => ctx.db.patch(h.eventId, { watchMode: "event_stream" }));
  await h.end();
  const eventId = invalid === "other-event" ? await h.t.run(async ctx => { const e = await ctx.db.get(h.eventId); const { _id, _creationTime, ...fields } = e!; return ctx.db.insert("events", { ...fields, slug: "other" }); }) : h.eventId;
  assert.equal(AdmissionSchema.parse(await h.openNext(proof, eventId)).kind, "unavailable");
});
it("same-stream postwindow identity rebind retains capability, source and URL with CAS", async () => {
  const h = await sequenceFixture(); process.env.MEDIA_RELAY_PLAYBACK_ORIGIN = "https://media.example";
  await h.t.run(async ctx => { const source = await ctx.db.query("mediaRelaySources").withIndex("by_streamKey", q => q.eq("streamKey", "vrcdn/Alpha/1")).unique(); await ctx.db.patch(source!._id, { state: "ready" }); });
  const before = AdmissionSchema.parse(await h.t.query(get, { grantId: h.first.grantId })); assert.equal(before.kind, "ready"); if (before.kind !== "ready") return;
  await h.end();
  const args = { grantId: before.grant.id, selectedSourceId: h.slots.same, expectedSelectedSourceId: h.slots.a, expectedContextRevision: before.grant.contextRevision };
  const after = PlaybackRebindSchema.parse(await h.t.mutation(rebind, args)); assert.equal(after.kind, "rebound"); if (after.kind !== "rebound") return;
  assert.equal(after.grant.id, before.grant.id); assert.equal(after.grant.issuedAt, before.grant.issuedAt); assert.equal(after.grant.expiresAt, before.grant.expiresAt); const playback = AdmissionSchema.parse(await h.t.query(get, { grantId: after.grant.id })); assert.equal(playback.kind, "ready"); if (playback.kind === "ready") assert.equal(playback.videoPlaylist, before.videoPlaylist);
  assert.deepEqual(after.grant.context, h.context(h.slots.same));
  assert.equal(PlaybackRebindSchema.parse(await h.t.mutation(rebind, { ...args, selectedSourceId: h.slots.a })).kind, "denied", "stale old-context write must fail");
  assert.equal((await h.t.run(ctx => ctx.db.query("mediaRelayGrants").collect())).length, 1);
  assert.equal((await h.t.run(ctx => ctx.db.query("mediaRelaySources").collect())).length, 1);
});
for (const invalid of ["different-stream", "revoked", "released", "expired", "profile", "stale-revision"] as const) it(`identity rebind denies ${invalid}`, async () => {
  const h = await sequenceFixture();
  let grantId = h.first.grantId;
  if (invalid === "profile") grantId = preparing(await h.play()).grantId;
  const row = await h.t.run(ctx => ctx.db.query("mediaRelayGrants").withIndex("by_grantId", q => q.eq("grantId", grantId)).unique());
  if (invalid === "revoked") await h.t.run(ctx => ctx.db.patch(h.slots.a, { selectedStreamId: "Beta" }));
  if (invalid === "released") await h.t.mutation(release, { grantId });
  if (invalid === "expired") await h.t.run(ctx => ctx.db.patch(row!._id, { expiresAt: Date.now() }));
  await h.end();
  assert.equal(PlaybackRebindSchema.parse(await h.t.mutation(rebind, { grantId, selectedSourceId: invalid === "different-stream" ? h.slots.b : h.slots.same, expectedSelectedSourceId: h.slots.a, expectedContextRevision: row!.contextRevision + (invalid === "stale-revision" ? 1 : 0) })).kind, "denied");
});
it("identity-only rebind never asserts source readiness or queues an unavailable source", async () => {
  const h = await sequenceFixture();
  const before = await h.t.run(async ctx => {
    const grant = await ctx.db.query("mediaRelayGrants").withIndex("by_grantId", q => q.eq("grantId", h.first.grantId)).unique();
    const source = await ctx.db.query("mediaRelaySources").withIndex("by_streamKey", q => q.eq("streamKey", "vrcdn/Alpha/1")).unique();
    await ctx.db.patch(source!._id, { state: "unavailable" }); return { grant, sourceId: source!._id };
  });
  await h.end();
  const rebound = PlaybackRebindSchema.parse(await h.t.mutation(rebind, { grantId: h.first.grantId, selectedSourceId: h.slots.same, expectedSelectedSourceId: h.slots.a, expectedContextRevision: before.grant!.contextRevision }));
  assert.equal(rebound.kind, "rebound");
  assert.equal((await h.t.run(ctx => ctx.db.get(before.sourceId)))?.state, "unavailable");
  assert.equal(AdmissionSchema.parse(await h.t.query(get, { grantId: h.first.grantId })).kind, "unavailable");
});
it("continuation preserves ordinary rolling admission and source-capacity quotas", async () => {
  const h = await sequenceFixture(); await h.end();
  process.env.MEDIA_RELAY_ADMISSIONS_PER_MINUTE = "1";
  assert.equal(AdmissionSchema.parse(await h.openNext()).kind, "capacityLimited");
  process.env.MEDIA_RELAY_ADMISSIONS_PER_MINUTE = "100"; process.env.MEDIA_RELAY_MAX_SOURCES = "1";
  assert.equal(AdmissionSchema.parse(await h.openNext()).kind, "capacityLimited");
  assert.equal((await h.t.run(ctx => ctx.db.query("mediaRelayGrants").collect())).length, 1);
});

it("native manual postwindow selection presents an unreleased real continuation grant before old proof release", async () => {
  const { createNativeLineupAdapter } = await import("../../apps/web/src/lib/native-lineup-adapter");
  const { mock } = await import("node:test");
  const h = await sequenceFixture();
  process.env.MEDIA_RELAY_PLAYBACK_ORIGIN = "https://media.example";
  await h.t.mutation(release, { grantId: h.first.grantId });
  await h.t.run(async ctx => {
    const alpha = await ctx.db.query("mediaRelaySources").withIndex("by_streamKey", q => q.eq("streamKey", "vrcdn/Alpha/1")).unique();
    await ctx.db.patch(alpha!._id, { state: "ready" });
    await ctx.db.insert("mediaRelaySources", { streamKey: "vrcdn/Beta/1", streamId: "Beta", inputFormat: "vrcdn_fmp4", packagingVersion: 1, state: "ready", createdAt: Date.now(), updatedAt: Date.now() });
  });
  class Media extends EventTarget {
    paused = true; muted = false; hidden = false; volume = 1; src = ""; currentTime = 1; readyState = 3; ended = false;
    canPlayType() { return "probably"; }
    async play() { this.paused = false; }
    pause() { this.paused = true; }
    removeAttribute() { this.src = ""; }
    load() {} remove() {}
  }
  const before = globalThis.document;
  const nodes: Media[] = [], grantIds: string[] = [];
  const releasing: Promise<unknown>[] = [];
  let finish!: () => void, entered!: () => void, admitted!: () => void;
  const pending = new Promise<void>(resolve => { finish = resolve; });
  const targetEntered = new Promise<void>(resolve => { entered = resolve; });
  const targetAdmitted = new Promise<void>(resolve => { admitted = resolve; });
  let proof: string | undefined;
  let adapter: ReturnType<typeof createNativeLineupAdapter> | undefined;
  try {
    Object.defineProperty(globalThis, "document", { configurable: true, value: { visibilityState: "visible", addEventListener() {}, removeEventListener() {}, createElement() { const node = new Media(); nodes.push(node); return node; } } });
    mock.method(globalThis, "setInterval", () => 1); mock.method(globalThis, "clearInterval", () => {});
    const now = Date.now();
    const stream = (streamId: string) => ({ streamId, pcUrl: `vrcdn:${streamId}`, questUrl: `vrcdn:${streamId}` });
    adapter = createNativeLineupAdapter({ request: { kind: "performer_sequence", eventId: h.eventId, eventSlug: "show", href: "/events/show", title: "Show", startAt: now - 1000, endAt: now + 60000,
      event: { title: "Show", startAt: now - 1000, endAt: now + 60000, slots: [{ key: h.slots.a, startAt: now - 1000, endAt: now + 3600000, stream: stream("Alpha") }, { key: h.slots.b, startAt: now + 3600000, stream: stream("Beta") }] } }, mount: { append() {} } as unknown as HTMLElement, mode: "audio", notify() {}, client: {
      async open(context, streamId, preferredMode, continuationGrantId) {
        const target = context.kind === "event" && context.selectedSourceId === h.slots.b;
        if (target) { proof = continuationGrantId; entered(); await pending; }
        const result = AdmissionSchema.parse(await h.t.mutation(open, { context, streamId, preferredMode, ...(continuationGrantId ? { continuationGrantId } : {}) }));
        if (result.kind === "ready") grantIds.push(result.grant.id);
        if (target) admitted(); return result;
      }, get: grantId => h.t.query(get, { grantId }), refresh: grantId => h.t.mutation(makeFunctionReference<"mutation">("mediaRelayPlayback:refreshPlayback"), { grantId }), restart: grantId => h.t.mutation(makeFunctionReference<"mutation">("mediaRelayPlayback:restartPlayback"), { grantId }),
      release(grantId) { const result = h.t.mutation(release, { grantId }); releasing.push(result); return result; },
    } });
    await adapter.play();
    for (let n = 0; n < 20 && !adapter.media; n++) await new Promise<void>(resolve => setImmediate(resolve));
    assert.ok(adapter.media); assert.equal(grantIds.length, 1);
    await h.end(); adapter.manual!(h.slots.b); await targetEntered;
    assert.equal(proof, grantIds[0]); assert.equal(nodes[1].paused, true);
    assert.equal((await h.t.query(resolve, { grantId: proof, now: Date.now() })).kind, "valid");
    finish(); await targetAdmitted;
    for (let n = 0; n < 20 && (!adapter.media || adapter.media.paused); n++) await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(grantIds.length, 2, "real backend admitted the target after calendar end"); assert.notEqual(grantIds[0], grantIds[1]); assert.equal(adapter.media?.paused, false);
    await Promise.all(releasing);
    assert.equal((await h.t.query(resolve, { grantId: grantIds[0], now: Date.now() })).kind, "denied");
    assert.equal((await h.t.query(resolve, { grantId: grantIds[1], now: Date.now() })).kind, "valid");
    adapter.dispose(); await Promise.all(releasing);
    assert.equal((await h.t.query(resolve, { grantId: grantIds[1], now: Date.now() })).kind, "denied");
  } finally { finish?.(); adapter?.dispose(); await Promise.all(releasing); mock.restoreAll(); Object.defineProperty(globalThis, "document", { configurable: true, value: before }); }
});
