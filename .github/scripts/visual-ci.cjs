"use strict";

const COMPARISON_JOBS = new Set(["playwright-image-diff", "storybook-image-diff"]);
const REQUIRED_JOBS = ["playwright-public-smoke", "playwright-data-flow", "playwright-public-preview", "storybook-component-preview"];

function selectVisuals(eventName, labels) {
  return eventName === "pull_request" && labels.some(label => label.name === "ci:visuals");
}

function evaluateVerification({ needs, artifacts }) {
  const errors = [];
  const selection = needs["visual-selection"];
  const value = selection?.outputs?.selected;
  const selected = value === "true";
  if (selection?.result !== "success" || !["true", "false"].includes(value)) {
    errors.push("Visual selection is missing or invalid.");
  }
  const available = new Set(artifacts.filter(artifact => !artifact.expired).map(artifact => artifact.name));
  function requireSuccess(job) {
    if (needs[job]?.result !== "success") errors.push(`${job} must succeed; received ${needs[job]?.result || "unknown"}.`);
    if (!available.has(job)) errors.push(`${job} has no current run artifact.`);
  }
  for (const job of REQUIRED_JOBS) requireSuccess(job);
  for (const job of COMPARISON_JOBS) {
    if (selected) requireSuccess(job);
    else if (needs[job]?.result !== "skipped") errors.push(`${job} must skip when visuals are not selected.`);
  }
  const hosted = needs["playwright-hosted-data-flow"];
  if (hosted?.result !== "success") errors.push("playwright-hosted-data-flow did not succeed.");
  else if (hosted.outputs?.configured === "true") requireSuccess("playwright-hosted-data-flow");
  else if (hosted.outputs?.configured !== "false") errors.push("playwright-hosted-data-flow configuration outcome is unknown.");
  return { selected, errors };
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

module.exports = { COMPARISON_JOBS, selectVisuals, evaluateVerification, checkReviewCaptures };

if (require.main === module) {
  const fs = require("node:fs");
  if (process.argv[2] === "--check-captures") {
    const value = process.env.PLAYWRIGHT_CAPTURE_SCREENSHOTS;
    if (!["true", "false"].includes(value)) throw new Error("Capture selection must be explicitly true or false in CI.");
    const count = checkReviewCaptures(process.argv[3], value === "true");
    console.log(`Review PNGs: ${count}; capture selected: ${value}`);
  } else {
    const event = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
    const selected = selectVisuals(process.env.GITHUB_EVENT_NAME, event.pull_request?.labels || []);
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `selected=${selected}\n`);
  }
}
