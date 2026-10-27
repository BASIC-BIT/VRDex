import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { it } from "node:test";
import { withTimelineFixtureLease } from "../../apps/web/e2e/home-timeline-lease";

it("an ambiguous create keeps the lease blocked when cleanup precedes its late commit", async () => {
  let records = 0;
  let cleanupObserved: number | undefined;
  let createRun: string | undefined;
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString()) as {
      runId: string;
    };
    if (request.method === "POST") {
      createRun = body.runId;
      // The client loses its response while the server-side create is pending.
      response.destroy();
    } else {
      assert.equal(request.method, "DELETE");
      assert.equal(body.runId, createRun);
      cleanupObserved = records;
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ events: 0, profiles: 0, slots: 0 }));
      // An independent mutation commits after cleanup has already read zero.
      records = 8;
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const backend = `http://127.0.0.1:${address.port}`;
  const leasePath = join(
    tmpdir(),
    `vrdex-home-timeline-${createHash("sha256").update(backend).digest("hex")}.lock`,
  );
  const directory = await mkdtemp(join(tmpdir(), "timeline-create-failure-"));
  try {
    await writeFile(
      join(directory, "playwright.config.mjs"),
      `export default ${JSON.stringify({
        testDir: directory,
        timeout: 5000,
        workers: 1,
        retries: 0,
        reporter: "list",
        outputDir: join(directory, "results"),
        use: { baseURL: backend },
      })};`,
    );
    await writeFile(
      join(directory, "create.spec.ts"),
      `
      import { test } from ${JSON.stringify(resolve("apps/web/e2e/home-timeline-fixture.ts"))};
      test('ambiguous create', async ({ timelineFixture }) => {
        throw new Error('body must not run after failed create');
      });
    `,
    );
    const child = spawn(
      process.execPath,
      [
        resolve("apps/web/node_modules/@playwright/test/cli.js"),
        "test",
        "--config",
        join(directory, "playwright.config.mjs"),
      ],
      {
        env: { ...process.env, PLAYWRIGHT_CONVEX_URL: backend },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      output += String(chunk);
    });
    assert.deepEqual(await once(child, "exit"), [1, null], output);
    assert.match(createRun ?? "", /^playwright-timeline-/);
    assert.equal(cleanupObserved, 0);
    assert.equal(records, 8);
    await assert.rejects(
      withTimelineFixtureLease(
        backend,
        async () => {
          assert.fail("next fixture entered alongside the late commit");
        },
        { timeoutMs: 100 },
      ),
      /Timeline fixture cleanup failed/,
    );
  } finally {
    server.close();
    await Promise.all([
      rm(directory, { recursive: true, force: true }),
      rm(leasePath, { force: true }),
    ]);
  }
});
