import assert from "node:assert/strict";
import { it } from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { eventDjTarget } from "../../apps/web/src/lib/event-dj-target";
import { createSourceStatusReader } from "../../apps/web/src/lib/event-source-observations";
function fixture({
  token = "jwt",
  allowed = true,
  eventPath = "/club/events/show",
} = {}) {
  const probes: string[] = [],
    calls: string[] = [];
  const status = {
    eventPath,
    sources: [
      {
        sourceId: "a",
        hasPublicUrl: true,
        input: { kind: "vrcdn", streamId: "aurora" },
        publicUrl: "vrcdn:aurora",
      },
      {
        sourceId: "b",
        hasPublicUrl: true,
        input: { kind: "twitch", channel: "nova" },
        publicUrl: "https://www.twitch.tv/nova",
      },
    ],
  };
  const read = createSourceStatusReader(async (source) => {
    probes.push(source.key);
    return { state: "live", observedAt: Date.now() };
  });
  const dependencies: Record<string, unknown> = {
    "convex/nextjs": {
      fetchQuery: async (
        _ref: unknown,
        args: { currentSlug: string },
        options: { token: string },
      ) => {
        calls.push("authorize");
        assert.equal(args.currentSlug, "show");
        assert.equal(options.token, token);
        if (!allowed) throw Error("denied");
        return status;
      },
    },
    "@convex-generated-api": {
      api: { events: { getEventMediaControlStatus: "status" } },
    },
    "@/lib/server/auth": { convexAuthToken: async () => token },
    "@/lib/event-dj-target": { eventDjTarget },
    "@/lib/server/event-source-status": { getEventSourceStatuses: read },
  };
  const source = readFileSync(
    "apps/web/src/app/[slug]/events/[eventSlug]/operate/status/route.ts",
    "utf8",
  );
  const output = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.CommonJS,
    },
  }).outputText;
  const exports: Record<string, any> = {};
  const requireWeb = createRequire(path.resolve("apps/web/package.json"));
  vm.runInNewContext(output, {
    exports,
    require: (name: string) => dependencies[name] ?? requireWeb(name),
    Response,
    URL,
  });
  return {
    probes,
    calls,
    run: (query = "ids=a,b") =>
      exports.GET(
        new Request(
          `https://example.test/club/events/show/operate/status?${query}`,
        ),
        { params: Promise.resolve({ slug: "club", eventSlug: "show" }) },
      ),
  };
}
it("operator status authorizes the exact event before custom or lineup probes, including read-only readers", async () => {
  const f = fixture();
  const response = await f.run();
  assert.equal(response.status, 200);
  assert.match(
    response.headers.get("Cache-Control") ?? "",
    /private.*no-store/,
  );
  assert.deepEqual(f.calls, ["authorize"]);
  assert.deepEqual(f.probes, ["vrcdn:aurora", "twitch:nova"]);
  assert.deepEqual(Object.keys(await response.json()), [
    "vrcdn:aurora",
    "twitch:nova",
  ]);
});
it("anonymous, permission loss and wrong community never probe", async () => {
  for (const input of [
    { token: "" },
    { allowed: false },
    { eventPath: "/other/events/show" },
  ]) {
    const f = fixture(input);
    assert.equal((await f.run()).status, input.token === "" ? 401 : 404);
    assert.deepEqual(f.probes, []);
  }
});
it("foreign IDs, duplicate IDs, oversized windows and arbitrary URLs never probe", async () => {
  for (const query of [
    "ids=foreign",
    "ids=a,a",
    "ids=a,b,c,d,e",
    `ids=${"x".repeat(1025)}`,
    "ids=a&url=https://example.invalid",
    "ids=a&ids=b",
  ]) {
    const f = fixture();
    assert.equal((await f.run(query)).status, 400, query);
    assert.deepEqual(f.probes, []);
  }
  const f = fixture();
  assert.deepEqual(await (await f.run("ids=a")).json(), {
    "vrcdn:aurora": {
      state: "live",
      observedAt: (await (await f.run("ids=a")).json())["vrcdn:aurora"]
        .observedAt,
    },
  });
  assert.deepEqual(f.probes, ["vrcdn:aurora"]);
});
