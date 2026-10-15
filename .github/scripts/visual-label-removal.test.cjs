"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const { parse } = require("yaml");
const marker = "<!-- vrdex-pr-verification-report -->";
async function run(labels, finalLabels = labels) {
  let reads = 0;
  const workflow = parse(fs.readFileSync(".github/workflows/visual-evidence-opt-out.yml", "utf8"));
  const source = workflow.jobs["invalidate-evidence"].steps[0].with.script;
  const updates = [];
  const github = { paginate: async () => [{ id: 1, user: { type: "Bot" }, body: `${marker}\nFAILED for old run` }, { id: 2, user: { type: "User" }, body: marker }], rest: { pulls: { get: async () => ({ data: { labels: ++reads === 1 ? labels : finalLabels, head: { sha: "current-sha" } } }) }, issues: { listComments: () => {}, updateComment: async input => updates.push(input) } } };
  await new (Object.getPrototypeOf(async function() {}).constructor)("github", "context", source)(github, { repo: { owner: "BASIC-BIT", repo: "VRDex" }, issue: { number: 1 } });
  return updates;
}
test("removing visual selection invalidates old claims without erasing failure history", async () => {
  const updates = await run([]);
  assert.equal(updates.length, 1);
  assert.match(updates[0].body, /FAILED for old run/);
  assert.match(updates[0].body, /not selected.*current-sha/i);
  assert.match(updates[0].body, /Historical/i);
});
test("re-added label prevents an outdated removal event from editing evidence", async () => {
  assert.deepEqual(await run([{ name: "ci:visuals" }]), []);
});

test("a label re-added during comment collection prevents stale invalidation", async () => {
  assert.deepEqual(await run([], [{ name: "ci:visuals" }]), []);
});
