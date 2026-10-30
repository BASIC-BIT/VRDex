import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";
import { withTimelineFixtureLease } from "../../apps/web/e2e/home-timeline-lease";

it("persists exact nonsecret ownership before interruption and blocks recovery bypass", async () => {
  const backend = `http://127.0.0.1:${20000 + Math.floor(Math.random() * 30000)}`;
  const directory = await mkdtemp(join(tmpdir(), "timeline-manifest-"));
  const key = createHash("sha256").update(backend).digest("hex");
  const leasePath = join(tmpdir(), `vrdex-home-timeline-${key}.lock`);
  const path = join(directory, `${key}.json`);
  const runId = `playwright-timeline-${randomUUID()}`;
  try {
    const child = spawn(process.execPath, ["--import", "tsx", "--eval", `
      const { withTimelineFixtureLease } = require('./apps/web/e2e/home-timeline-lease.ts');
      withTimelineFixtureLease(${JSON.stringify(backend)}, async (_block, manifest) => {
        await manifest.recordCreated({ eventIds: ['event-1'], profileIds: ['profile-1'], slotIds: ['slot-1'], lineupEntryIds: ['entry-1'] }, { events: 1, profiles: 1, slots: 1, lineupEntries: 1 });
        process.exit(23);
      }, { runId: ${JSON.stringify(runId)}, manifestDirectory: ${JSON.stringify(directory)} });
    `], { stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stderr.on("data", chunk => { output += String(chunk); });
    assert.deepEqual(await once(child, "exit"), [23, null], output);
    const value = JSON.parse(await readFile(path, "utf8"));
    assert.equal(value.runId, runId);
    assert.equal(value.backendOrigin, backend);
    assert.deepEqual(value.ownedIds, { eventIds: ["event-1"], profileIds: ["profile-1"], slotIds: ["slot-1"], lineupEntryIds: ["entry-1"] });
    assert.deepEqual(value.expectedCounts, { events: 1, profiles: 1, slots: 1, lineupEntries: 1 });
    assert.equal(Object.keys(value).some(key => /token|secret|credential/i.test(key)), false);
    // Even loss of the temporary lock cannot erase unresolved durable ownership.
    await rm(leasePath);
    await assert.rejects(withTimelineFixtureLease(backend, async () => assert.fail("unresolved manifest bypassed"), { timeoutMs: 50, manifestDirectory: directory }), /manifest.*recover/i);
    assert.equal(await readFile(path, "utf8").then(Boolean), true);
  } finally {
    await Promise.all([rm(directory, { recursive: true, force: true }), rm(leasePath, { force: true })]);
  }
});

it("retains uncertain ownership and removes the manifest only after verified cleanup", async () => {
  const backend = `http://127.0.0.1:${20000 + Math.floor(Math.random() * 30000)}`;
  const directory = await mkdtemp(join(tmpdir(), "timeline-manifest-"));
  const key = createHash("sha256").update(backend).digest("hex");
  const path = join(directory, `${key}.json`);
  try {
    await withTimelineFixtureLease(backend, async (_block, manifest) => {
      await manifest.recordCreated({ eventIds: ["event-1"], profileIds: [], slotIds: [], lineupEntryIds: [] }, { events: 1, profiles: 0, slots: 0 });
      assert.ok(await readFile(path, "utf8"));
      await manifest.markClean();
    }, { runId: "playwright-timeline-cleaned1", manifestDirectory: directory });
    await assert.rejects(readFile(path), { code: "ENOENT" });
    await assert.rejects(withTimelineFixtureLease(backend, async (block, manifest) => {
      await manifest.recordCreated({ eventIds: ["event-2"], profileIds: [], slotIds: [], lineupEntryIds: [] }, { events: 1, profiles: 0, slots: 0 });
      block();
      throw Error("cleanup count uncertain");
    }, { runId: "playwright-timeline-uncertain", manifestDirectory: directory }), /cleanup count uncertain/);
    assert.match(await readFile(path, "utf8"), /event-2/);
  } finally {
    await Promise.all([rm(directory, { recursive: true, force: true }), rm(join(tmpdir(), `vrdex-home-timeline-${key}.lock`), { force: true })]);
  }
});

it("a parallel worker waits for active manifest ownership and enters after verified cleanup", async () => {
  const backend = `http://127.0.0.1:${20000 + Math.floor(Math.random() * 30000)}`;
  const directory = await mkdtemp(join(tmpdir(), "timeline-manifest-parallel-"));
  let started!: () => void;
  const created = new Promise<void>(resolve => { started = resolve; });
  let release!: () => void;
  const wait = new Promise<void>(resolve => { release = resolve; });
  let nextEntered = false;
  try {
    const owner = withTimelineFixtureLease(backend, async (_block, manifest) => {
      await manifest.recordCreated({ eventIds: ["event-1"], profileIds: [], slotIds: [], lineupEntryIds: [] }, { events: 1, profiles: 0, slots: 0 });
      started();
      await wait;
      await manifest.markClean();
    }, { runId: "playwright-timeline-parallel1", manifestDirectory: directory });
    await created;
    const next = withTimelineFixtureLease(backend, async () => { nextEntered = true; }, { timeoutMs: 1000, manifestDirectory: directory });
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(nextEntered, false);
    release();
    await Promise.all([owner, next]);
    assert.equal(nextEntered, true);
  } finally {
    release();
    await rm(directory, { recursive: true, force: true });
  }
});
