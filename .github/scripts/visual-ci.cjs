"use strict";

const CORE_JOBS = ["lint-web", "verify-docs", "verify-api-mcp", "typecheck-web", "typecheck-backend", "verify-backend-local", "restream-local-checks", "build-web"];
const BROWSER_JOBS = ["playwright-public-smoke", "playwright-data-flow", "playwright-hosted-data-flow", "playwright-public-preview", "storybook-component-preview"];
const COMPARISON_JOBS = new Set(["playwright-image-diff", "storybook-image-diff"]);

function selectEvidence(eventName, labels) {
  const visuals = eventName === "pull_request" && labels.some(label => label.name === "ci:visuals");
  const browsers = eventName === "pull_request" && (visuals || labels.some(label => label.name === "ci:browsers"));
  return { browsers, visuals };
}

function evaluateVerification({ needs, artifacts }) {
  const errors = [];
  const selection = needs["visual-selection"];
  const outputs = selection?.outputs;
  const validSelection = selection?.result === "success"
    && ["true", "false"].includes(outputs?.browsers)
    && ["true", "false"].includes(outputs?.visuals)
    && !(outputs.visuals === "true" && outputs.browsers !== "true");
  const browsers = validSelection ? outputs.browsers === "true" : null;
  const visuals = validSelection ? outputs.visuals === "true" : null;
  if (!validSelection) errors.push("Browser/visual selection is missing, invalid or inconsistent.");
  const available = new Set(artifacts.filter(artifact => !artifact.expired).map(artifact => artifact.name));
  function requireSuccess(job, artifactRequired = false) {
    if (needs[job]?.result !== "success") errors.push(`${job} must succeed; received ${needs[job]?.result || "unknown"}.`);
    if (artifactRequired && !available.has(job)) errors.push(`${job} has no current run artifact.`);
  }
  function requireSkip(job, coverage) {
    if (needs[job]?.result !== "skipped") errors.push(`${job} must skip when ${coverage} are not selected.`);
  }
  for (const job of CORE_JOBS) requireSuccess(job);
  if (browsers === true) {
    requireSuccess("build-storybook");
    for (const job of BROWSER_JOBS) {
      if (job !== "playwright-hosted-data-flow") requireSuccess(job, true);
    }
    const hosted = needs["playwright-hosted-data-flow"];
    requireSuccess("playwright-hosted-data-flow");
    if (hosted?.result === "success") {
      if (hosted.outputs?.configured === "true") requireSuccess("playwright-hosted-data-flow", true);
      else if (hosted.outputs?.configured !== "false") errors.push("playwright-hosted-data-flow configuration outcome is unknown.");
    }
  } else if (browsers === false) {
    for (const job of [...BROWSER_JOBS, "build-storybook"]) requireSkip(job, "browsers");
  }
  for (const job of COMPARISON_JOBS) {
    if (visuals === true) requireSuccess(job, true);
    else if (visuals === false) requireSkip(job, "visuals");
  }
  return { browsers, visuals, errors };
}

function checkReviewCaptures(directory, selected) {
  const fs = require("node:fs");
  const count = fs.existsSync(directory)
    ? fs.readdirSync(directory, { recursive: true, withFileTypes: true }).filter(entry => entry.isFile() && entry.name.endsWith(".png")).length
    : 0;
  if (selected && count === 0) throw new Error("No review screenshots were generated for a selected capture run.");
  if (!selected && count > 0) throw new Error("Review screenshots were written while capture was disabled.");
  return count;
}

module.exports = { CORE_JOBS, BROWSER_JOBS, COMPARISON_JOBS, selectEvidence, evaluateVerification, checkReviewCaptures };

if (require.main === module) {
  const fs = require("node:fs");
  if (process.argv[2] === "--check-captures") {
    const value = process.env.PLAYWRIGHT_CAPTURE_SCREENSHOTS;
    if (!["true", "false"].includes(value)) throw new Error("Capture selection must be explicitly true or false in CI.");
    const count = checkReviewCaptures(process.argv[3], value === "true");
    console.log(`Review PNGs: ${count}; capture selected: ${value}`);
  } else {
    const event = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
    const { browsers, visuals } = selectEvidence(process.env.GITHUB_EVENT_NAME, event.pull_request?.labels || []);
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `browsers=${browsers}\nvisuals=${visuals}\n`);
  }
}
