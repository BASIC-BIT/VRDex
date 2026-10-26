"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const { selectEvidence, evaluateVerification } = require("./visual-ci.cjs");
const coreJobs = ["lint-web", "verify-docs", "verify-api-mcp", "typecheck-web", "typecheck-backend", "verify-backend-local", "restream-local-checks", "build-web"];
const browserJobs = ["playwright-public-smoke", "playwright-data-flow", "playwright-public-preview", "storybook-component-preview"];
const comparisons = ["playwright-image-diff", "storybook-image-diff"];
function fixture({ browsers = false, visuals = false } = {}) {
  const needs = Object.fromEntries(coreJobs.map(job => [job, { result: "success" }]));
  needs["visual-selection"] = { result: "success", outputs: { browsers: String(browsers), visuals: String(visuals) } };
  needs["build-storybook"] = { result: browsers ? "success" : "skipped" };
  for (const job of browserJobs) needs[job] = { result: browsers ? "success" : "skipped" };
  needs["playwright-hosted-data-flow"] = { result: browsers ? "success" : "skipped", outputs: browsers ? { configured: "false" } : {} };
  for (const job of comparisons) needs[job] = { result: visuals ? "success" : "skipped" };
  const artifacts = [...(browsers ? browserJobs : []), ...(visuals ? comparisons : [])].map(name => ({ name, id: name, expired: false }));
  return { needs, artifacts };
}

test("PR labels select three modes, with visuals implying browsers", () => {
  assert.equal(typeof selectEvidence, "function");
  for (const [labels, expected] of [
    [[], { browsers: false, visuals: false }],
    [[{ name: "ci:browsers" }], { browsers: true, visuals: false }],
    [[{ name: "ci:visuals" }], { browsers: true, visuals: true }],
    [[{ name: "ci:browsers" }, { name: "ci:visuals" }], { browsers: true, visuals: true }],
  ]) {
    assert.deepEqual(selectEvidence("pull_request", labels), expected);
    for (const event of ["push", "workflow_dispatch", "pull_request_target"]) {
      assert.deepEqual(selectEvidence(event, labels), { browsers: false, visuals: false });
    }
  }
});

test("default runs require core checks and expect all browsers and Storybook build to skip", () => {
  assert.deepEqual(evaluateVerification(fixture()), { browsers: false, visuals: false, errors: [] });
  for (const job of [...coreJobs, "visual-selection"]) {
    for (const result of ["failure", "cancelled", "skipped", ""]) {
      const input = fixture(); input.needs[job].result = result;
      assert.ok(evaluateVerification(input).errors.length > 0, `${job}:${result}`);
    }
  }
  for (const job of [...browserJobs, "playwright-hosted-data-flow", ...comparisons, "build-storybook"]) {
    for (const result of ["success", "failure", "cancelled", ""]) {
      const input = fixture(); input.needs[job].result = result;
      assert.match(evaluateVerification(input).errors.join(" "), new RegExp(job));
    }
  }
});

test("browsers-only requires every assertion producer and Storybook build but skips comparisons", () => {
  assert.deepEqual(evaluateVerification(fixture({ browsers: true })).errors, []);
  for (const job of [...browserJobs, "playwright-hosted-data-flow", "build-storybook"]) {
    for (const result of ["failure", "cancelled", "skipped", ""]) {
      const input = fixture({ browsers: true }); input.needs[job].result = result;
      assert.match(evaluateVerification(input).errors.join(" "), new RegExp(job));
    }
  }
  for (const job of browserJobs) {
    const input = fixture({ browsers: true }); input.artifacts = input.artifacts.filter(a => a.name !== job);
    assert.match(evaluateVerification(input).errors.join(" "), new RegExp(`${job}.*artifact`));
  }
});

test("visuals requires both comparisons and their current artifacts", () => {
  assert.deepEqual(evaluateVerification(fixture({ browsers: true, visuals: true })).errors, []);
  for (const job of comparisons) {
    for (const result of ["failure", "cancelled", "skipped", ""]) {
      const input = fixture({ browsers: true, visuals: true }); input.needs[job].result = result;
      assert.match(evaluateVerification(input).errors.join(" "), new RegExp(job));
    }
    const input = fixture({ browsers: true, visuals: true }); input.artifacts = input.artifacts.filter(a => a.name !== job);
    assert.match(evaluateVerification(input).errors.join(" "), new RegExp(`${job}.*artifact`));
  }
});

test("invalid or inconsistent selection is UNKNOWN and fails closed", () => {
  for (const outputs of [{}, { browsers: "", visuals: "false" }, { browsers: "true", visuals: "" }, { browsers: "false", visuals: "true" }]) {
    const input = fixture(); input.needs["visual-selection"].outputs = outputs;
    const evaluated = evaluateVerification(input);
    assert.equal(evaluated.browsers, null); assert.equal(evaluated.visuals, null);
    assert.match(evaluated.errors.join(" "), /selection/i);
  }
  const input = fixture({ browsers: true }); input.artifacts[0].expired = true;
  assert.match(evaluateVerification(input).errors.join(" "), /playwright-public-smoke.*artifact/);
});

test("hosted configuration is required only when browsers are selected", () => {
  assert.deepEqual(evaluateVerification(fixture()).errors, []);
  const input = fixture({ browsers: true });
  delete input.needs["playwright-hosted-data-flow"].outputs.configured;
  assert.match(evaluateVerification(input).errors.join(" "), /hosted/);
  input.needs["playwright-hosted-data-flow"].outputs.configured = "true";
  assert.match(evaluateVerification(input).errors.join(" "), /hosted.*artifact/);
  input.artifacts.push({ name: "playwright-hosted-data-flow", id: 1 });
  assert.deepEqual(evaluateVerification(input).errors, []);
});

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
test("preview evidence must match capture selection, including all-tests-skipped runs", () => {
  const { checkReviewCaptures } = require("./visual-ci.cjs");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "visual-capture-"));
  try {
    assert.throws(() => checkReviewCaptures(directory, true), /No review screenshots/);
    assert.equal(checkReviewCaptures(directory, false), 0);
    fs.writeFileSync(path.join(directory, "review.png"), "image");
    assert.equal(checkReviewCaptures(directory, true), 1);
    assert.throws(() => checkReviewCaptures(directory, false), /disabled/);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test("CLI snapshots event labels into both workflow outputs", () => {
  const { execFileSync } = require("node:child_process");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ci-selection-"));
  try {
    for (const [names, expected] of [[[], "browsers=false\nvisuals=false\n"], [["ci:browsers"], "browsers=true\nvisuals=false\n"], [["ci:visuals"], "browsers=true\nvisuals=true\n"]]) {
      const event = path.join(directory, "event.json"), output = path.join(directory, "output");
      fs.writeFileSync(event, JSON.stringify({ pull_request: { labels: names.map(name => ({ name })) } }));
      fs.writeFileSync(output, "");
      execFileSync(process.execPath, [path.join(__dirname, "visual-ci.cjs")], { env: { ...process.env, GITHUB_EVENT_NAME: "pull_request", GITHUB_EVENT_PATH: event, GITHUB_OUTPUT: output } });
      assert.equal(fs.readFileSync(output, "utf8"), expected);
    }
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
