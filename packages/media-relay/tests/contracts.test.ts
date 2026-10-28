import assert from "node:assert/strict";
import test from "node:test";
import {
  AdmissionSchema,
  PlaybackModeSchema,
  SourceDescriptorSchema,
  RenditionSnapshotSchema,
  OwnershipLeaseSchema,
  PlaybackGrantSchema,
  WorkerObservationSchema,
  DjMetadataSchema,
  SegmentSchema,
  PublicContextSchema,
  streamKeyFor,
  parseSourceDescriptor,
  isSnapshotFresh,
  RELAY_POLICY,
} from "../src/index.ts";

const key = "vrcdn/BasicBit/1";
const source = {
  streamKey: key,
  streamId: "BasicBit",
  inputFormat: "vrcdn_fmp4",
  packagingVersion: 1,
};
const snapshot = {
  streamKey: key,
  epoch: 1,
  rendition: "video",
  targetDurationSeconds: 4,
  sequence: 0,
  discontinuitySequence: 0,
  generatedAt: 1000,
  segments: [],
};

test("trusted references share identity without folding provider case", () => {
  for (const reference of [
    "BasicBit",
    "vrcdn:BasicBit",
    "https://stream.vrcdn.live/live/BasicBit.live.mp4",
    "https://stream.vrcdn.live/live/BasicBit.live.ts",
  ])
    assert.equal(streamKeyFor(reference), key);
  assert.notEqual(streamKeyFor("basicbit"), key);
  for (const bad of [
    "",
    "a",
    "../xx",
    "https://evil.test/live/BasicBit.live.ts",
    "api",
    "x".repeat(129),
  ])
    assert.throws(() => streamKeyFor(bad));
});
test("admission source rejects URLs, mismatched identity and unknown fields", () => {
  assert.deepEqual(parseSourceDescriptor(source), source);
  for (const bad of [
    { ...source, url: "https://stream.vrcdn.live/live/BasicBit.live.mp4" },
    { ...source, streamId: "https://stream.vrcdn.live/live/BasicBit.live.mp4" },
    { ...source, streamKey: "vrcdn/other/1" },
    { ...source, packagingVersion: 2 },
    { ...source, inputFormat: "mpegts" },
  ])
    assert.equal(SourceDescriptorSchema.safeParse(bad).success, false);
  assert.equal(PlaybackModeSchema.safeParse("automatic").success, false);
});
test("snapshot freshness expires at max floor or three actual target durations", () => {
  const parsed = RenditionSnapshotSchema.parse(snapshot);
  assert.equal(isSnapshotFresh(parsed, 12999), true);
  assert.equal(isSnapshotFresh(parsed, 13000), false);
  const short = RenditionSnapshotSchema.parse({
    ...snapshot,
    targetDurationSeconds: 2,
  });
  assert.equal(isSnapshotFresh(short, 10999), true);
  assert.equal(isSnapshotFresh(short, 11000), false);
  assert.equal(isSnapshotFresh(parsed, 999), false);
  assert.equal(isSnapshotFresh(parsed, Infinity), false);
});
test("protocol objects are strict and validate numeric boundaries", () => {
  const samples = [
    [
      DjMetadataSchema,
      { displayName: "DJ", artworkAssetId: null, artworkRevision: null },
    ],
    [
      PublicContextSchema,
      { kind: "profile", profileId: "profile_1", linkId: "link_1" },
    ],
    [
      SegmentSchema,
      {
        sequence: 0,
        objectKey: "objects/segment.m4s",
        durationSeconds: 2,
        programDateTime: 1000,
        discontinuity: false,
      },
    ],
    [
      OwnershipLeaseSchema,
      {
        streamKey: key,
        workerId: "worker_1",
        epoch: 1,
        serverNow: 1000,
        expiresAt: 31000,
        renewAfterMs: 10000,
      },
    ],
    [
      PlaybackGrantSchema,
      {
        id: "grant_1",
        streamKey: key,
        context: {
          kind: "event",
          eventId: "event_1",
          selectedSourceId: "source_1",
        },
        contextRevision: 1,
        issuedAt: 1000,
        expiresAt: 2000,
        renditions: ["video", "audio"],
      },
    ],
    [RenditionSnapshotSchema, snapshot],
    [
      WorkerObservationSchema,
      {
        workerId: "worker_1",
        workerEpoch: 1,
        observedAt: 1000,
        allocation: {
          cpuUnits: 1024,
          memoryMiB: 2048,
          evidenceId: "evidence_1",
        },
        activeJobs: 0,
        resources: { sampleSequence: 0, windowMs: 0, sampleAgeMs: 0 },
        jobs: [],
      },
    ],
    [
      AdmissionSchema,
      { kind: "preparing", grantId: "grant_1", retryAfterMs: 1000 },
    ],
  ] as const;
  for (const [schema, value] of samples) {
    assert.equal(schema.safeParse(value).success, true);
    assert.equal(schema.safeParse({ ...value, unknown: true }).success, false);
  }
  for (const time of [NaN, Infinity, -Infinity, -1])
    assert.equal(
      RenditionSnapshotSchema.safeParse({ ...snapshot, generatedAt: time })
        .success,
      false,
    );
  assert.equal(
    AdmissionSchema.safeParse({ kind: "preparing", retryAfterMs: 1000 })
      .success,
    false,
  );
  assert.equal(AdmissionSchema.safeParse({ kind: "unknown" }).success, false);
  assert.equal(
    OwnershipLeaseSchema.safeParse({
      streamKey: key,
      workerId: "../bad",
      epoch: 1,
      serverNow: 0,
      expiresAt: 1,
      renewAfterMs: 1,
    }).success,
    false,
  );
});
test("shared policy pins approved runtime budgets", () => {
  assert.deepEqual(RELAY_POLICY, {
    objectRetentionMs: 600000,
    idleGraceMs: 180000,
    sourceRecoveryBudgetMs: 30000,
    grantLifetimeMs: 43200000,
    segmentUrlValidityMs: 300000,
    freshnessFloorMs: 10000,
    freshnessTargetMultiplier: 3,
    targetSegmentDurationSeconds: 2,
    leaseDurationMs: 30000,
    leaseRenewIntervalMs: 10000,
    localWatchdogIntervalMs: 250,
    rollingWindowSegments: 8,
  });
});

test("worker registration permits unknown resources and enforces nested boundaries", () => {
  const worker = {
    workerId: "worker_1",
    workerEpoch: 1,
    observedAt: 1000,
    allocation: { cpuUnits: 1024, memoryMiB: 2048, evidenceId: "evidence_1" },
    activeJobs: 1,
    resources: null,
    jobs: [
      {
        streamKey: key,
        sourceEpoch: 1,
        state: "unavailable",
        progressAt: 1000,
      },
    ],
  };
  assert.equal(WorkerObservationSchema.safeParse(worker).success, true);
  for (const resources of [
    {
      sampleSequence: 0,
      windowMs: 0,
      sampleAgeMs: 0,
      cpuUsagePercent: Infinity,
    },
    { sampleSequence: 0, windowMs: 0, sampleAgeMs: 0, memoryUsedBytes: -1 },
    { sampleSequence: 0, windowMs: 0, sampleAgeMs: 0, unknown: true },
  ])
    assert.equal(
      WorkerObservationSchema.safeParse({ ...worker, resources }).success,
      false,
    );
  assert.equal(
    WorkerObservationSchema.safeParse({
      ...worker,
      jobs: [{ ...worker.jobs[0], unknown: true }],
    }).success,
    false,
  );
});
