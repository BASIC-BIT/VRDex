import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

function runPrereqs(args: string[], ghCommand: string[]) {
  return spawnSync(
    process.execPath,
    ["--import", "tsx", "scripts/check-hosted-mcp-oauth-github-prereqs.ts", "--", ...args],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        VRDEX_HOSTED_MCP_OAUTH_PREREQS_GH_COMMAND: JSON.stringify(ghCommand),
      },
    },
  );
}

async function writeFakeGh(directory: string, variables: unknown[], secrets: unknown[]) {
  const scriptPath = join(directory, "fake-gh.mjs");

  await writeFile(
    scriptPath,
    [
      "const args = process.argv.slice(2);",
      "if (args.includes('variable') && args.includes('list')) {",
      `  console.log(${JSON.stringify(JSON.stringify(variables))});`,
      "  process.exit(0);",
      "}",
      "if (args.includes('secret') && args.includes('list')) {",
      `  console.log(${JSON.stringify(JSON.stringify(secrets))});`,
      "  process.exit(0);",
      "}",
      "console.error(`unexpected gh args: ${args.join(' ')}`);",
      "process.exit(2);",
    ].join("\n"),
    "utf8",
  );

  return [process.execPath, scriptPath];
}

describe("hosted MCP OAuth GitHub prerequisites audit", () => {
  it("passes readiness when reviewed OAuth client secrets exist", async () => {
    const directory = await mkdtemp(join(tmpdir(), "vrdex-mcp-oauth-prereqs-"));
    const ghCommand = await writeFakeGh(directory, [], [
      { name: "VRDEX_MCP_OAUTH_CLIENT_ID" },
      { name: "VRDEX_MCP_OAUTH_CLIENT_SECRET" },
    ]);

    try {
      const result = runPrereqs(["--repo", "BASIC-BIT/VRDex", "--require-ready"], ghCommand);

      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /Reviewed OAuth client secrets \| no \| pass/);
      assert.match(result.stdout, /Hosted MCP OAuth evidence path \| yes \| pass/);
      assert.match(result.stdout, /GitHub repository: BASIC-BIT\/VRDex/);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("passes readiness when the hosted workflow can mint temporary OAuth credentials", async () => {
    const directory = await mkdtemp(join(tmpdir(), "vrdex-mcp-oauth-prereqs-"));
    const ghCommand = await writeFakeGh(directory, [
      { name: "VRDEX_HOSTED_E2E_AUTH_HELPERS", value: "true" },
      { name: "VRDEX_HOSTED_E2E_DEVELOPER_CREDENTIALS", value: "true" },
    ], [
      { name: "VRDEX_HOSTED_E2E_BROWSER_TOKEN" },
      // The generator signs in through Clerk since #226, so readiness now
      // depends on these too.
      { name: "VRDEX_HOSTED_E2E_CLERK_PUBLISHABLE_KEY" },
      { name: "VRDEX_HOSTED_E2E_CLERK_SECRET_KEY" },
    ]);

    try {
      const result = runPrereqs(["--require-ready"], ghCommand);

      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /Temporary OAuth credential generation \| no \| pass/);
      assert.match(result.stdout, /Hosted MCP OAuth evidence path \| yes \| pass/);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("withholds readiness when the Clerk keys the generator signs in with are absent", async () => {
    const directory = await mkdtemp(join(tmpdir(), "vrdex-mcp-oauth-prereqs-"));
    // Exactly what the audit checked before #226, and nothing more. This
    // combination reported `pass` and sent an operator to dispatch a workflow
    // whose OAuth smoke would then skip, because the generator cannot create its
    // temporary account without Clerk credentials.
    const ghCommand = await writeFakeGh(directory, [
      { name: "VRDEX_HOSTED_E2E_AUTH_HELPERS", value: "true" },
      { name: "VRDEX_HOSTED_E2E_DEVELOPER_CREDENTIALS", value: "true" },
    ], [
      { name: "VRDEX_HOSTED_E2E_BROWSER_TOKEN" },
    ]);

    try {
      const result = runPrereqs([], ghCommand);

      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /Temporary OAuth credential generation \| no \| partial/);
      assert.match(result.stdout, /VRDEX_HOSTED_E2E_CLERK_SECRET_KEY=missing/);

      const required = runPrereqs(["--require-ready"], ghCommand);

      assert.notEqual(required.status, 0);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("keeps readiness pending when only part of temporary credential generation is configured", async () => {
    const directory = await mkdtemp(join(tmpdir(), "vrdex-mcp-oauth-prereqs-"));
    const ghCommand = await writeFakeGh(directory, [
      { name: "VRDEX_HOSTED_E2E_AUTH_HELPERS", value: "true" },
    ], [
      { name: "VRDEX_HOSTED_E2E_BROWSER_TOKEN" },
    ]);

    try {
      const result = runPrereqs([], ghCommand);

      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /Temporary OAuth credential generation \| no \| partial/);
      assert.match(result.stdout, /VRDEX_HOSTED_E2E_DEVELOPER_CREDENTIALS=missing/);
      assert.match(result.stdout, /Hosted MCP OAuth evidence path \| yes \| partial/);

      const required = runPrereqs(["--require-ready"], ghCommand);

      assert.notEqual(required.status, 0);
      assert.match(required.stderr, /Hosted MCP OAuth GitHub prerequisites are not ready/);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("does not print variable values", async () => {
    const directory = await mkdtemp(join(tmpdir(), "vrdex-mcp-oauth-prereqs-"));
    const ghCommand = await writeFakeGh(directory, [
      { name: "VRDEX_HOSTED_E2E_AUTH_HELPERS", value: "do-not-print-me" },
    ], []);

    try {
      const result = runPrereqs([], ghCommand);

      assert.equal(result.status, 0, result.stderr);
      assert.doesNotMatch(result.stdout, /do-not-print-me/);
      assert.match(result.stdout, /VRDEX_HOSTED_E2E_AUTH_HELPERS=present-not-enabled/);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });
});
