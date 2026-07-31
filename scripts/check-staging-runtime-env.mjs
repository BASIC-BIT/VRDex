import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export const STAGING_BASE_ENVIRONMENT_NAMES = Object.freeze([
  "CLERK_SECRET_KEY",
  "CONVEX_URL",
  "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
  "NEXT_PUBLIC_CONVEX_URL",
  "VRDEX_DEPLOYMENT_ENV",
  "VRDEX_E2E_BROWSER_TOKEN",
  "VRDEX_E2E_CONVEX_SECRET",
  "VRDEX_ENABLE_E2E_HELPERS",
  "VRDEX_RATE_LIMIT_REDIS_REST_TOKEN",
  "VRDEX_RATE_LIMIT_REDIS_REST_URL",
  "VRDEX_RATE_LIMIT_STORE",
]);

export const STAGING_DEVELOPER_PLATFORM_ENVIRONMENT_NAMES = Object.freeze([
  "CONVEX_ADMIN_TOKEN",
  "VRDEX_ENABLE_E2E_AUTH_HELPERS",
  "VRDEX_API_TOKEN_PEPPER",
  "VRDEX_MCP_RESOURCE_URI",
  "VRDEX_OAUTH_ACCESS_TOKEN_SIGNING_KEY",
  "VRDEX_OAUTH_CLIENT_SECRET_PEPPER",
  "VRDEX_OAUTH_ISSUER_URL",
  "VRDEX_OAUTH_REFRESH_TOKEN_PEPPER",
  "VRDEX_PUBLIC_API_BASE_URL",
]);

export function parseVercelEnvironmentPayload(text) {
  return JSON.parse(text.replace(/^\uFEFF/, ""));
}

function environmentRecords(payload) {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (payload && typeof payload === "object") {
    for (const key of ["env", "envs", "environmentVariables", "variables"]) {
      if (Array.isArray(payload[key])) {
        return payload[key];
      }
    }
  }

  throw new Error("Vercel environment JSON must be an array or contain an environment-variable array.");
}

function recordAppliesToBranch(record, gitBranch) {
  if (!gitBranch || !record || typeof record !== "object") {
    return true;
  }

  const recordBranch = typeof record.gitBranch === "string" ? record.gitBranch.trim() : "";
  return !recordBranch || recordBranch === gitBranch;
}

export function configuredEnvironmentNames(payload, { gitBranch } = {}) {
  const names = new Set();

  for (const record of environmentRecords(payload)) {
    if (typeof record === "string") {
      if (record.trim()) {
        names.add(record.trim());
      }
      continue;
    }

    if (!record || typeof record !== "object" || !recordAppliesToBranch(record, gitBranch)) {
      continue;
    }

    const name = typeof record.key === "string" ? record.key : record.name;
    if (typeof name === "string" && name.trim()) {
      names.add(name.trim());
    }
  }

  return names;
}

export function requiredStagingEnvironmentNames({ requireDeveloperCredentials = false } = {}) {
  return [
    ...STAGING_BASE_ENVIRONMENT_NAMES,
    ...(requireDeveloperCredentials ? STAGING_DEVELOPER_PLATFORM_ENVIRONMENT_NAMES : []),
  ];
}

export function missingStagingEnvironmentNames(configuredNames, options) {
  return requiredStagingEnvironmentNames(options).filter((name) => !configuredNames.has(name));
}

function parseArguments(argv) {
  const options = {
    gitBranch: undefined,
    inputPath: undefined,
    requireDeveloperCredentials: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (argument === "--input") {
      options.inputPath = argv[index + 1];
      index += 1;
      continue;
    }

    if (argument === "--git-branch") {
      options.gitBranch = argv[index + 1]?.trim();
      index += 1;
      continue;
    }

    if (argument === "--require-developer-credentials") {
      options.requireDeveloperCredentials = true;
      continue;
    }

    throw new Error(`Unknown argument: ${argument}`);
  }

  assert.ok(options.inputPath, "--input <path> is required.");
  assert.ok(options.gitBranch, "--git-branch <name> is required.");
  return options;
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  const payload = parseVercelEnvironmentPayload(await readFile(options.inputPath, "utf8"));
  const configuredNames = configuredEnvironmentNames(payload, options);
  const missingNames = missingStagingEnvironmentNames(configuredNames, options);

  console.log(
    `[staging-runtime-env] Audited ${configuredNames.size} configured variable names for ${options.gitBranch}; values were not validated or printed.`,
  );

  if (missingNames.length > 0) {
    console.error("[staging-runtime-env] Missing required Vercel staging variable names:");
    for (const name of missingNames) {
      console.error(`- ${name}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log("[staging-runtime-env] Vercel staging variable-name contract is complete.");
}

const isMainModule =
  process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url;

if (isMainModule) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[staging-runtime-env] ${message}`);
    process.exitCode = 1;
  });
}
