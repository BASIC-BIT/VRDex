"use strict";

const { COMPARISON_JOBS, evaluateVerification, selectVisuals } = require("./visual-ci.cjs");

const REPORT_MARKER = "<!-- vrdex-pr-verification-report -->";
const LEGACY_MARKERS = [
  "<!-- vrdex-playwright-data-flow -->",
  "<!-- vrdex-playwright-hosted-data-flow -->",
  "<!-- vrdex-playwright-public-preview -->",
  "<!-- vrdex-playwright-image-diff -->",
  "<!-- vrdex-storybook-component-preview -->",
  "<!-- vrdex-storybook-image-diff -->",
  "<!-- vrdex-vercel-preview -->",
];

const REPORT_ROWS = [
  { artifact: "playwright-public-smoke", job: "playwright-public-smoke", label: "Public route smoke" },
  {
    artifact: "playwright-data-flow",
    job: "playwright-data-flow",
    label: "Mutation data flow",
  },
  {
    artifact: "playwright-hosted-data-flow",
    job: "playwright-hosted-data-flow",
    label: "Hosted data flow",
    optional: true,
  },
  {
    artifact: "playwright-public-preview",
    job: "playwright-public-preview",
    label: "Public route screenshots",
  },
  {
    artifact: "playwright-image-diff",
    job: "playwright-image-diff",
    label: "Public route image diff",
  },
  {
    artifact: "storybook-component-preview",
    job: "storybook-component-preview",
    label: "Storybook screenshots",
  },
  {
    artifact: "storybook-image-diff",
    job: "storybook-image-diff",
    label: "Storybook image diff",
  },
];

function escapeTableCell(value) {
  return String(value).replaceAll("|", "\\|").replaceAll("\n", " ");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function artifactUrl({ artifact, owner, repo, runId }) {
  return `https://github.com/${owner}/${repo}/actions/runs/${runId}/artifacts/${artifact.id}`;
}

function resultLabel(result) {
  const labels = {
    cancelled: "CANCELLED",
    failure: "FAILED",
    skipped: "SKIPPED",
    success: "PASSED",
  };
  return labels[result] || String(result || "unknown").toUpperCase();
}

function visualBaselineLinks({ files, headSha, owner, repo }) {
  return files
    .filter(({ filename, status }) => {
      if (!["added", "modified", "renamed"].includes(status)) return false;
      return /^apps\/web\/e2e\/__screenshots__\/[^/]+\/.+\.png$/.test(filename);
    })
    .map(({ filename }) => {
      const match = filename.match(
        /^apps\/web\/e2e\/__screenshots__\/([^/]+)\/(.+)\.png$/,
      );
      if (!match) return null;
      const rawPath = filename.split("/").map(encodeURIComponent).join("/");
      return {
        label: `${match[1]} / ${match[2]}`,
        url: `https://raw.githubusercontent.com/${owner}/${repo}/${headSha}/${rawPath}`,
      };
    })
    .filter(Boolean);
}

function visualBaselineGallery(baselines) {
  const rows = [];
  for (let index = 0; index < baselines.length; index += 2) {
    const cells = baselines.slice(index, index + 2).map(({ label, url }) => {
      const safeLabel = escapeHtml(label);
      const safeUrl = escapeHtml(url);
      return [
        '<td width="50%" valign="top">',
        `<strong>${safeLabel}</strong><br>`,
        `<a href="${safeUrl}"><img src="${safeUrl}" alt="${safeLabel}" width="420"></a>`,
        "</td>",
      ].join("");
    });
    rows.push(`<tr>${cells.join("")}</tr>`);
  }
  return ["<table>", ...rows, "</table>"];
}

function buildReport({
  artifacts,
  files = [],
  headSha,
  needs,
  owner,
  repo,
  runAttempt = 1,
  runId,
  selectionChanged = false,
}) {
  const artifactByName = new Map(
    artifacts
      .filter((artifact) => !artifact.expired)
      .map((artifact) => [artifact.name, artifact]),
  );
  const runUrl = `https://github.com/${owner}/${repo}/actions/runs/${runId}`;
  const evaluation = evaluateVerification({ needs, artifacts });
  const rows = REPORT_ROWS.map((row) => {
    const job = needs[row.job] || {};
    const artifact = row.artifact ? artifactByName.get(row.artifact) : null;
    const optionalWasSkipped =
      row.optional && job.result === "success" && job.outputs?.configured === "false";
    const result = optionalWasSkipped ? "skipped" : job.result || "unknown";

    if (COMPARISON_JOBS.has(row.job) && evaluation.selected === false && job.result === "skipped") {
      return `| ${row.label} | NOT SELECTED | Not requested |`;
    }
    const label = evaluation.selected === false ? row.label.replace("screenshots", "assertions only") : row.label;
    let evidence = "Missing evidence";
    if (artifact) {
      evidence = `[Open artifact](${artifactUrl({ artifact, owner, repo, runId })})`;
    } else if (result === "skipped") {
      evidence = optionalWasSkipped ? "Not configured" : "Not generated (unexpected skip)";
    }

    return `| ${escapeTableCell(label)} | ${resultLabel(result)} | ${evidence} |`;
  });

  const needsAttention = evaluation.errors.length > 0;
  const baselines = visualBaselineLinks({ files, headSha, owner, repo });
  const baselineSection =
    baselines.length === 0
      ? ["", "Changed visual baselines: none."]
      : [
          "",
          `<details><summary>Changed visual baselines (${baselines.length})</summary>`,
          "",
          ...visualBaselineGallery(baselines),
          "",
          "</details>",
        ];

  return [
    REPORT_MARKER,
    "## PR verification report",
    "",
    needsAttention
      ? "One or more reported checks need attention."
      : "All configured preview and verification checks passed.",
    "",
    `Visuals selected for this run: ${evaluation.selected === null ? "UNKNOWN" : evaluation.selected ? "yes" : "no (assertions only)"}.`,
    ...(selectionChanged ? ["Visual selection changed since this run. Run results below describe the original selection; request a new normal PR run for current visual evidence.", ""] : []),
    ...(needsAttention ? evaluation.errors.map(error => `- ${error}`) : []),
    "",
    "| Check | Result | Evidence |",
    "| --- | --- | --- |",
    ...rows,
    ...baselineSection,
    "",
    `Updated from [Baseline Checks run ${runId}, attempt ${runAttempt}](${runUrl}) for \`${headSha.slice(0, 7)}\`. This comment is updated in place.`,
  ].join("\n");
}

async function updatePrVerificationReport({ core, context, github, needs }) {
  const owner = context.repo.owner;
  const repo = context.repo.repo;
  const issueNumber = context.issue.number;
  const headSha = context.payload.pull_request.head.sha;
  const { data: current } = await github.rest.pulls.get({ owner, repo, pull_number: issueNumber });
  if (current.head.sha !== headSha) {
    core.info("Ignoring verification evidence for an outdated PR head.");
    return;
  }
  const evaluationSelection = needs["visual-selection"]?.outputs?.selected;

  let artifacts = [];
  let files = [];
  try {
    artifacts = await github.paginate(
      github.rest.actions.listWorkflowRunArtifacts,
      {
        owner,
        repo,
        run_id: context.runId,
        per_page: 100,
      },
    );
  } catch (error) {
    core.warning(`Could not list workflow artifacts: ${error.message}`);
  }
  try {
    files = await github.paginate(github.rest.pulls.listFiles, {
      owner,
      repo,
      pull_number: issueNumber,
      per_page: 100,
    });
  } catch (error) {
    core.warning(`Could not list pull request files: ${error.message}`);
  }

  const evaluation = evaluateVerification({ needs, artifacts });
  if (evaluation.errors.length > 0) core.setFailed(evaluation.errors.join("\n"));
  const comments = await github.paginate(github.rest.issues.listComments, {
    owner,
    repo,
    issue_number: issueNumber,
    per_page: 100,
  });
  const botComments = comments.filter(
    (comment) => comment.user?.type === "Bot",
  );
  const reportComments = botComments.filter((comment) =>
    comment.body?.includes(REPORT_MARKER),
  );
  const existing = reportComments[0];

  const { data: latest } = await github.rest.pulls.get({ owner, repo, pull_number: issueNumber });
  if (latest.head.sha !== headSha) {
    core.info("Ignoring verification evidence because the PR head changed during collection.");
    return;
  }
  const selectionChanged = String(selectVisuals("pull_request", latest.labels)) !== evaluationSelection;
  const body = buildReport({
    artifacts,
    files,
    headSha,
    needs,
    owner,
    repo,
    runAttempt: context.runAttempt,
    runId: context.runId,
    selectionChanged,
  });

  if (existing) {
    await github.rest.issues.updateComment({
      owner,
      repo,
      comment_id: existing.id,
      body,
    });
  } else {
    await github.rest.issues.createComment({
      owner,
      repo,
      issue_number: issueNumber,
      body,
    });
  }

  const obsoleteComments = botComments.filter(
    (comment) =>
      reportComments.slice(1).some(({ id }) => id === comment.id) ||
      LEGACY_MARKERS.some((marker) => comment.body?.includes(marker)),
  );
  for (const comment of obsoleteComments) {
    await github.rest.issues.deleteComment({
      owner,
      repo,
      comment_id: comment.id,
    });
  }
}

module.exports = {
  LEGACY_MARKERS,
  REPORT_MARKER,
  buildReport,
  updatePrVerificationReport,
  visualBaselineGallery,
  visualBaselineLinks,
};
