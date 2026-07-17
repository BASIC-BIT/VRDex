"use strict";

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
  {
    job: "vercel-preview",
    label: "Vercel preview",
    optional: true,
  },
];

function escapeTableCell(value) {
  return String(value).replaceAll("|", "\\|").replaceAll("\n", " ");
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

function buildReport({
  artifacts,
  files = [],
  headSha,
  needs,
  owner,
  repo,
  runAttempt = 1,
  runId,
}) {
  const artifactByName = new Map(
    artifacts
      .filter((artifact) => !artifact.expired)
      .map((artifact) => [artifact.name, artifact]),
  );
  const runUrl = `https://github.com/${owner}/${repo}/actions/runs/${runId}`;
  const rows = REPORT_ROWS.map((row) => {
    const job = needs[row.job] || {};
    const artifact = row.artifact ? artifactByName.get(row.artifact) : null;
    const deploymentUrl =
      row.job === "vercel-preview" ? job.outputs?.["deployment-url"] || "" : "";
    const optionalWasSkipped =
      row.optional &&
      job.result === "success" &&
      ((row.artifact && !artifact) ||
        (row.job === "vercel-preview" && !deploymentUrl));
    const result = optionalWasSkipped ? "skipped" : job.result || "unknown";

    let evidence = "Not generated";
    if (artifact) {
      evidence = `[Open artifact](${artifactUrl({ artifact, owner, repo, runId })})`;
    } else if (deploymentUrl) {
      const links = [
        `[Open preview](${deploymentUrl})`,
        `[Deployment check](${deploymentUrl}/deployment)`,
      ];
      const convexUrl = job.outputs?.["convex-preview-url"];
      if (convexUrl) links.push(`[Convex preview](${convexUrl})`);
      evidence = links.join(" · ");
    } else if (result === "skipped") {
      evidence = "Not configured";
    }

    return `| ${escapeTableCell(row.label)} | ${resultLabel(result)} | ${evidence} |`;
  });

  const needsAttention = REPORT_ROWS.some((row) => {
    const result = needs[row.job]?.result || "unknown";
    return row.optional
      ? !["skipped", "success"].includes(result)
      : result !== "success";
  });
  const baselines = visualBaselineLinks({ files, headSha, owner, repo });
  const shownBaselines = baselines.slice(0, 12);
  const baselineSection =
    baselines.length === 0
      ? ["", "Changed visual baselines: none."]
      : [
          "",
          `<details><summary>Changed visual baselines (${baselines.length})</summary>`,
          "",
          ...shownBaselines.map(({ label, url }) => `- [${label}](${url})`),
          ...(baselines.length > shownBaselines.length
            ? [
                `- ${baselines.length - shownBaselines.length} more in the image-diff artifacts`,
              ]
            : []),
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

  const body = buildReport({
    artifacts,
    files,
    headSha,
    needs,
    owner,
    repo,
    runAttempt: context.runAttempt,
    runId: context.runId,
  });
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
  visualBaselineLinks,
};
