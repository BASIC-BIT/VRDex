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

for (const scenario of ["default", "detail"] as const) {
  for (const fault of [
    { kind: "reset-before-commit", deletes: 2, exitCode: 0, error: null },
    {
      kind: "persistent-reset",
      deletes: 2,
      exitCode: 1,
      error: /ECONNRESET|socket hang up/,
    },
    { kind: "lost-acknowledgement", deletes: 2, exitCode: 1, error: /toEqual/ },
    { kind: "http-error", deletes: 1, exitCode: 1, error: /503/ },
    {
      kind: "malformed-json",
      deletes: 1,
      exitCode: 1,
      error: /JSON|Unexpected token/,
    },
    { kind: "count-mismatch", deletes: 1, exitCode: 1, error: /toEqual/ },
  ]) {
    it(
      `${scenario} cleanup ${fault.kind} preserves the exact-count lease boundary`,
      { timeout: 30_000 },
      async () => {
        const counts =
          scenario === "detail"
            ? { events: 8, profiles: 3, slots: 87, lineupEntries: 2 }
            : { events: 8, profiles: 2, slots: 8 };
        const zeroCounts =
          scenario === "detail"
            ? { events: 0, profiles: 0, slots: 0, lineupEntries: 0 }
            : { events: 0, profiles: 0, slots: 0 };
        let records = 0;
        let postAttempts = 0;
        let createdRunId: string | undefined;
        const deleteRunIds: string[] = [];
        const server = createServer(async (request, response) => {
          const chunks: Buffer[] = [];
          for await (const chunk of request) chunks.push(Buffer.from(chunk));
          const body: unknown = JSON.parse(Buffer.concat(chunks).toString());
          assert.ok(body && typeof body === "object" && "runId" in body);
          assert.equal(typeof body.runId, "string");
          assert.ok(typeof body.runId === "string");
          assert.equal(request.url, "/api/e2e/home-timeline");
          assert.equal(
            request.headers["x-vrdex-e2e-token"],
            "cleanup-retry-test-token",
          );
          response.setHeader("content-type", "application/json");
          if (request.method === "POST") {
            postAttempts++;
            createdRunId = body.runId;
            records = 8;
            response.end(
              JSON.stringify({
                eventIds: Array.from(
                  { length: counts.events },
                  (_, index) => `event-${index}`,
                ),
                profileIds: Array.from(
                  { length: counts.profiles },
                  (_, index) => `profile-${index}`,
                ),
                slotIds: Array.from(
                  { length: counts.slots },
                  (_, index) => `slot-${index}`,
                ),
              }),
            );
            return;
          }
          assert.equal(request.method, "DELETE");
          deleteRunIds.push(body.runId);
          if (
            fault.kind === "persistent-reset" ||
            (fault.kind === "reset-before-commit" && deleteRunIds.length === 1)
          ) {
            response.destroy();
            return;
          }
          if (
            fault.kind === "lost-acknowledgement" &&
            deleteRunIds.length === 1
          ) {
            // The deletion commits atomically before its acknowledgement is lost.
            records = 0;
            response.destroy();
            return;
          }
          if (fault.kind === "http-error") {
            response.writeHead(503);
            response.end(
              JSON.stringify({ error: "synthetic cleanup failure" }),
            );
            return;
          }
          const deleted = records === 8 ? counts : zeroCounts;
          records = 0;
          response.end(
            fault.kind === "malformed-json"
              ? "{invalid"
              : JSON.stringify(
                  fault.kind === "count-mismatch"
                    ? { ...deleted, slots: counts.slots - 1 }
                    : deleted,
                ),
          );
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
        const directory = await mkdtemp(
          join(tmpdir(), "timeline-cleanup-retry-"),
        );
        let child: ReturnType<typeof spawn> | undefined;
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
            join(directory, "cleanup.spec.ts"),
            `
          import { test } from ${JSON.stringify(resolve("apps/web/e2e/home-timeline-fixture.ts"))};
          test.use({ timelineScenario: ${JSON.stringify(scenario)} });
          test('owned cleanup', async ({ timelineFixture }) => {
            if (timelineFixture.eventIds.length !== 8 ||
                timelineFixture.profileIds.length !== ${counts.profiles} ||
                timelineFixture.slotIds.length !== ${counts.slots}) throw Error('invalid synthetic fixture');
            console.log('fixture body completed');
          });
        `,
          );
          child = spawn(
            process.execPath,
            [
              resolve("apps/web/node_modules/@playwright/test/cli.js"),
              "test",
              "--config",
              join(directory, "playwright.config.mjs"),
            ],
            {
              env: {
                ...process.env,
                PLAYWRIGHT_CONVEX_URL: backend,
                VRDEX_E2E_BROWSER_TOKEN: "cleanup-retry-test-token",
              },
              stdio: ["ignore", "pipe", "pipe"],
              timeout: 20_000,
            },
          );
          let output = "";
          child.stdout?.on("data", (chunk) => {
            output += String(chunk);
          });
          child.stderr?.on("data", (chunk) => {
            output += String(chunk);
          });
          const [exitCode, signal] = await once(child, "close");
          assert.equal(signal, null, output);
          assert.equal(exitCode, fault.exitCode, output);
          assert.equal(postAttempts, 1, output);
          assert.equal(deleteRunIds.length, fault.deletes, output);
          assert.match(createdRunId ?? "", /^playwright-timeline-/);
          assert.ok(
            deleteRunIds.every((id) => id === createdRunId),
            output,
          );
          assert.match(output, /fixture body completed/);
          assert.equal(
            records,
            fault.kind === "persistent-reset" || fault.kind === "http-error"
              ? 8
              : 0,
          );
          if (fault.error) {
            assert.match(output, fault.error);
            await assert.rejects(
              withTimelineFixtureLease(
                backend,
                async () => {
                  assert.fail("blocked lease admitted another fixture");
                },
                { timeoutMs: 100 },
              ),
              /Timeline fixture cleanup failed/,
            );
          } else {
            assert.equal(
              await withTimelineFixtureLease(backend, async () => "released", {
                timeoutMs: 100,
              }),
              "released",
            );
          }
        } finally {
          if (child && child.exitCode === null && child.signalCode === null) {
            child.kill();
            await once(child, "close");
          }
          const closed = once(server, "close");
          server.close();
          server.closeAllConnections();
          await closed;
          await Promise.all([
            rm(directory, { recursive: true, force: true }),
            rm(leasePath, { force: true }),
          ]);
        }
      },
    );
  }
}
