import { Readable } from "node:stream";
import test from "node:test";
import assert from "node:assert/strict";
import { boundedJson, deadline } from "../src/providers/transport";
test("JSON provider boundary rejects streamed oversized replies without buffering the full body", async () => {
  let cancelled = false;
  const response = new Response(
    new ReadableStream({
      pull(c) {
        c.enqueue(new TextEncoder().encode(" ".repeat(40)));
      },
      cancel() {
        cancelled = true;
      },
    }),
  );
  await assert.rejects(boundedJson(response, 64), /size/);
  assert.equal(cancelled, true);
});
test("deadline physically cancels fetch and caller cancellation propagates", async () => {
  const caller = new AbortController();
  const signal = deadline(caller.signal, 20);
  caller.abort();
  assert.equal(signal.aborted, true);
  const timed = deadline(undefined, 10);
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(timed.aborted, true);
});
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { createAwsDemand } from "../src/providers/aws-demand";
import {
  createControlRpc,
  createConvexControl,
} from "../src/providers/convex-control";
test("control uses abortable JSON service RPC and hides upstream payloads", async () => {
  let received: Record<string, unknown> | undefined;
  const rpc = createControlRpc({
    url: "https://control.invalid",
    credential: "synthetic",
    fetcher: async (_url, init) => {
      received = JSON.parse(String(init?.body));
      assert.ok(init?.signal);
      return Response.json({ status: "success", value: [] });
    },
  });
  const binding = {
    workerId: "worker-one",
    workerEpoch: 1,
    allocation: { cpuUnits: 1024, memoryMiB: 2048, evidenceId: "local-only" },
    maxSources: 2,
    draining: false,
  };
  assert.deepEqual(
    await createConvexControl(rpc, binding).list(new AbortController().signal),
    [],
  );
  assert.deepEqual(received, {
    path: "mediaRelayWorker:listSources",
    args: { workerId: "worker-one", workerEpoch: 1, credential: "synthetic" },
    format: "json",
  });
  const failed = createControlRpc({
    url: "https://control.invalid",
    credential: "synthetic",
    fetcher: async () => {
      throw Error("secret-url");
    },
  });
  await assert.rejects(
    failed("query", "readGateway", {}, new AbortController().signal),
    (e) => e instanceof Error && !e.message.includes("secret-url"),
  );
});
test("demand health probes transport strongly consistently and finite timeout cancels physical transport", async () => {
  let aborted = false;
  let body = "";
  const client = new DynamoDBClient({
    region: "us-east-1",
    credentials: { accessKeyId: "fixture", secretAccessKey: "fixture" },
    maxAttempts: 1,
    requestHandler: {
      handle: async (request, options) => {
        body = new TextDecoder().decode(request.body);
        await new Promise<void>((resolve, reject) => {
          options?.abortSignal?.addEventListener(
            "abort",
            () => {
              aborted = true;
              reject(Error("aborted"));
            },
            { once: true },
          );
        });
        throw Error("unreachable");
      },
    },
  });
  const start = Date.now();
  await assert.rejects(createAwsDemand(client, "fixture").checkHealth());
  assert.ok(Date.now() - start < 2500);
  assert.equal(aborted, true);
  assert.equal(JSON.parse(body).ConsistentRead, true);
  assert.equal(JSON.parse(body).Key.streamKey.S, "_health");
  client.destroy();
});
import { S3Client } from "@aws-sdk/client-s3";
import { createAwsStorage } from "../src/providers/aws-storage";
test("retirement advances its cursor past young objects and bounds listing", async () => {
  const paths: string[] = [];
  const client = new S3Client({
    region: "us-east-1",
    credentials: { accessKeyId: "fixture", secretAccessKey: "fixture" },
    maxAttempts: 1,
    requestHandler: {
      handle: async (request) => {
        paths.push(String(request.query?.["continuation-token"] ?? ""));
        const xml =
          paths.length === 1
            ? "<ListBucketResult><IsTruncated>true</IsTruncated><NextContinuationToken>page-two</NextContinuationToken><Contents><Key>vrcdn/a/1/epochs/1/new.ts</Key><LastModified>2099-01-01T00:00:00.000Z</LastModified></Contents></ListBucketResult>"
            : "<ListBucketResult><IsTruncated>false</IsTruncated></ListBucketResult>";
        return {
          response: {
            statusCode: 200,
            headers: {},
            body: new TextEncoder().encode(xml),
          },
        };
      },
    },
  });
  const storage = createAwsStorage(client, "fixture");
  await storage.retire({
    before: Date.now(),
    limit: 10,
    signal: new AbortController().signal,
  });
  await storage.retire({
    before: Date.now(),
    limit: 10,
    signal: new AbortController().signal,
  });
  assert.deepEqual(paths, ["", "page-two"]);
  client.destroy();
});
import { parseDeployment } from "../src/providers/config";
test("deployment defaults disabled and enabled deployment rejects missing measured release fields", () => {
  assert.deepEqual(parseDeployment({}), { version: 1, enabled: false });
  assert.throws(() =>
    parseDeployment({
      MEDIA_RELAY_CONFIG: JSON.stringify({ version: 1, enabled: true }),
    }),
  );
});
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
test("successful immutable uploads cache only bounded matching digests", async () => {
  const directory = await mkdtemp(join(tmpdir(), "relay-provider-"));
  const path = join(directory, "segment");
  await writeFile(path, "same-bytes");
  let puts = 0;
  const client = new S3Client({
    region: "us-east-1",
    credentials: { accessKeyId: "fixture", secretAccessKey: "fixture" },
    maxAttempts: 1,
    requestHandler: {
      handle: async (request) => {
        if (request.method === "PUT") {
          puts++;
          for await (const _chunk of request.body) {
            /* physically consume stream */
          }
        }
        return {
          response: { statusCode: 200, headers: {}, body: new Uint8Array() },
        };
      },
    },
  });
  try {
    const storage = createAwsStorage(client, "fixture", {
      maxCachedUploads: 2,
    });
    const upload = (n: number) =>
      storage.putSegment({
        objectKey: `vrcdn/Alpha/1/epochs/1/attempt/video-${n}.ts`,
        filePath: path,
        signal: new AbortController().signal,
        retireAfterMs: 600000,
      });
    await upload(0);
    await upload(0);
    assert.equal(puts, 1);
    await writeFile(path, "different");
    await assert.rejects(upload(0), /conflict/);
    assert.equal(puts, 1);
    await writeFile(path, "same-bytes");
    await upload(1);
    await upload(2);
    await upload(0);
    assert.equal(puts, 4);
  } finally {
    client.destroy();
    await rm(directory, { recursive: true, force: true });
  }
});
test("retirement checkpoint survives adapter replacement", async () => {
  let checkpoint = "";
  let checkpointProbes = 0;
  const cursors: string[] = [];
  const client = new S3Client({
    region: "us-east-1",
    credentials: { accessKeyId: "fixture", secretAccessKey: "fixture" },
    maxAttempts: 1,
    requestHandler: {
      handle: async (request) => {
        if (request.query?.prefix === "_relay/retirement/slot-one.json") {
          checkpointProbes++;
          return {
            response: {
              statusCode: 200,
              headers: {},
              body: new TextEncoder().encode(
                `<ListBucketResult><IsTruncated>false</IsTruncated>${checkpoint ? "<Contents><Key>_relay/retirement/slot-one.json</Key></Contents>" : ""}</ListBucketResult>`,
              ),
            },
          };
        }
        if (request.path.includes("_relay/retirement")) {
          if (request.method === "PUT") {
            checkpoint =
              typeof request.body === "string"
                ? request.body
                : Buffer.from(request.body).toString();
            return {
              response: {
                statusCode: 200,
                headers: {},
                body: new Uint8Array(),
              },
            };
          }
          return {
            response: {
              statusCode: 200,
              headers: {},
              body: Readable.from([
                Buffer.from(checkpoint || '{"cursor":null}'),
              ]),
            },
          };
        }
        cursors.push(String(request.query?.["continuation-token"] ?? ""));
        return {
          response: {
            statusCode: 200,
            headers: {},
            body: new TextEncoder().encode(
              "<ListBucketResult><IsTruncated>true</IsTruncated><NextContinuationToken>persisted-page</NextContinuationToken></ListBucketResult>",
            ),
          },
        };
      },
    },
  });
  try {
    for (let i = 0; i < 2; i++)
      await createAwsStorage(client, "fixture", {
        cursorKey: "_relay/retirement/slot-one.json",
      }).retire({
        before: Date.now(),
        limit: 10,
        signal: new AbortController().signal,
      });
    assert.deepEqual(cursors, ["", "persisted-page"]);
    assert.equal(checkpointProbes, 2);
  } finally {
    client.destroy();
  }
});
test("streamed JSON cancellation closes an already-open response body", async () => {
  let cancelled = false;
  const response = new Response(
    new ReadableStream({
      cancel() {
        cancelled = true;
      },
    }),
  );
  const abort = new AbortController();
  const pending = boundedJson(response, 100, abort.signal);
  abort.abort();
  const result = await Promise.race([
    pending.then(
      () => false,
      () => true,
    ),
    new Promise((resolve) => setTimeout(() => resolve(false), 100)),
  ]);
  assert.equal(result, true, "body cancellation must settle");
  assert.equal(cancelled, true);
});
