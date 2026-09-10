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

  it("names the deployed SHA in the preview comment", () => {
    const post = deploySteps.find((step) => step.name === "Post preview comment");
    assert.ok(post);
    assert.ok(JSON.stringify(post).includes("head_sha"));
  });
});
