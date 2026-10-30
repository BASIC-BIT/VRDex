import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { describe, it } from "node:test";

import { parse as parseYaml } from "yaml";

/**
 * GitHub validates workflow syntax at dispatch time, not in any check we run,
 * so a malformed workflow ships green and only fails when somebody tries to use
 * it. Deleting a `workflow_dispatch` input left its `default:` line behind
 * once, which turned the staging deploy into an invalid workflow that every
 * check still passed over.
 */
describe("workflow definitions", () => {
  it("parses every workflow and defines every dispatch input as a mapping", async () => {
    const directory = ".github/workflows";
    const files = (await readdir(directory)).filter((name) => /\.ya?ml$/.test(name));

    assert.ok(files.length > 0, "No workflow files were found.");

    for (const file of files) {
      const source = await readFile(`${directory}/${file}`, "utf8");
      let document: unknown;

      try {
        document = parseYaml(source);
      } catch (error) {
        assert.fail(`${file} is not valid YAML: ${(error as Error).message}`);
      }

      // `on` is the YAML 1.1 boolean `true`, which the parser may hand back
      // under either key depending on the schema in force.
      const triggers = (document as Record<string, unknown>)?.on
        ?? (document as Record<string, unknown>)?.["true"];
      const dispatch = (triggers as Record<string, unknown> | undefined)?.workflow_dispatch;
      const inputs = (dispatch as Record<string, unknown> | undefined)?.inputs;

      if (inputs === undefined || inputs === null) {
        continue;
      }

      assert.equal(
        typeof inputs === "object" && !Array.isArray(inputs),
        true,
        `${file} declares workflow_dispatch.inputs that is not a mapping.`,
      );

      for (const [name, definition] of Object.entries(inputs as Record<string, unknown>)) {
        assert.equal(
          definition !== null && typeof definition === "object" && !Array.isArray(definition),
          true,
          `${file} input "${name}" is not an input definition mapping.`,
        );
        assert.equal(
          typeof (definition as Record<string, unknown>).type === "string",
          true,
          `${file} input "${name}" is missing a type.`,
        );
      }
    }
  });
});

type WorkflowStep = { name?: string; if?: string; env?: Record<string, string> };
type Workflow = {
  jobs: Record<
    string,
    { if?: string; outputs?: Record<string, string>; steps?: WorkflowStep[] }
  >;
};

const loadWorkflow = (path: string) => parseYaml(readFileSync(path, "utf8")) as Workflow;

/**
 * Fork heads reach these workflows only through a maintainer's `@vrdex preview`
 * comment, and even then they must build without the hosted end-to-end browser
 * token or the helper flags that unlock authenticated preview runtime secrets.
 */
describe("fork-aware preview workflows", () => {
  const commentPath = ".github/workflows/vercel-preview-comment.yml";
  const deployPath = ".github/workflows/vercel-preview-deploy.yml";
  const deploy = loadWorkflow(deployPath);
  const deploySteps = deploy.jobs["deploy-preview"].steps ?? [];
  const raw = {
    comment: readFileSync(commentPath, "utf8"),
    deploy: readFileSync(deployPath, "utf8"),
  };
  // `on` is the YAML 1.1 boolean `true` under some schemas; see the parse test.
  const deployDocument = parseYaml(raw.deploy) as Record<string, unknown>;

  it("no longer rejects fork heads", () => {
    assert.ok(!raw.comment.includes("Mirror a fork PR"));
    assert.ok(!raw.deploy.includes("Mirror a fork PR"));
  });

  it("never uses pull_request_target", () => {
    assert.ok(!raw.comment.includes("pull_request_target"));
    assert.ok(!raw.deploy.includes("pull_request_target"));
  });

  it("exposes is_fork from the resolve step", () => {
    assert.equal(
      deploy.jobs["deploy-preview"].outputs?.is_fork,
      "${{ steps.pr.outputs.is_fork }}",
    );
  });

  it("withholds hosted e2e secrets from fork heads", () => {
    const hosted = [
      "VRDEX_HOSTED_E2E_BROWSER_TOKEN",
      "VRDEX_HOSTED_E2E_AUTH_HELPERS",
      "VRDEX_HOSTED_E2E_DEVELOPER_CREDENTIALS",
    ];

    for (const step of deploySteps) {
      const gatedByIf = step.if?.includes("steps.pr.outputs.is_fork == 'false'") ?? false;

      for (const [name, value] of Object.entries(step.env ?? {})) {
        if (!hosted.some((secret) => String(value).includes(secret))) continue;

        // Either the whole step is skipped for fork heads, or the expression
        // itself resolves to an empty string there. Anything else lets a real
        // token value reach a fork build.
        const blanked = String(value).includes("is_fork == 'false' &&");
        assert.ok(
          gatedByIf || blanked,
          `${step.name ?? "(unnamed step)"} env ${name} must be gated on is_fork`,
        );
      }
    }

    const smoke = deploy.jobs["hosted-mcp-preview-smoke"];
    assert.ok(String(smoke.if).includes("needs.deploy-preview.outputs.is_fork == 'false'"));
  });

  // The maintainer reviews a commit, then comments. Without the SHA travelling
  // with the dispatch, a push landing in between is what actually gets built.
  it("pins the reviewed SHA at trigger time", () => {
    const dispatch = raw.comment.slice(raw.comment.indexOf("createWorkflowDispatch"));
    const start = dispatch.indexOf("inputs: {");
    assert.ok(start >= 0, "comment workflow does not pass dispatch inputs");
    assert.match(dispatch.slice(start, dispatch.indexOf("},", start)), /head_sha:/);

    const triggers = (deployDocument.on ?? deployDocument["true"]) as Record<
      string,
      { inputs?: Record<string, unknown> } | undefined
    >;
    for (const trigger of ["workflow_dispatch", "workflow_call"]) {
      assert.ok(
        triggers[trigger]?.inputs?.head_sha,
        `${trigger} does not declare a head_sha input`,
      );
    }
  });

  // A bare Actions-tab dispatch has no reviewed SHA, so a fork push landing
  // before the job resolves the PR would otherwise build with our secrets.
  it("refuses fork heads when the dispatch carries no head_sha", () => {
    const resolve = deploySteps.find((step) => step.name === "Resolve pull request");
    assert.ok(resolve);
    assert.ok(String(resolve.with?.script).includes("require the reviewed head_sha"));
  });

  it("names the deployed SHA in the preview comment", () => {
    const post = deploySteps.find((step) => step.name === "Post preview comment");
    assert.ok(post);
    assert.ok(JSON.stringify(post).includes("head_sha"));
  });
});


describe("optional browser and visual evidence contract", () => {
  const workflow = parseYaml(readFileSync(".github/workflows/baseline-checks.yml", "utf8"));
  it("selects all browser consumers and Storybook build without changing normal trigger or deploy controls", () => {
    assert.deepEqual(workflow.on.pull_request.types, ["opened", "synchronize", "reopened", "ready_for_review"]);
    assert.equal(workflow.on.workflow_dispatch, undefined);
    assert.equal(workflow.jobs["visual-selection"].outputs.browsers, "${{ steps.selection.outputs.browsers }}");
    assert.equal(workflow.jobs["visual-selection"].outputs.visuals, "${{ steps.selection.outputs.visuals }}");
    for (const name of ["playwright-public-smoke", "playwright-data-flow", "playwright-hosted-data-flow", "playwright-public-preview", "storybook-component-preview", "build-storybook"]) {
      const job = workflow.jobs[name];
      assert.ok(job.needs.includes("visual-selection"), name);
      assert.ok(job.if.includes("needs.visual-selection.outputs.browsers == 'true'"), name);
      assert.ok(job.if.includes("github.event_name == 'pull_request'"), name);
      assert.equal(job["continue-on-error"], undefined);
    }
    for (const name of ["playwright-public-preview", "storybook-component-preview"]) {
      assert.equal(workflow.jobs[name].env?.PLAYWRIGHT_CAPTURE_SCREENSHOTS, "${{ needs.visual-selection.outputs.visuals }}");
    }
    for (const name of ["playwright-image-diff", "storybook-image-diff"]) {
      const job = workflow.jobs[name];
      assert.equal(job.if, "github.event_name == 'pull_request' && needs.visual-selection.outputs.visuals == 'true'");
      assert.equal(job["continue-on-error"], undefined);
    }
    for (const name of ["lint-web", "verify-docs", "verify-api-mcp", "typecheck-web", "typecheck-backend", "verify-backend-local", "restream-local-checks", "build-web", "build-storybook"]) {
      assert.ok(workflow.jobs["pr-verification-report"].needs.includes(name), name);
      if (name !== "build-storybook") {
        assert.equal(workflow.jobs[name].if, undefined, name);
        assert.ok(!(workflow.jobs[name].needs ?? []).includes("visual-selection"), name);
      }
    }
    assert.equal(workflow.jobs["deploy-convex-production"].if, "github.event_name == 'push' && github.ref == 'refs/heads/main'");
    assert.deepEqual(workflow.jobs["deploy-convex-production"].needs, ["build-web"]);
    assert.ok(workflow.jobs["playwright-hosted-data-flow"].if.includes("head.repo.fork == false"));
    const account = workflow.jobs["playwright-hosted-data-flow"].steps.find((step: { name?: string }) => step.name === "Run signed-in account assertions and selected captures");
    assert.equal(account.env.PLAYWRIGHT_CAPTURE_SCREENSHOTS, "${{ needs.visual-selection.outputs.visuals }}");
  });
  it("requires real current-branch claim coverage on a local backend without exposing keys to forks", () => {
    assert.equal(workflow.jobs["playwright-data-flow"]["timeout-minutes"], 30, "Budget includes existing flows, composed media coverage, and artifacts");
    const steps = workflow.jobs["playwright-data-flow"].steps;
    const audioPrepare = steps.findIndex((step: { name?: string }) => step.name === "Prepare local browser audio backend");
    const media = steps.findIndex((step: { name?: string }) => step.name === "Run isolated composed media acceptance");
    const audioCleanup = steps.findIndex((step: { name?: string }) => step.name === "Stop job-owned browser audio backend");
    assert.ok(audioPrepare >= 0 && audioPrepare < media && audioCleanup > media);
    assert.equal(steps[audioCleanup].if, "always()");
    const claim = steps.find((step: { id?: string }) => step.id === "claim-auth");
    assert.ok(claim, "The current-branch signed-in claim regression must have a CI execution target");
    assert.equal(claim.if, "github.event.pull_request.head.repo.fork == false");
    assert.equal(claim.env.PLAYWRIGHT_BASE_URL, undefined, "Do not route the new contract to stale hosted staging");
    assert.equal(claim.env.VRDEX_ENABLE_E2E_CLERK_AUTH, "true");
    assert.equal(claim.env.VRDEX_ENABLE_E2E_AUTH_HELPERS, "true");
    assert.equal(claim.env.VRDEX_ENABLE_E2E_ADAPTER_HELPERS, "true");
    assert.equal(claim.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY, "${{ secrets.VRDEX_HOSTED_E2E_CLERK_PUBLISHABLE_KEY }}");
    assert.equal(claim.env.CLERK_SECRET_KEY, "${{ secrets.VRDEX_HOSTED_E2E_CLERK_SECRET_KEY }}");
    assert.equal(claim.env.CLERK_JWT_ISSUER_DOMAIN, "${{ vars.VRDEX_STAGING_CLERK_JWT_ISSUER_DOMAIN }}");
    assert.ok(claim.run.includes("check-clerk-issuer-match.mjs"));
    assert.ok(claim.run.includes("auth-claim.flow.spec.ts"));
    assert.ok(steps.indexOf(claim) < steps.findIndex((step: { id?: string }) => step.id === "flow"), "Run narrow auth before the broad suite consumes the job budget");
    assert.ok(claim.run.includes("stats.expected !== 1") && claim.run.includes("stats.skipped !== 0"), "Skipped coverage must fail");
    const upload = steps.find((step: { id?: string }) => step.id === "upload");
    assert.ok(upload.with.path.includes(claim.env.PLAYWRIGHT_OUTPUT_DIR));
    assert.ok(upload.with.path.includes(claim.env.PLAYWRIGHT_HTML_REPORT_DIR));
  });
  it("keeps existing functional diagnostic captures independent of review selection", () => {
    for (const name of ["playwright-public-smoke", "playwright-data-flow", "playwright-hosted-data-flow"]) {
      assert.equal(workflow.jobs[name].env?.PLAYWRIGHT_CAPTURE_SCREENSHOTS, undefined, name);
    }
  });
  it("executes removal, selection and report contracts after Linux core dependencies are installed", () => {
    const steps = workflow.jobs["verify-api-mcp"].steps;
    const install = steps.findIndex((step: { name?: string }) => step.name === "Install dependencies");
    const contracts = steps.findIndex((step: { run?: string }) => step.run?.includes("visual-label-removal.test.cjs"));
    assert.ok(install >= 0 && contracts > install, "trusted removal handler contracts must execute with yaml installed");
    for (const file of ["visual-ci.test.cjs", "pr-verification-report.test.cjs", "visual-label-removal.test.cjs"]) {
      assert.ok(steps[contracts].run.includes(file));
    }
  });
  it("either selector removal uses trusted inline code and cannot launch the app pipeline", () => {
    const optOut = parseYaml(readFileSync(".github/workflows/visual-evidence-opt-out.yml", "utf8"));
    assert.deepEqual(optOut.on.pull_request_target.types, ["unlabeled"]);
    const job = optOut.jobs["invalidate-evidence"];
    assert.ok(job.if.includes("ci:browsers")); assert.ok(job.if.includes("ci:visuals"));
    assert.equal(job.steps.length, 1);
    assert.equal(job.steps[0].uses, "actions/github-script@v9");
    assert.equal(job.concurrency.group, workflow.jobs["pr-verification-report"].concurrency.group);
    assert.doesNotMatch(JSON.stringify(job), /actions\/checkout|workflow_dispatch|createWorkflowDispatch/);
  });
});
