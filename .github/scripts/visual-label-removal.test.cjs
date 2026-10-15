"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const { parse } = require("yaml");
const marker = "<!-- vrdex-pr-verification-report -->";
async function run({ removed = "ci:visuals", labels = [], finalLabels = labels, head = "current-sha", finalHead = head, recorded = { head: "current-sha", browsers: true, visuals: true } } = {}) {
  let reads = 0;
  const workflow = parse(fs.readFileSync(".github/workflows/visual-evidence-opt-out.yml", "utf8"));
  const source = workflow.jobs["invalidate-evidence"].steps[0].with.script;
  const updates = [];
  const github = {
    paginate: async () => [{ id: 1, user: { type: "Bot" }, body: `${marker}\n<!-- vrdex-test-selection:${JSON.stringify(recorded)} -->\nFAILED for old run` }, { id: 2, user: { type: "User" }, body: marker }],
    rest: { pulls: { get: async () => { const first = ++reads === 1; return { data: { labels: first ? labels : finalLabels, head: { sha: first ? head : finalHead } } }; } }, issues: { listComments: () => {}, updateComment: async input => updates.push(input) } },
  };
  await new (Object.getPrototypeOf(async function() {}).constructor)("github", "context", source)(github, { repo: { owner: "BASIC-BIT", repo: "VRDex" }, issue: { number: 1 }, payload: { label: { name: removed }, pull_request: { head: { sha: "current-sha" } } } });
  return updates;
}

test("removing either selection label preserves failures and records observed coverage as historical", async () => {
  for (const removed of ["ci:visuals", "ci:browsers"]) {
    const updates = await run({ removed });
    assert.equal(updates.length, 1); assert.match(updates[0].body, /FAILED for old run/);
    assert.match(updates[0].body, /Browser coverage selected: no/);
    assert.match(updates[0].body, /Visual evidence selected: no/);
    assert.match(updates[0].body, /Historical.*including failures/i);
    assert.match(updates[0].body, /current-sha/);
  }
});

test("removing visuals retains browser selection when ci:browsers remains", async () => {
  const updates = await run({ labels: [{ name: "ci:browsers" }] });
  assert.match(updates[0].body, /Browser coverage selected: yes/);
  assert.match(updates[0].body, /Visual evidence selected: no/);
});

test("removing redundant browser label cannot invalidate unchanged visuals-implied browser selection", async () => {
  assert.deepEqual(await run({ removed: "ci:browsers", labels: [{ name: "ci:visuals" }] }), []);
});

test("re-added label before or during collection prevents stale invalidation for either selector", async () => {
  for (const removed of ["ci:browsers", "ci:visuals"]) {
    const restored = [{ name: removed }];
    assert.deepEqual(await run({ removed, labels: restored }), []);
    assert.deepEqual(await run({ removed, finalLabels: restored }), []);
  }
});

test("a stale event or changed head cannot invalidate current evidence", async () => {
  assert.deepEqual(await run({ head: "new-head" }), []);
  assert.deepEqual(await run({ finalHead: "new-head" }), []);
});
