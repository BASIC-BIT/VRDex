"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  LEGACY_MARKERS,
  REPORT_MARKER,
  buildReport,
  updatePrVerificationReport,
} = require("./pr-verification-report.cjs");

function successfulNeeds() {
  return {
    "playwright-data-flow": { outputs: {}, result: "success" },
    "playwright-hosted-data-flow": { outputs: {}, result: "success" },
    "playwright-image-diff": { outputs: {}, result: "success" },
    "playwright-public-preview": { outputs: {}, result: "success" },
    "storybook-component-preview": { outputs: {}, result: "success" },
    "storybook-image-diff": { outputs: {}, result: "success" },
    "vercel-preview": {
      outputs: {
        "convex-preview-url": "https://example.convex.cloud",
        "deployment-url": "https://preview.example.com",
      },
      result: "success",
    },
  };
}

test("buildReport collates checks, artifacts, previews, and changed baselines", () => {
  const baselineFiles = Array.from({ length: 14 }, (_, index) => ({
    filename: `apps/web/e2e/__screenshots__/desktop-chromium/route-${index}.png`,
    status: "modified",
  }));
  const report = buildReport({
    artifacts: [
      { expired: false, id: 101, name: "playwright-data-flow" },
      { expired: false, id: 102, name: "playwright-image-diff" },
    ],
    files: baselineFiles,
    headSha: "0123456789abcdef",
    needs: successfulNeeds(),
    owner: "BASIC-BIT",
    repo: "VRDex",
    runAttempt: 2,
    runId: 456,
  });

  assert.match(report, new RegExp(REPORT_MARKER));
  assert.match(report, /Mutation data flow \| PASSED \| \[Open artifact\]/);
  assert.match(report, /Hosted data flow \| SKIPPED \| Not configured/);
  assert.match(report, /\[Open preview\]\(https:\/\/preview\.example\.com\)/);
  assert.match(report, /<details><summary>Changed visual baselines \(14\)<\/summary>/);
  assert.equal(report.match(/<img /g)?.length, 14);
  assert.match(report, /desktop-chromium \/ route-0/);
  assert.match(report, /desktop-chromium \/ route-13/);
  assert.doesNotMatch(report, /more in the image-diff artifacts/);
  assert.match(report, /attempt 2/);
});

test("buildReport calls out a skipped required check", () => {
  const needs = successfulNeeds();
  needs["playwright-public-preview"].result = "skipped";

  const report = buildReport({
    artifacts: [],
    headSha: "0123456789abcdef",
    needs,
    owner: "BASIC-BIT",
    repo: "VRDex",
    runId: 456,
  });

  assert.match(report, /One or more reported checks need attention/);
  assert.match(report, /Public route screenshots \| SKIPPED/);
});

test("updatePrVerificationReport updates one report and deletes legacy comments", async () => {
  const updated = [];
  const deleted = [];
  const methods = {};
  const github = {
    paginate: async (method) => {
      if (method === methods.listWorkflowRunArtifacts) return [];
      if (method === methods.listFiles) return [];
      return [
        { body: `${REPORT_MARKER}\nold`, id: 1, user: { type: "Bot" } },
        { body: `${LEGACY_MARKERS[0]}\nold`, id: 2, user: { type: "Bot" } },
        { body: `${LEGACY_MARKERS[1]}\nhuman`, id: 3, user: { type: "User" } },
      ];
    },
    rest: {
      actions: {
        listWorkflowRunArtifacts: (methods.listWorkflowRunArtifacts = () => {}),
      },
      issues: {
        createComment: async () =>
          assert.fail("existing report should be updated"),
        deleteComment: async ({ comment_id }) => deleted.push(comment_id),
        listComments: (methods.listComments = () => {}),
        updateComment: async (input) => updated.push(input),
      },
      pulls: {
        listFiles: (methods.listFiles = () => {}),
      },
    },
  };
  const context = {
    issue: { number: 168 },
    payload: { pull_request: { head: { sha: "0123456789abcdef" } } },
    repo: { owner: "BASIC-BIT", repo: "VRDex" },
    runAttempt: 1,
    runId: 456,
  };

  await updatePrVerificationReport({
    context,
    core: { warning: assert.fail },
    github,
    needs: successfulNeeds(),
  });

  assert.equal(updated.length, 1);
  assert.equal(updated[0].comment_id, 1);
  assert.deepEqual(deleted, [2]);
});
