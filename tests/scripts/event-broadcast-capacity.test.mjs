import assert from "node:assert/strict";
import test from "node:test";
import {
  VIDEO_PROFILES,
  resolveDestinationProfile,
} from "../../workers/restream/broadcast-profiles.mjs";
import {
  createCapacityResolver,
  resolveWorkerAllocation,
} from "../../workers/restream/broadcast-capacity.mjs";
import {
  validateAllocationSnapshot,
  validateTaskMetadata,
} from "../../workers/restream/worker-allocation.mjs";
import { taskDefinitionFor } from "../../scripts/event-media-ecs-bridge.mjs";
const allocation = {
  cpuUnits: 4096,
  memoryMiB: 8192,
  evidenceId: "fixture-capacity-v1",
};
const fixture = Object.fromEntries(
  Object.keys(VIDEO_PROFILES).flatMap((p) =>
    [false, true].map((s) => [`${p}:${s}`, allocation]),
  ),
);
const resolve = createCapacityResolver(fixture);
function snapshot(videoPreset = "1080p60", simulcastEnabled = true) {
  const mediaSettings = { videoPreset, audioBitrateKbps: 320 };
  return {
    mediaSettings,
    allocation,
    outputId: "primary",
    destinationProfiles: ["vrcdn", ...(simulcastEnabled ? ["twitch"] : [])].map(
      (destination) => ({
        outputId: destination === "vrcdn" ? "primary" : "optional",
        destination,
        profile: resolveDestinationProfile({
          settings: mediaSettings,
          destination,
        }),
      }),
    ),
  };
}
for (const p of Object.keys(VIDEO_PROFILES))
  for (const s of [false, true])
    test(`proved ${p}/${s} exact task and container allocation`, () => {
      const session = { sessionId: "session", ...snapshot(p, s) };
      const config = {
        baseEnvironment: {},
        secretRefMap: {},
        familyPrefix: "test",
        containerName: "worker",
      };
      const d = taskDefinitionFor(
        { session, program: { programId: "program" } },
        config,
        resolve,
      );
      assert.equal(d.cpu, "4096");
      assert.equal(d.memory, "8192");
      assert.equal(d.containerDefinitions[0].cpu, 4096);
      assert.equal(d.containerDefinitions[0].memory, 8192);
      const env = Object.fromEntries(
        d.containerDefinitions[0].environment.map((e) => [e.name, e.value]),
      );
      assert.deepEqual(
        JSON.parse(env.VRDEX_EVENT_MEDIA_ALLOCATION_SNAPSHOT_JSON),
        validateAllocationSnapshot(session),
      );
    });
test("production is unavailable until independently measured evidence lands", () => {
  assert.throws(
    () =>
      resolveWorkerAllocation({
        videoPreset: "720p30",
        simulcastEnabled: false,
      }),
    /unproved/i,
  );
});
test("strict measured map and profile validation", () => {
  for (const input of [
    { videoPreset: "bogus", simulcastEnabled: false },
    { videoPreset: "720p30", simulcastEnabled: 0 },
    { videoPreset: "720p30", simulcastEnabled: false, cpuUnits: 8192 },
  ])
    assert.throws(() => resolve(input));
  for (const bad of [
    { ...allocation, cpuUnits: 3000 },
    { ...allocation, memoryMiB: 1 },
    { ...allocation, evidenceId: "" },
    { ...allocation, foo: 1 },
  ])
    assert.throws(() =>
      createCapacityResolver({ "720p30:false": bad })({
        videoPreset: "720p30",
        simulcastEnabled: false,
      }),
    );
  const s = structuredClone(snapshot());
  s.destinationProfiles[1].profile.audioBitrateKbps = 320;
  assert.throws(() => validateAllocationSnapshot(s));
  const forged = snapshot();
  forged.allocation = { ...allocation, evidenceId: "forged" };
  assert.throws(() =>
    taskDefinitionFor(
      { session: forged, program: {} },
      { baseEnvironment: {}, secretRefMap: {} },
      resolve,
    ),
  );
});
test("metadata compares real task vCPU/GiB and container CPU units/MiB independently", () => {
  const s = validateAllocationSnapshot(snapshot());
  const task = {
    TaskARN: "arn:aws:ecs:us-east-1:123456789012:task/cluster/abc",
    Limits: { CPU: 4, Memory: 8192 },
    Containers: [
      {
        Name: "worker",
        DockerId: "docker-id",
        Limits: { CPU: 4096, Memory: 8192 },
      },
    ],
  };
  const container = {
    Name: "worker",
    DockerId: "docker-id",
    Limits: { CPU: 4096, Memory: 8192 },
  };
  assert.deepEqual(validateTaskMetadata(s, { task, container }), allocation);
  for (const update of [
    (t) => (t.Limits.CPU = 8),
    (t) => (t.Limits.Memory = 4096),
    (t) => (t.Containers[0].Limits.CPU = 1024),
    (t) => (t.Containers[0].DockerId = "other"),
  ]) {
    const bad = structuredClone(task);
    update(bad);
    assert.throws(() => validateTaskMetadata(s, { task: bad, container }));
  }
});

import {
  parseCapacityArguments,
  validateCapacityReceipt,
  validateOutputFacts,
} from "../../scripts/event-capacity-contracts.mjs";
const args = [
  "--preset",
  "1080p60",
  "--cpu",
  "4096",
  "--memory",
  "8192",
  "--duration-seconds",
  "300",
  "--simulcast",
  "true",
  "--output-dir",
  "/tmp/event-capacity-test",
];
test("benchmark arguments have no production authority or arbitrary shape/URL", () => {
  assert.equal(parseCapacityArguments(args).durationSeconds, 300);
  for (const bad of [
    [...args, "--cpu", "8192"],
    [...args, "--endpoint", "https://example.test"],
    args.map((v) => (v === "4096" ? "3000" : v)),
    args.map((v) => (v === "true" ? "1" : v)),
  ])
    assert.throws(() => parseCapacityArguments(bad));
});
function receipt() {
  const request = parseCapacityArguments(args);
  return {
    schemaVersion: 1,
    terminal: true,
    request,
    cleanup: { closed: true, liveChildren: 0, liveGroups: 0 },
    steady: {
      durationMs: 300000,
      dualDecodeMs: 300000,
      readinessLosses: 0,
      samples: 300,
      maxSampleGapMs: 1100,
    },
    resources: {
      cpuP95Percent: 70,
      sampleCoverageMs: 300000,
      memoryPeakBytes: 1000000,
    },
    maxCompressedBufferBytes: 3000000,
    maxDecoders: 2,
    maxAcquisitions: 2,
    artifacts: [{ sha256: "a".repeat(64), bytes: 1, complete: true }],
    outputs: ["vrcdn", "twitch"].map((destination) => ({
      destination,
      videoCodec: "h264",
      width: 1920,
      height: 1080,
      fps: 60,
      pixelFormat: "yuv420p",
      audioCodec: "aac",
      channels: 2,
      sampleRate: 48000,
      audioKbps: destination === "vrcdn" ? 320 : 160,
      maxGop: destination === "vrcdn" ? 1 : 2,
      maxGap: 0.03,
      monotonic: true,
      identities: ["a", "b", "slate"],
      avDriftMs: 20,
      visualPsnrDb: 35,
      markerCount: 5,
      internalDelayMs: 100,
    })),
  };
}
test("accepts only complete terminal measured contracts", () =>
  assert.equal(validateCapacityReceipt(receipt()).terminal, true));
for (const [name, mutate] of Object.entries({
  standbyDrop: (r) => r.steady.readinessLosses++,
  missingInterval: (r) => r.steady.dualDecodeMs--,
  incompleteSamples: (r) => r.steady.samples--,
  cpuAtLimit: (r) => (r.resources.cpuP95Percent = 80),
  missingCpu: (r) => delete r.resources.cpuP95Percent,
  orphan: (r) => r.cleanup.liveGroups++,
  noTerminal: (r) => delete r.terminal,
  missingMedia: (r) => (r.artifacts[0].complete = false),
  wrongSource: (r) => (r.outputs[0].identities = ["a", "a", "slate"]),
  wrongFps: (r) => (r.outputs[0].fps = 30),
  wrongAudio: (r) => (r.outputs[1].audioKbps = 320),
  wrongGop: (r) => (r.outputs[0].maxGop = 2),
  drift: (r) => (r.outputs[0].avDriftMs = 200),
  poorQuality: (r) => (r.outputs[0].visualPsnrDb = 15),
  delay: (r) => (r.outputs[0].internalDelayMs = 2000),
}))
  test(`rejects ${name} evidence`, () => {
    const r = receipt();
    mutate(r);
    assert.throws(() => validateCapacityReceipt(r));
  });

import {
  createManagedAllocationValidator,
  readTaskMetadata,
} from "../../workers/restream/task-metadata.mjs";
import {
  createProcessOwner,
  processTable,
} from "../../scripts/event-proof-processes.mjs";
import { createEcsSdkRunner } from "../../scripts/event-media-ecs-sdk.mjs";
test("CLI and SDK registration preserve the complete immutable definition", async () => {
  const session = { sessionId: "session", ...snapshot() };
  const d = taskDefinitionFor(
    { session, program: {} },
    { baseEnvironment: {}, secretRefMap: {} },
    resolve,
  );
  const runner = createEcsSdkRunner({
    client: { send: async (command) => command.input },
    commands: {
      RegisterTaskDefinitionCommand: class {
        constructor(input) {
          this.input = input;
        }
      },
    },
  });
  assert.deepEqual(
    await runner({}, [
      "ecs",
      "register-task-definition",
      "--cli-input-json",
      JSON.stringify(d),
    ]),
    JSON.parse(JSON.stringify(d)),
  );
});
test("managed startup rejects missing, changed, or forged settings before publication", () => {
  const expected = validateAllocationSnapshot(snapshot());
  const container = {
    Name: "worker",
    DockerId: "id",
    Limits: { CPU: 4096, Memory: 8192 },
  };
  const metadata = {
    task: {
      TaskARN: "arn:aws:ecs:us-east-1:123456789012:task/c/id",
      Limits: { CPU: 4, Memory: 8192 },
      Containers: [container],
    },
    container,
  };
  const check = createManagedAllocationValidator({ expected, metadata });
  assert.deepEqual(check(expected), allocation);
  for (const change of [
    (s) => delete s.allocation,
    (s) => (s.allocation.evidenceId = "forged-evidence"),
    (s) => (s.mediaSettings.audioBitrateKbps = 160),
    (s) => s.destinationProfiles.pop(),
  ]) {
    const s = structuredClone(expected);
    change(s);
    assert.throws(() => check(s));
  }
});
test("metadata reader pins link-local agent and rejects redirects/oversized response", async () => {
  for (const uri of [
    "http://localhost/v4/id",
    "https://169.254.170.2/v4/id",
    "http://169.254.170.2/v4/id?x=1",
  ])
    await assert.rejects(
      readTaskMetadata({
        uri,
        fetchImpl: () => {
          throw Error("must not fetch");
        },
      }),
    );
  let calls = 0;
  await assert.rejects(
    readTaskMetadata({
      uri: "http://169.254.170.2/v4/id",
      fetchImpl: async (_url, options) => {
        calls++;
        assert.equal(options.redirect, "error");
        return new Response("x".repeat(65537));
      },
    }),
  );
  assert.equal(calls, 2);
});
test("proof cleanup kills TERM-ignoring descendants and proves group closure", async () => {
  const owner = createProcessOwner();
  const child = owner.start(
    process.execPath,
    [
      "-e",
      "process.on('SIGTERM',()=>{});require('node:child_process').spawn(process.execPath,['-e',\"process.on('SIGTERM',()=>{});setInterval(()=>{},1000)\"],{stdio:'ignore'});setInterval(()=>{},1000)",
    ],
    { stdio: "ignore" },
  );
  await new Promise((r) => setTimeout(r, 200));
  const cleanup = await owner.close();
  assert(cleanup.closed);
  assert.equal(
    (await processTable()).filter((r) => r.live && r.group === child.pid)
      .length,
    0,
  );
});

for (const section of ["steady", "resources"])
  for (const key of section === "steady"
    ? [
        "durationMs",
        "dualDecodeMs",
        "samples",
        "maxSampleGapMs",
        "readinessLosses",
      ]
    : ["cpuP95Percent", "sampleCoverageMs", "memoryPeakBytes"])
    for (const invalid of [undefined, NaN, -1])
      test(`strict mandatory ${section}.${key} rejects ${invalid}`, () => {
        const r = receipt();
        r[section][key] = invalid;
        assert.throws(() => validateCapacityReceipt(r));
      });
for (const invalid of [undefined, NaN, -1, 0])
  test(`strict positive observed compressed bound rejects ${invalid}`, () => {
    const r = receipt();
    r.maxCompressedBufferBytes = invalid;
    assert.throws(() => validateCapacityReceipt(r));
  });

import { readFile } from 'node:fs/promises';
test('explicit image manifest closes every relative runtime/proof import and excludes admission map',async()=>{
 const paths=JSON.parse(await readFile('workers/restream/packaging-manifest.json','utf8'));assert.equal(new Set(paths).size,paths.length);assert(!paths.includes('workers/restream/broadcast-capacity.mjs'));
 for(const path of paths.filter(p=>p.endsWith('.mjs'))){const text=await readFile(path,'utf8');for(const match of text.matchAll(/(?:from\s*|import\(\s*)['"](\.[^'"]+\.mjs)['"]/g)){const target=new URL(match[1],new URL(path,new URL('../../',import.meta.url))).pathname;const relative=target.slice(new URL('../../',import.meta.url).pathname.length);assert(paths.includes(relative),`${path} imports missing ${relative}`);}}
});
