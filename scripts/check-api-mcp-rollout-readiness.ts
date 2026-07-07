import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";

type ManualStatus = "fail" | "not_applicable" | "pass" | "pending";
type HostedReadinessStatus = "fail" | "pass" | "pending";

type SmokeCheck = {
  id: string;
  manualStatus: ManualStatus;
  requiredForExternalReadiness: boolean;
};

type ClientEntry = {
  checks: SmokeCheck[];
  id: string;
  name: string;
};

type HostedReadinessCheck = {
  id: string;
  requiredForExternalReadiness: boolean;
  status: HostedReadinessStatus;
};

type SmokeMatrix = {
  clients: ClientEntry[];
  hostedReadiness?: {
    checks: HostedReadinessCheck[];
  };
  readinessMode: string;
  schemaVersion: 1;
  targetEnvironment: string | null;
};

type OpenApiDocument = {
  info?: {
    version?: unknown;
  };
  openapi?: unknown;
  paths?: Record<string, unknown>;
};

type PackageJson = {
  scripts?: Record<string, string>;
};

type ReadinessCheck = {
  details: string;
  name: string;
  required: boolean;
  status: "pass" | "pending";
};

type Options = {
  requireReady: boolean;
};

const requiredOpenApiPaths = [
  "/api/v0/openapi.json",
  "/api/v0/me",
  "/api/v0/me/profiles",
  "/api/v0/me/communities",
  "/api/v0/me/events",
  "/api/v0/developer/tokens",
  "/api/v0/developer/tokens/{tokenId}",
  "/api/v0/developer/oauth-apps",
  "/api/v0/developer/oauth-apps/{clientId}",
  "/api/v0/developer/oauth-apps/{clientId}/secrets",
  "/api/v0/search",
  "/api/v0/profiles/{slug}",
  "/api/v0/profiles/{slug}/assets",
  "/api/v0/profiles/{slug}/assets/{assetId}/file",
  "/api/v0/profiles/{slug}/assets/upload-intent",
  "/api/v0/profiles/{slug}/logos",
  "/api/v0/profiles/{slug}/logos.zip",
  "/api/v0/profile-assets/upload-intents/{intentId}",
  "/api/v0/people/{slug}",
  "/api/v0/people/{slug}/events",
  "/api/v0/communities/{slug}",
  "/api/v0/communities/{slug}/events",
  "/api/v0/events/{slug}",
  "/api/v0/events",
  "/api/v0/events/upcoming",
  "/api/v0/worlds/{slug}",
  "/api/v0/worlds/{slug}/events",
  "/api/v0/worlds/active",
  "/api/v0/claims/{slug}/status",
  "/api/v0/usage/rate-limit",
];

const requiredDeveloperDocs = [
  "docs/developers/public-api.md",
  "docs/developers/api-auth.md",
  "docs/developers/oauth-apps.md",
  "docs/developers/api-rate-limits.md",
  "docs/developers/vrdex-mcp-read-tools.md",
  "docs/developers/mcp-client-compatibility.md",
  "docs/developers/self-hosting-and-iac.md",
  "docs/developers/api-mcp-rollout-checklist.md",
  "docs/developers/api-changelog.md",
  "docs/deployment/convex-environments.md",
];

const requiredScripts = [
  "check:api-openapi",
  "check:mcp-client-matrix",
  "ops:mcp-installed-clients",
  "ops:mcp-client-smokes",
  "ops:mcp-client-session-pack",
  "ops:mcp-add-mcp-preflight",
  "smoke:mcp-compat",
  "smoke:mcp-claude-code",
  "smoke:mcp-inspector",
  "verify:api-contracts",
  "verify:vrdex-mcp",
  "verify:docs",
  "record:mcp-client-smoke",
  "record:mcp-hosted-evidence",
];

const hostedEvidenceTargetPattern = /\b(same-branch|production-like|staging|production)\b/i;
const pendingHostedEvidencePattern = /\b(pending|need|needs|lack|lacks|skipped|unavailable|not deployed|without data-backed)\b/i;
const requiredHostedReadinessChecks = new Map<string, string>([
  ["hosted-data-backed-anonymous-read", "data-backed anonymous hosted MCP public read"],
  ["hosted-dynamic-client-registration", "hosted OAuth Dynamic Client Registration"],
  ["hosted-client-id-metadata-document", "hosted OAuth Client ID Metadata Document"],
]);

function matrixPath() {
  return process.env.VRDEX_MCP_CLIENT_MATRIX_PATH?.trim()
    || "docs/developers/mcp-client-smoke-results.json";
}

function envFlag(name: string) {
  const value = process.env[name]?.trim().toLowerCase();

  return value === "1" || value === "true" || value === "yes";
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    requireReady: envFlag("VRDEX_API_MCP_REQUIRE_READY"),
  };

  for (const arg of argv) {
    switch (arg) {
      case "--":
        break;
      case "--require-ready":
        options.requireReady = true;
        break;
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

function check(name: string, status: ReadinessCheck["status"], details: string, required = true): ReadinessCheck {
  return { details, name, required, status };
}

async function pathExists(path: string) {
  try {
    await access(path);

    return true;
  } catch {
    return false;
  }
}

async function checkOpenApi() {
  const document = JSON.parse(await readFile("docs/api/openapi.json", "utf8")) as OpenApiDocument;

  assert.equal(document.openapi, "3.1.0", "docs/api/openapi.json must stay on OpenAPI 3.1.0 for current tooling.");
  assert.equal(typeof document.info?.version, "string", "OpenAPI info.version must be present.");
  assert.equal(typeof document.paths, "object", "OpenAPI paths must be present.");

  const pathSet = new Set(Object.keys(document.paths ?? {}));
  const missingPaths = requiredOpenApiPaths.filter((path) => !pathSet.has(path));

  return missingPaths.length === 0
    ? check("Generated OpenAPI contract", "pass", `${requiredOpenApiPaths.length} required API paths are present`)
    : check("Generated OpenAPI contract", "pending", `missing paths: ${missingPaths.join(", ")}`);
}

async function checkDocs() {
  const missingDocs: string[] = [];

  for (const doc of requiredDeveloperDocs) {
    if (!(await pathExists(doc))) {
      missingDocs.push(doc);
    }
  }

  return missingDocs.length === 0
    ? check("Developer and deployment docs", "pass", `${requiredDeveloperDocs.length} required docs exist`)
    : check("Developer and deployment docs", "pending", `missing docs: ${missingDocs.join(", ")}`);
}

async function checkScripts() {
  const packageJson = JSON.parse(await readFile("package.json", "utf8")) as PackageJson;
  const scripts = packageJson.scripts ?? {};
  const missingScripts = requiredScripts.filter((script) => scripts[script] === undefined);

  return missingScripts.length === 0
    ? check("Rollout verification scripts", "pass", `${requiredScripts.length} required scripts are defined`)
    : check("Rollout verification scripts", "pending", `missing scripts: ${missingScripts.join(", ")}`);
}

async function checkMcpMatrix() {
  const matrix = JSON.parse(await readFile(matrixPath(), "utf8")) as SmokeMatrix;

  assert.equal(matrix.schemaVersion, 1, "MCP client smoke matrix schemaVersion must be 1.");
  assert.equal(Array.isArray(matrix.clients), true, "MCP client smoke matrix clients must be an array.");

  const blockers: string[] = [];

  for (const client of matrix.clients) {
    for (const smoke of client.checks) {
      if (smoke.requiredForExternalReadiness && smoke.manualStatus !== "pass") {
        blockers.push(`${client.name}/${smoke.id}: ${smoke.manualStatus}`);
      }
    }
  }

  return blockers.length === 0
    ? check("Major MCP client matrix", "pass", "all required manual rows are pass")
    : check("Major MCP client matrix", "pending", blockers.join("; "));
}

async function checkHostedReadinessMode() {
  const matrix = JSON.parse(await readFile(matrixPath(), "utf8")) as SmokeMatrix;
  const target = matrix.targetEnvironment ?? "not recorded";
  const hasPendingMode = /\bpending\b/i.test(matrix.readinessMode);
  const hasPendingTarget = pendingHostedEvidencePattern.test(target);
  const hasAcceptableTarget = hostedEvidenceTargetPattern.test(target) && !hasPendingTarget;
  const hostedReadinessChecks = matrix.hostedReadiness?.checks ?? [];
  const hostedReadinessBlockers: string[] = [];
  const seenHostedReadinessChecks = new Set<string>();

  for (const hostedCheck of hostedReadinessChecks) {
    seenHostedReadinessChecks.add(hostedCheck.id);

    if (hostedCheck.requiredForExternalReadiness && hostedCheck.status !== "pass") {
      hostedReadinessBlockers.push(
        `${requiredHostedReadinessChecks.get(hostedCheck.id) ?? hostedCheck.id}: ${hostedCheck.status}`,
      );
    }
  }

  for (const [checkId, label] of requiredHostedReadinessChecks) {
    if (!seenHostedReadinessChecks.has(checkId)) {
      hostedReadinessBlockers.push(`${label}: missing`);
    }
  }

  return hasPendingMode || hasPendingTarget || !hasAcceptableTarget || hostedReadinessBlockers.length > 0
    ? check(
        "Production-like hosted MCP evidence",
        "pending",
        [
          `readinessMode=${matrix.readinessMode}`,
          `targetEnvironment=${target}`,
          hostedReadinessBlockers.length > 0
            ? `hostedReadiness=${hostedReadinessBlockers.join(", ")}`
            : "hostedReadiness=all required checks pass",
          hasAcceptableTarget
            ? "target classification accepted"
            : "targetEnvironment must name a same-branch, staging, production-like, or production target",
        ].join("; "),
      )
    : check("Production-like hosted MCP evidence", "pass", `readinessMode=${matrix.readinessMode}`);
}

function printSummary(checks: ReadinessCheck[]) {
  console.log("| Requirement | Required | Status | Details |");
  console.log("| --- | --- | --- | --- |");

  for (const item of checks) {
    console.log(`| ${item.name} | ${item.required ? "yes" : "no"} | ${item.status} | ${item.details} |`);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const checks = [
    await checkOpenApi(),
    await checkDocs(),
    await checkScripts(),
    await checkMcpMatrix(),
    await checkHostedReadinessMode(),
  ];
  const blockers = checks.filter((item) => item.required && item.status !== "pass");

  printSummary(checks);

  if (options.requireReady && blockers.length > 0) {
    throw new Error(`API/MCP rollout is not externally ready:\n${blockers.map((item) => `- ${item.name}: ${item.details}`).join("\n")}`);
  }

  if (blockers.length > 0) {
    console.log(
      [
        "",
        "API/MCP rollout external readiness is still pending.",
        "Run pnpm check:api-mcp-rollout -- --require-ready to make pending required items fail this check.",
      ].join("\n"),
    );
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
