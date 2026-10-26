import assert from "node:assert/strict";
import { test } from "node:test";
import { buildConvexCliArgs } from "../../scripts/convex-local-args.mjs";
const pin = "precompiled-2026-09-28-5c7cb5b";
const options = {
  backendVersion: pin,
  cloudPort: "3310",
  sitePort: "3311",
  isTTY: false,
  ci: undefined,
};
test("local verification forwards the exact pin without mutating caller arguments", () => {
  const args = Object.freeze([
    "dev",
    "--local",
    "--once",
    "--run",
    "health:status",
    "--tail-logs",
    "disable",
  ]);
  assert.deepEqual(buildConvexCliArgs(args, options), [
    "dev",
    "--local-cloud-port",
    "3310",
    "--local-site-port",
    "3311",
    "--local-force-upgrade",
    "--local-backend-version",
    pin,
    ...args.slice(1),
  ]);
});
test("interactive local dev uses pin; CI still forces upgrade", () => {
  assert.deepEqual(
    buildConvexCliArgs(["dev", "--local"], { ...options, isTTY: true }),
    [
      "dev",
      "--local-cloud-port",
      "3310",
      "--local-site-port",
      "3311",
      "--local-backend-version",
      pin,
      "--local",
    ],
  );
  assert.ok(
    buildConvexCliArgs(["dev", "--local"], {
      ...options,
      isTTY: true,
      ci: "true",
    }).includes("--local-force-upgrade"),
  );
});
for (const explicit of [
  ["--local-backend-version", "explicit"],
  ["--local-backend-version=explicit"],
])
  test(`explicit pin wins: ${explicit[0]}`, () => {
    assert.deepEqual(
      buildConvexCliArgs(
        [
          "dev",
          "--local",
          "--local-cloud-port=4410",
          "--local-site-port",
          "4411",
          "--local-force-upgrade",
          ...explicit,
        ],
        options,
      ),
      [
        "dev",
        "--local",
        "--local-cloud-port=4410",
        "--local-site-port",
        "4411",
        "--local-force-upgrade",
        ...explicit,
      ],
    );
  });
for (const backendVersion of [undefined, ""])
  test(`absent pin ${String(backendVersion)} adds no version`, () => {
    assert.equal(
      buildConvexCliArgs(["dev", "--local"], {
        ...options,
        backendVersion,
      }).includes("--local-backend-version"),
      false,
    );
  });
for (const args of [
  ["dev", "--once"],
  ["run", "--local", "health:status"],
  ["deploy"],
])
  test(`nonlocal-dev command ${args} unchanged`, () =>
    assert.deepEqual(buildConvexCliArgs(args, options), args));
test("one explicit port preserves existing all-or-neither port semantics", () =>
  assert.deepEqual(
    buildConvexCliArgs(["dev", "--local", "--local-cloud-port", "4410"], {
      ...options,
      backendVersion: undefined,
      isTTY: true,
    }),
    ["dev", "--local", "--local-cloud-port", "4410"],
  ));
