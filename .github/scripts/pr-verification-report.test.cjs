"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const { LEGACY_MARKERS, REPORT_MARKER, buildReport, updatePrVerificationReport } = require("./pr-verification-report.cjs");
const coreJobs = ["lint-web", "verify-docs", "verify-api-mcp", "typecheck-web", "typecheck-backend", "verify-backend-local", "restream-local-checks", "build-web"];
const browserJobs = ["playwright-public-smoke", "playwright-data-flow", "playwright-public-preview", "storybook-component-preview"];
function fixture(browsers = true, visuals = true) {
  const needs = Object.fromEntries(coreJobs.map(job => [job, { result: "success" }]));
  needs["visual-selection"] = { result: "success", outputs: { browsers: String(browsers), visuals: String(visuals) } };
  needs["build-storybook"] = { result: browsers ? "success" : "skipped" };
  for (const job of browserJobs) needs[job] = { result: browsers ? "success" : "skipped" };
  needs["playwright-hosted-data-flow"] = { result: browsers ? "success" : "skipped", outputs: browsers ? { configured: "false" } : {} };
  for (const job of ["playwright-image-diff", "storybook-image-diff"]) needs[job] = { result: visuals ? "success" : "skipped" };
  const artifacts = [...(browsers ? browserJobs : []), ...(visuals ? ["playwright-image-diff", "storybook-image-diff"] : [])].map((name, id) => ({ name, id, expired: false }));
  return { needs, artifacts, headSha: "0123456789abcdef", owner: "BASIC-BIT", repo: "VRDex", runId: 456 };
}

test("default report marks every browser and Storybook build NOT SELECTED without claiming browser success", () => {
  const report = buildReport(fixture(false, false));
  assert.match(report, /All required checks and selected coverage passed/);
  assert.match(report, /Browsers selected for this run: no/);
  for (const label of ["Storybook build", "Public route smoke", "Mutation data flow", "Hosted data flow", "Public route preview", "Storybook preview", "Public route image diff", "Storybook image diff"]) {
    assert.match(report, new RegExp(`${label} \\| NOT SELECTED \\| Not requested`));
  }
  assert.match(report, /Web build \| PASSED/);
  assert.doesNotMatch(report, /Missing evidence|Not configured|assertions only/);
});

test("browsers-only report keeps assertion success distinct from unselected captures and comparisons", () => {
  const report = buildReport(fixture(true, false));
  assert.match(report, /Browsers selected for this run: yes/);
  assert.match(report, /Visuals selected for this run: no/);
  assert.match(report, /Public route assertions only \| PASSED \| \[Open artifact\]/);
  assert.match(report, /Storybook assertions only \| PASSED/);
  assert.match(report, /Public route image diff \| NOT SELECTED/);
  assert.match(report, /Hosted data flow \| SKIPPED \| Not configured/);
  assert.doesNotMatch(report, /need attention|screenshots \| PASSED/);
});

test("visual report collates evidence and every changed baseline with immutable mode metadata", () => {
  const input = fixture();
  const files = Array.from({ length: 14 }, (_, index) => ({ filename: `apps/web/e2e/__screenshots__/desktop-chromium/route-${index}.png`, status: "modified" }));
  const report = buildReport({ ...input, files, runAttempt: 2 });
  assert.match(report, new RegExp(REPORT_MARKER));
  assert.match(report, /Public route screenshots \| PASSED/);
  assert.match(report, /Visuals selected for this run: yes/);
  assert.match(report, /vrdex-test-selection:.*"head":"0123456789abcdef".*"browsers":true.*"visuals":true/);
  assert.equal(report.match(/<img /g)?.length, 14);
  assert.match(report, /desktop-chromium \/ route-13/);
  assert.match(report, /attempt 2/);
});

test("default core failures and selected unexpected skips remain failures", () => {
  const input = fixture(false, false); input.needs["build-web"].result = "failure";
  assert.match(buildReport(input), /One or more reported checks need attention/);
  assert.match(buildReport(input), /Web build \| FAILED/);
  const selected = fixture(); selected.needs["playwright-image-diff"].result = "skipped";
  selected.artifacts = selected.artifacts.filter(a => a.name !== "playwright-image-diff");
  assert.match(buildReport(selected), /Public route image diff \| SKIPPED \| Not generated \(unexpected skip\)/);
  const failedDefault = fixture(false, false); failedDefault.needs["playwright-data-flow"].result = "failure";
  assert.match(buildReport(failedDefault), /Mutation data flow \| FAILED/);
});

test("invalid selection stays UNKNOWN and never relabels skipped jobs NOT SELECTED", () => {
  const input = fixture(false, false); input.needs["visual-selection"].outputs = {};
  const report = buildReport(input);
  assert.match(report, /Browsers selected for this run: UNKNOWN/);
  assert.match(report, /Visuals selected for this run: UNKNOWN/);
  assert.doesNotMatch(report, /NOT SELECTED/);
});

async function publish({ input = fixture(), heads = ["0123456789abcdef"], labels = [[{ name: "ci:visuals" }]], comments = [] } = {}) {
  let reads = 0;
  const updates = [], creates = [], deletes = [], failures = [], methods = {};
  const github = {
    paginate: async method => method === methods.artifacts ? input.artifacts : method === methods.files ? [] : comments,
    rest: {
      pulls: { get: async () => { const index = reads++; return { data: { head: { sha: heads[Math.min(index, heads.length - 1)] }, labels: labels[Math.min(index, labels.length - 1)] } }; }, listFiles: methods.files = () => {} },
      actions: { listWorkflowRunArtifacts: methods.artifacts = () => {} },
      issues: { listComments: methods.comments = () => {}, updateComment: async value => updates.push(value), createComment: async value => creates.push(value), deleteComment: async value => deletes.push(value.comment_id) },
    },
  };
  await updatePrVerificationReport({
    context: { issue: { number: 168 }, repo: { owner: "BASIC-BIT", repo: "VRDex" }, payload: { pull_request: { head: { sha: "0123456789abcdef" } } }, runId: 456, runAttempt: 1 },
    github, core: { warning: assert.fail, info: () => {}, setFailed: message => failures.push(message) }, needs: input.needs,
  });
  return { reads, updates, creates, deletes, failures };
}

test("publisher updates one bot report, removes legacy comments and preserves human comments", async () => {
  const result = await publish({ comments: [
    { id: 1, body: REPORT_MARKER, user: { type: "Bot" } },
    { id: 2, body: LEGACY_MARKERS[0], user: { type: "Bot" } },
    { id: 3, body: LEGACY_MARKERS[1], user: { type: "User" } },
  ] });
  assert.equal(result.updates.length, 1); assert.equal(result.updates[0].comment_id, 1);
  assert.deepEqual(result.deletes, [2]); assert.deepEqual(result.creates, []); assert.deepEqual(result.failures, []);
});

test("old or changed heads never publish stale evidence", async () => {
  for (const heads of [["new-head"], ["0123456789abcdef", "new-head"]]) {
    const result = await publish({ heads });
    assert.deepEqual(result.updates, []); assert.deepEqual(result.creates, []);
  }
});

test("publisher preserves run snapshots when browser or visual selection changes during collection", async () => {
  for (const labels of [[{ name: "ci:browsers" }], [{ name: "ci:visuals" }]]) {
    const result = await publish({ input: fixture(false, false), labels: [[], labels] });
    assert.equal(result.creates.length, 1);
    assert.match(result.creates[0].body, /selection changed since this run/i);
    assert.match(result.creates[0].body, /Browsers selected for this run: no/);
    assert.match(result.creates[0].body, /Visuals selected for this run: no/);
    assert.deepEqual(result.failures, []);
  }
});
