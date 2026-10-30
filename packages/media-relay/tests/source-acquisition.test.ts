import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer, request, type IncomingMessage } from "node:http";
import { once } from "node:events";
import {
  createSourceRelay,
  validateSourceEndpoint,
} from "../../../workers/restream/source-relay.mjs";
const source = {
  id: "DJ_Case",
  revision: 1,
  type: "vrcdn_link",
  publicUrl: "https://stream.vrcdn.live/live/DJ_Case.live.mp4",
};
test("MP4 is explicit and preserves exact canonical source casing; TS defaults and operator endpoints survive", () => {
  assert.equal(
    validateSourceEndpoint(source.publicUrl, [], "vrcdn_fmp4").href,
    source.publicUrl,
  );
  assert.throws(() => validateSourceEndpoint(source.publicUrl));
  assert.equal(
    validateSourceEndpoint(source.publicUrl.replace(".mp4", ".ts")).pathname,
    "/live/DJ_Case.live.ts",
  );
  assert.equal(
    validateSourceEndpoint("https://operator.example/exact", [
      "https://operator.example/exact",
    ]).pathname,
    "/exact",
  );
  for (const url of [
    source.publicUrl + "?x=1",
    source.publicUrl.replace(".mp4", ".ts"),
    source.publicUrl.replace("DJ_Case", "%44J_Case"),
    "https://127.0.0.1/live/DJ_Case.live.mp4",
  ]) {
    assert.throws(() => validateSourceEndpoint(url, [], "vrcdn_fmp4"));
  }
});
test("MP4 relay validates content type, rejects redirects and DNS rebinding, and releases acquisition before reconnect", async () => {
  let status = 200,
    contentType = "video/mp4",
    requests = 0,
    closed = 0,
    privateDns = false;
  const provider = createServer((_req, res) => {
    requests++;
    res.on("close", () => closed++);
    res.writeHead(status, {
      "Content-Type": contentType,
      location: "http://127.0.0.1/private",
    });
    res.end("fragment");
  });
  provider.listen(0, "127.0.0.1");
  await once(provider, "listening");
  const address = provider.address();
  assert(address && typeof address !== "string");
  const seen: string[] = [];
  const relay = await createSourceRelay({
    inputFormat: "vrcdn_fmp4",
    resolveAddresses: async () => [
      { address: privateDns ? "127.0.0.1" : "93.184.216.34", family: 4 },
    ],
    requestSource: (
      url: URL,
      _options: unknown,
      callback: (res: IncomingMessage) => void,
    ) => {
      seen.push(url.href);
      return request(`http://127.0.0.1:${address.port}`, callback);
    },
  });
  try {
    const handle = relay.createInput({ source });
    const { url } = await handle.transportReady;
    const response = await fetch(url);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "video/mp4");
    assert.equal(await response.text(), "fragment");
    assert.deepEqual(seen, [source.publicUrl]);
    assert.equal(closed, 1);
    await handle.dispose();
    const attempt = async () => {
      const next = relay.createInput({ source });
      try {
        return (await fetch((await next.transportReady).url)).status;
      } finally {
        await next.dispose();
      }
    };
    contentType = "text/html";
    assert.equal(await attempt(), 502);
    contentType = "video/mp4";
    status = 302;
    assert.equal(await attempt(), 502);
    assert.equal(requests, 3);
    status = 200;
    privateDns = true;
    assert.equal(await attempt(), 502);
    assert.equal(requests, 3);
    await handle.dispose();
    assert.equal((await fetch(url)).status, 404);
  } finally {
    await relay.stop();
    provider.closeAllConnections();
    await new Promise<void>((resolve) => provider.close(() => resolve()));
  }
});
test("default per-acquisition resolver is cancelled on disposal without touching another route", async () => {
  const resolvers: { cancelled: boolean; reject: (error: Error) => void }[] =
    [];
  const relay = await createSourceRelay({
    operatorEndpoints: ["https://fixture.invalid/input.mp4"],
    inputFormat: "vrcdn_fmp4",
    createResolver: () => {
      const resolver = { cancelled: false, reject: (_error: Error) => {} };
      resolvers.push(resolver);
      return {
        resolve4: () =>
          new Promise<string[]>((_resolve, reject) => {
            resolver.reject = reject;
          }),
        cancel: () => {
          resolver.cancelled = true;
          resolver.reject(Error("cancelled"));
        },
      };
    },
    requestSource: () => {
      throw Error("DNS never completed");
    },
  });
  const handles = [0, 1].map((id) =>
    relay.createInput({
      source: {
        ...source,
        id: `source-${id}`,
        publicUrl: "https://fixture.invalid/input.mp4",
      },
    }),
  );
  const clients: ReturnType<typeof request>[] = [];
  try {
    for (const handle of handles) {
      const client = request((await handle.transportReady).url);
      client.on("error", () => {});
      client.end();
      clients.push(client);
    }
    for (let i = 0; i < 100 && resolvers.length < 2; i++)
      await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(resolvers.length, 2);
    const started = performance.now();
    await handles[0]!.dispose();
    assert(performance.now() - started < 1000);
    assert.equal(resolvers[0]?.cancelled, true);
    assert.equal(resolvers[1]?.cancelled, false);
    await handles[1]!.dispose();
    assert.equal(resolvers[1]?.cancelled, true);
  } finally {
    clients.forEach((client) => client.destroy());
    await Promise.all(handles.map((handle) => handle.dispose()));
    relay.stop();
  }
});
test("MP4 reconnect refuses overlap and waits for physical socket disposal", async () => {
  let acquisitions = 0,
    active = 0,
    maximum = 0;
  const provider = createServer((_req, res) => {
    acquisitions++;
    active++;
    maximum = Math.max(maximum, active);
    res.once("close", () => active--);
    res.writeHead(200, { "Content-Type": "video/mp4" });
    res.write("fragment");
  });
  provider.listen(0, "127.0.0.1");
  await once(provider, "listening");
  const address = provider.address();
  assert(address && typeof address !== "string");
  const relay = await createSourceRelay({
    inputFormat: "vrcdn_fmp4",
    resolveAddresses: async () => [{ address: "93.184.216.34", family: 4 }],
    requestSource: (
      _url: URL,
      _options: unknown,
      callback: (res: IncomingMessage) => void,
    ) => request(`http://127.0.0.1:${address.port}`, callback),
  });
  const open = async (url: string) => {
    const client = request(url);
    client.on("error", () => {});
    client.end();
    const [response] = await once(client, "response");
    response.on("error", () => {});
    response.resume();
    return client;
  };
  let first: ReturnType<typeof request> | undefined,
    second: ReturnType<typeof request> | undefined;
  try {
    const handle = relay.createInput({ source });
    const { url } = await handle.transportReady;
    first = await open(url);
    assert.equal((await fetch(url)).status, 409);
    assert.equal(acquisitions, 1);
    await handle.dispose();
    const next = relay.createInput({ source });
    second = await open((await next.transportReady).url);
    assert.equal(acquisitions, 2);
    assert.equal(maximum, 1);
    await next.dispose();
  } finally {
    first?.destroy();
    second?.destroy();
    relay.stop();
    provider.closeAllConnections();
    await new Promise<void>((resolve) => provider.close(() => resolve()));
  }
});
test(
  "default DNS attempt deadline cancels its resolver and returns failure without an upstream request",
  { timeout: 5000 },
  async () => {
    let cancelled = false,
      requests = 0;
    const relay = await createSourceRelay({
      inputFormat: "vrcdn_fmp4",
      createResolver: () => {
        let rejectWork = (_error: Error) => {};
        return {
          resolve4: () =>
            new Promise<string[]>((_resolve, reject) => {
              rejectWork = reject;
            }),
          cancel: () => {
            cancelled = true;
            rejectWork(Error("cancelled"));
          },
        };
      },
      requestSource: () => {
        requests++;
        throw Error("must not acquire");
      },
    });
    const handle = relay.createInput({ source });
    try {
      assert.equal(
        (await fetch((await handle.transportReady).url)).status,
        502,
      );
      await handle.dispose();
      assert.equal(cancelled, true);
      assert.equal(requests, 0);
    } finally {
      await handle.dispose();
      relay.stop();
    }
  },
);
