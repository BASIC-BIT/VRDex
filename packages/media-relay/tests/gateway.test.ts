import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createManifestHandler,
  createLambdaHandler,
} from "../src/gateway/handler";
import { PlaybackGrantSchema, PublishedSnapshotSchema } from "../src/contracts";
const grant = PlaybackGrantSchema.parse({
  id: "capability",
  streamKey: "vrcdn/Alpha/1",
  context: { kind: "profile", profileId: "profile", linkId: "Alpha" },
  contextRevision: 1,
  issuedAt: 1,
  expiresAt: 43200001,
  renditions: ["video", "audio"],
});
function snapshot(epoch = 1, sequence = 0) {
  return PublishedSnapshotSchema.parse({
    streamKey: grant.streamKey,
    epoch,
    rendition: "video",
    targetDurationSeconds: 2,
    sequence,
    discontinuitySequence: epoch - 1,
    generatedAt: 100000,
    segments: Array.from({length: 3}, (_, offset) => ({
        sequence: sequence + offset,
        objectKey: `vrcdn/Alpha/1/epochs/${epoch}/attempt-1-abc/video-${sequence + offset}.ts`,
        durationSeconds: 2,
        programDateTime: 100000,
        discontinuity: epoch > 1 && offset === 0,
      })),
  });
}
function fixture() {
  let now = 100000,
    reads = 0,
    demands = 0;
  let snap = snapshot();
  let auth: unknown = {
    kind: "active",
    grant,
    state: "ready",
    epoch: 1,
    leaseExpiresAt: 130000,
    snapshot: snap,
  };
  const options = {
    clock: () => now,
    origins: ["https://vrdex.com", "https://preview.vrdex.com"],
    authorize: async () => auth,
    readSnapshot: async () => {
      reads++;
      return snap;
    },
    demand: {
      recordDemand: async () => {
        demands++;
      },
    },
    signSegment: ({
      objectKey,
      expiresAt,
    }: {
      objectKey: string;
      expiresAt: number;
    }) => `https://cdn.example/${objectKey}?expires=${expiresAt}`,
  };
  const handler = createManifestHandler(options);
  const request = (
    path = "/p/capability/video/index.m3u8",
    origin = "https://vrdex.com",
  ) =>
    handler(
      new Request(`https://play.example${path}`, {
        headers: { Origin: origin },
      }),
    );
  return {
    options,
    handler,
    request,
    setNow: (value: number) => (now = value),
    setAuth: (value: unknown) => (auth = value),
    setSnapshot: (value: ReturnType<typeof snapshot>) => (snap = value),
    get reads() {
      return reads;
    },
    get demands() {
      return demands;
    },
  };
}
test("serves no-store fresh immutable manifests with five-minute URLs and exact CORS", async () => {
  const h = fixture(),
    response = await h.request();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(
    response.headers.get("access-control-allow-origin"),
    "https://vrdex.com",
  );
  assert.equal(response.headers.get("access-control-allow-credentials"), null);
  const body = await response.text();
  assert.match(body, /#EXT-X-MEDIA-SEQUENCE:0/);
  assert.match(
    body,
    /https:\/\/cdn.example\/vrcdn\/Alpha\/1\/epochs\/1\/attempt-1-abc\/video-0.ts\?expires=401000/,
  );
  assert.equal(h.demands, 1);
  assert.equal(
    (await h.request(undefined, "https://attacker.example")).status,
    403,
  );
  assert.equal(h.reads, 1);
});
test("denies revoked context, expiry, malformed authorization and terminal before media or demand", async () => {
  const h = fixture();
  await h.request();
  for (const auth of [
    { kind: "denied" },
    {
      kind: "active",
      grant: { ...grant, expiresAt: 100000 },
      state: "ready",
      epoch: 1,
      leaseExpiresAt: 130000,
      snapshot: snapshot(),
    },
    { kind: "active" },
    { kind: "unavailable", reason: "unsupported" },
  ]) {
    h.setAuth(auth);
    const response = await h.request();
    assert.notEqual(response.status, 200);
    if ("reason" in auth)
      assert.deepEqual(await response.json(), {
        kind: "unavailable",
        reason: "unsupported",
      });
  }
  assert.equal(h.reads, 1);
  assert.equal(h.demands, 1);
});
test("rejects paths and stale, foreign or decreasing snapshots; stable route follows epoch", async () => {
  const h = fixture();
  for (const path of [
    "/p/capability/other/index.m3u8",
    "/p/capability/video/other",
    "/p/capability/video/index.m3u8?token=x",
  ])
    assert.equal((await h.request(path)).status, 404);
  await h.request();
  h.setNow(110000);
  assert.equal((await h.request()).status, 503);
  h.setNow(100000);
  let next = snapshot(2, 3);
  h.setSnapshot(next);
  h.setAuth({
    kind: "active",
    grant,
    state: "ready",
    epoch: 2,
    leaseExpiresAt: 130000,
    snapshot: next,
  });
  assert.equal((await h.request()).status, 200);
  next = snapshot(2, 1);
  h.setSnapshot(next);
  h.setAuth({
    kind: "active",
    grant,
    state: "ready",
    epoch: 2,
    leaseExpiresAt: 130000,
    snapshot: next,
  });
  assert.equal((await h.request()).status, 503);
  h.setSnapshot(snapshot(1, 3));
  assert.equal((await h.request()).status, 503);
});
test("expires lease during awaited media read, bounds physically pending requests and times out without releasing capacity", async () => {
  const h = fixture();
  let unblock!: () => void;
  const blocked = new Promise<void>((r) => (unblock = r));
  const handler = createManifestHandler({
    ...h.options,
    maxConcurrent: 1,
    timeoutMs: 10,
    readSnapshot: async () => {
      await blocked;
      return snapshot();
    },
  });
  const first = handler(
    new Request("https://play.example/p/capability/video/index.m3u8"),
  );
  assert.equal((await first).status, 503);
  assert.equal(
    (
      await handler(
        new Request("https://play.example/p/capability/video/index.m3u8"),
      )
    ).status,
    503,
  );
  unblock();
  const expired = createManifestHandler({
    ...h.options,
    readSnapshot: async () => {
      h.setNow(130000);
      return snapshot();
    },
  });
  assert.equal(
    (
      await expired(
        new Request("https://play.example/p/capability/video/index.m3u8"),
      )
    ).status,
    503,
  );
});
test("Lambda boundary serves the actual native route and preflight without demand", async () => {
  const h = fixture();
  const lambda = createLambdaHandler(h.handler);
  const result = await lambda({
    version: "2.0",
    rawPath: "/p/capability/video/index.m3u8",
    rawQueryString: "",
    headers: { origin: "https://vrdex.com" },
    requestContext: { http: { method: "GET" } },
  });
  assert.equal(result.statusCode, 200);
  assert.match(result.body, /#EXTM3U/);
  const response = await h.handler(
    new Request("https://play.example/p/capability/video/index.m3u8", {
      method: "OPTIONS",
      headers: { Origin: "https://preview.vrdex.com" },
    }),
  );
  assert.equal(response.status, 204);
  assert.equal(h.demands, 1);
});

test("expired grants after a slow read and expired leases never deliver cached media", async () => {
  const h = fixture();
  h.setAuth({
    kind: "active",
    grant: { ...grant, expiresAt: 100001 },
    state: "ready",
    epoch: 1,
    leaseExpiresAt: 130000,
    snapshot: snapshot(),
  });
  const handler = createManifestHandler({
    ...h.options,
    readSnapshot: async () => {
      h.setNow(100001);
      return snapshot();
    },
  });
  assert.equal(
    (
      await handler(
        new Request("https://play.example/p/capability/video/index.m3u8"),
      )
    ).status,
    503,
  );
  h.setNow(100000);
  h.setAuth({
    kind: "active",
    grant,
    state: "ready",
    epoch: 1,
    leaseExpiresAt: 100000,
    snapshot: snapshot(),
  });
  assert.equal((await h.request()).status, 503);
  assert.equal(h.reads, 0);
});

test("malformed scoped pointer never reaches immutable storage and continuity map stays bounded", async () => {
  const h = fixture();
  h.setAuth({
    kind: "active",
    grant,
    state: "ready",
    epoch: 2,
    leaseExpiresAt: 130000,
    snapshot: snapshot(),
  });
  assert.equal((await h.request()).status, 503);
  assert.equal(h.reads, 0);
  h.setAuth({
    kind: "active",
    grant,
    state: "ready",
    epoch: 1,
    leaseExpiresAt: 130000,
    snapshot: { ...snapshot(), streamKey: "vrcdn/Beta/1" },
  });
  assert.equal((await h.request()).status, 503);
  assert.equal(h.reads, 0);
  const bounded = createManifestHandler({ ...h.options, maxSources: 1 });
  for (let i = 0; i < 3; i++) {
    const key = `vrcdn/Source${i}/1`;
    const s = {
      ...snapshot(),
      streamKey: key,
      segments: snapshot().segments.map((segment) => ({
        ...segment,
        objectKey: segment.objectKey.replace("vrcdn/Alpha/1", key),
      })),
    };
    h.setAuth({
      kind: "active",
      grant: { ...grant, streamKey: key },
      state: "ready",
      epoch: 1,
      leaseExpiresAt: 130000,
      snapshot: s,
    });
    h.setSnapshot(s);
    assert.equal(
      (
        await bounded(
          new Request("https://play.example/p/capability/video/index.m3u8"),
        )
      ).status,
      i < 2 ? 200 : 503,
    );
  }
});

test("response never serves authorization older than two seconds even before the timer callback runs", async () => {
  const h = fixture();
  const handler = createManifestHandler({
    ...h.options,
    timeoutMs: 2000,
    readSnapshot: async () => {
      h.setNow(102000);
      return snapshot();
    },
  });
  assert.equal(
    (
      await handler(
        new Request("https://play.example/p/capability/video/index.m3u8"),
      )
    ).status,
    503,
  );
});

test("premature ready does not expose a window below three target durations", async () => {
  const h = fixture();
  const partial = snapshot();
  partial.segments = partial.segments.slice(0, 1);
  h.setSnapshot(partial);
  h.setAuth({kind:"active",grant,state:"ready",epoch:1,leaseExpiresAt:130000,snapshot:partial});
  assert.equal((await h.request()).status, 503);
  assert.equal(h.demands, 1, "admitted native requests still retain startup demand");
});
