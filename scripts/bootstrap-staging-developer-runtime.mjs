import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const STAGING_DEVELOPER_RUNTIME_VARIABLE_NAMES = Object.freeze([
  "CONVEX_ADMIN_TOKEN",
  "VRDEX_API_TOKEN_PEPPER",
  "VRDEX_DEPLOYMENT_ENV",
  "VRDEX_MCP_RESOURCE_URI",
  "VRDEX_OAUTH_ACCESS_TOKEN_SIGNING_KEY",
  "VRDEX_OAUTH_CLIENT_SECRET_PEPPER",
  "VRDEX_OAUTH_ISSUER_URL",
  "VRDEX_OAUTH_REFRESH_TOKEN_PEPPER",
  "VRDEX_PUBLIC_API_BASE_URL",
]);

const DEFAULT_STAGING_ORIGIN = "https://staging.vrdex.net";
const VERCEL_CLI_VERSION = "54.4.1";

function requiredOption(value, message) {
  assert.ok(value?.trim(), message);
  return value.trim();
}

export function parseConvexDeploymentToken(text) {
  const match = text.match(/^CONVEX_DEPLOY_KEY=(.+)$/m);
  return requiredOption(match?.[1], "The Convex token env file must contain CONVEX_DEPLOY_KEY.");
}

export function createStagingDeveloperRuntimeValues({
  convexDeploymentToken,
  stagingOrigin = DEFAULT_STAGING_ORIGIN,
} = {}) {
  const token = requiredOption(convexDeploymentToken, "A deployment-scoped Convex token is required.");
  const origin = new URL(stagingOrigin).origin;
  const { privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  const randomSecret = () => randomBytes(32).toString("hex");

  return new Map([
    ["CONVEX_ADMIN_TOKEN", token],
    ["VRDEX_API_TOKEN_PEPPER", randomSecret()],
    ["VRDEX_DEPLOYMENT_ENV", "staging"],
    ["VRDEX_MCP_RESOURCE_URI", `${origin}/mcp`],
    ["VRDEX_OAUTH_ACCESS_TOKEN_SIGNING_KEY", privateKey],
    ["VRDEX_OAUTH_CLIENT_SECRET_PEPPER", randomSecret()],
    ["VRDEX_OAUTH_ISSUER_URL", origin],
    ["VRDEX_OAUTH_REFRESH_TOKEN_PEPPER", randomSecret()],
    ["VRDEX_PUBLIC_API_BASE_URL", origin],
  ]);
}

export function parseArguments(argv) {
  const options = {
    apply: false,
    convexTokenEnvFile: undefined,
    linkedVercelDirectory: undefined,
    stagingOrigin: DEFAULT_STAGING_ORIGIN,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (argument === "--apply") {
      options.apply = true;
      continue;
    }

    if (argument === "--convex-token-env-file") {
      options.convexTokenEnvFile = argv[index + 1];
      index += 1;
      continue;
    }

    if (argument === "--linked-vercel-directory") {
      options.linkedVercelDirectory = argv[index + 1];
      index += 1;
      continue;
    }

    if (argument === "--staging-origin") {
      options.stagingOrigin = argv[index + 1];
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${argument}`);
  }

  assert.equal(options.apply, true, "--apply is required because this command mutates Vercel staging.");
  options.convexTokenEnvFile = requiredOption(
    options.convexTokenEnvFile,
    "--convex-token-env-file <path> is required.",
  );
  options.linkedVercelDirectory = requiredOption(
    options.linkedVercelDirectory,
    "--linked-vercel-directory <path> is required.",
  );
  options.stagingOrigin = new URL(requiredOption(options.stagingOrigin, "--staging-origin must not be empty.")).origin;
  return options;
}

export function writeVercelStagingVariable({
  cwd,
  name,
  value,
  vercelToken,
  pnpmCliPath = process.env.npm_execpath,
}) {
  const packageManagerCli = requiredOption(
    pnpmCliPath,
    "Run this bootstrap through pnpm ops:bootstrap-staging-developer-runtime.",
  );
  const result = spawnSync(
    process.execPath,
    [
      packageManagerCli,
      "dlx",
      `vercel@${VERCEL_CLI_VERSION}`,
      "env",
      "add",
      name,
      "staging",
      "--force",
      "--yes",
      "--sensitive",
      "--token",
      vercelToken,
    ],
    {
      cwd,
      encoding: "utf8",
      input: value,
    },
  );

  if (result.status !== 0) {
    throw new Error(`Vercel rejected ${name} with exit code ${result.status ?? "unknown"}.`);
  }
}

export function main(argv = process.argv.slice(2), environment = process.env) {
  const options = parseArguments(argv);
  const vercelToken = requiredOption(environment.VERCEL_API_TOKEN, "VERCEL_API_TOKEN is required.");
  const convexDeploymentToken = parseConvexDeploymentToken(
    readFileSync(resolve(options.convexTokenEnvFile), "utf8"),
  );
  const values = createStagingDeveloperRuntimeValues({
    convexDeploymentToken,
    stagingOrigin: options.stagingOrigin,
  });

  assert.deepEqual([...values.keys()], [...STAGING_DEVELOPER_RUNTIME_VARIABLE_NAMES]);

  for (const [name, value] of values) {
    writeVercelStagingVariable({
      cwd: resolve(options.linkedVercelDirectory),
      name,
      value,
      vercelToken,
    });
    console.log(`[staging-runtime-bootstrap] Set ${name} for Vercel staging.`);
  }

  console.log(
    "[staging-runtime-bootstrap] Developer runtime variables are configured. Redis rate-limit variables remain Terraform-owned.",
  );
}

const isMainModule =
  process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url;

if (isMainModule) {
  try {
    main();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[staging-runtime-bootstrap] ${message}`);
    process.exitCode = 1;
  }
}
