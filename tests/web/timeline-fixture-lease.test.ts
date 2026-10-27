import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import { unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";
import { withTimelineFixtureLease } from "../../apps/web/e2e/home-timeline-lease";

const target = () => `http://${randomUUID()}.invalid:3210`;

it("excludes another worker until the owning fixture has cleaned up", async () => {
  const backend = target();
  await withTimelineFixtureLease(backend, async () => {
    const child = spawn(
      process.execPath,
      [
        "--import",
        "tsx",
        "--eval",
        `
      const { withTimelineFixtureLease } = require('./apps/web/e2e/home-timeline-lease.ts');
      withTimelineFixtureLease(${JSON.stringify(backend)}, async () => {
        process.send('entered');
      }, { timeoutMs: 100 }).catch((error) => process.send(error.message));
    `,
      ],
      { stdio: ["ignore", "ignore", "inherit", "ipc"] },
    );
    const exited = once(child, "exit");
    const [message] = await once(child, "message");
    assert.match(
      String(message),
      /Timed out waiting for timeline fixture cleanup/,
    );
    assert.deepEqual(await exited, [0, null]);
  });
  assert.equal(
    await withTimelineFixtureLease(backend, async () => "next fixture"),
    "next fixture",
  );
});

it("releases after a body error when owned cleanup has succeeded", async () => {
  const backend = target();
  await assert.rejects(
    withTimelineFixtureLease(backend, async () => {
      throw new Error("fixture failed");
    }),
    /fixture failed/,
  );
  assert.equal(
    await withTimelineFixtureLease(backend, async () => "recovered", {
      timeoutMs: 100,
    }),
    "recovered",
  );
});

it("blocks the next fixture when owned cleanup fails", async () => {
  const backend = target();
  const path = join(
    tmpdir(),
    `vrdex-home-timeline-${createHash("sha256").update(new URL(backend).origin).digest("hex")}.lock`,
  );
  try {
    await assert.rejects(
      withTimelineFixtureLease(
        backend,
        async (block) => {
          block();
          throw new Error("cleanup request failed");
        },
        { runId: "playwright-timeline-cleanup-failed" },
      ),
      /cleanup request failed/,
    );
    await assert.rejects(
      withTimelineFixtureLease(
        backend,
        async () => {
          assert.fail("must not seed alongside abandoned records");
        },
        { timeoutMs: 100 },
      ),
      /Timeline fixture cleanup failed.*playwright-timeline-cleanup-failed/s,
    );
  } finally {
    await unlink(path);
  }
});

it("times out without stealing an interrupted worker's lease", async () => {
  const backend = target();
  const path = join(
    tmpdir(),
    `vrdex-home-timeline-${createHash("sha256").update(new URL(backend).origin).digest("hex")}.lock`,
  );
  try {
    const child = spawn(
      process.execPath,
      [
        "--import",
        "tsx",
        "--eval",
        `
      const { withTimelineFixtureLease } = require('./apps/web/e2e/home-timeline-lease.ts');
      withTimelineFixtureLease(${JSON.stringify(backend)}, async () => process.exit(0));
    `,
      ],
      { stdio: "inherit" },
    );
    assert.deepEqual(await once(child, "exit"), [0, null]);
    await assert.rejects(
      withTimelineFixtureLease(
        backend,
        async () => {
          assert.fail("must not steal a lease with uncertain cleanup");
        },
        { timeoutMs: 100 },
      ),
      /Timed out waiting for timeline fixture cleanup/,
    );
  } finally {
    await unlink(path);
  }
});

it("independent backends do not wait for each other", async () => {
  await withTimelineFixtureLease(target(), async () => {
    assert.equal(
      await withTimelineFixtureLease(target(), async () => "independent", {
        timeoutMs: 100,
      }),
      "independent",
    );
  });
});
