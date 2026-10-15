"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const { selectVisuals, evaluateVerification } = require("./visual-ci.cjs");

function fixture(selected) {
  const needs = {
    "visual-selection": { result: "success", outputs: { selected: String(selected) } },
    "playwright-public-smoke": { result: "success" },
    "playwright-data-flow": { result: "success" },
    "playwright-hosted-data-flow": { result: "success", outputs: { configured: "false" } },
    "playwright-public-preview": { result: "success" },
    "storybook-component-preview": { result: "success" },
    "playwright-image-diff": { result: selected ? "success" : "skipped" },
    "storybook-image-diff": { result: selected ? "success" : "skipped" },
  };
  const artifacts = ["playwright-public-smoke", "playwright-data-flow", "playwright-public-preview", "storybook-component-preview", ...(selected ? ["playwright-image-diff", "storybook-image-diff"] : [])].map(name => ({ name, id: name, expired: false }));
  return { needs, artifacts };
}

test("only labelled PRs select visuals, independently of file paths", () => {
  assert.equal(selectVisuals("pull_request", [{ name: "ci:visuals" }]), true);
  assert.equal(selectVisuals("pull_request", []), false);
  assert.equal(selectVisuals("push", [{ name: "ci:visuals" }]), false);
  assert.equal(selectVisuals("workflow_dispatch", [{ name: "ci:visuals" }]), false);
});

test("default run requires browser assertions and expects comparison skips", () => {
  assert.deepEqual(evaluateVerification(fixture(false)).errors, []);
  const input = fixture(false);
  input.needs["playwright-public-preview"].result = "skipped";
  assert.match(evaluateVerification(input).errors.join(" "), /playwright-public-preview/);
});

test("selected comparisons cannot fail, cancel, unexpectedly skip, or omit evidence", () => {
  assert.deepEqual(evaluateVerification(fixture(true)).errors, []);
  for (const result of ["failure", "cancelled", "skipped", ""]) {
    const input = fixture(true);
    input.needs["playwright-image-diff"].result = result;
    assert.match(evaluateVerification(input).errors.join(" "), /playwright-image-diff/);
  }
  const input = fixture(true);
  input.artifacts = input.artifacts.filter(a => a.name !== "storybook-image-diff");
  assert.match(evaluateVerification(input).errors.join(" "), /storybook-image-diff.*artifact/);
});

test("invalid selection fails closed and expired artifacts are missing evidence", () => {
  const input = fixture(false);
  input.needs["visual-selection"].outputs.selected = "";
  assert.match(evaluateVerification(input).errors.join(" "), /selection/i);
  const expired = fixture(false);
  expired.artifacts[0].expired = true;
  assert.match(evaluateVerification(expired).errors.join(" "), /playwright-public-smoke.*artifact/);
});

test("hosted absence must be explicit and a configured hosted failure stays failed", () => {
  const input = fixture(false);
  delete input.needs["playwright-hosted-data-flow"].outputs.configured;
  assert.match(evaluateVerification(input).errors.join(" "), /hosted/);
  input.needs["playwright-hosted-data-flow"].outputs.configured = "true";
  input.needs["playwright-hosted-data-flow"].result = "failure";
  assert.match(evaluateVerification(input).errors.join(" "), /hosted/);
});
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
test("preview evidence must match selection, including all-tests-skipped runs", () => {
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
