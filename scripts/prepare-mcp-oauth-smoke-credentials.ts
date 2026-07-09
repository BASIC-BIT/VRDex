import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

type JsonResponse = {
  body: unknown;
  ok: boolean;
  status: number;
};

type Options = {
  allowProduction: boolean;
  baseUrl: string;
  browserToken: string;
  clientName: string;
  headless: boolean;
  outputDir: string;
  runId: string;
  verifyToken: boolean;
};

type OAuthAppResponseBody = {
  application?: {
    allowedGrants?: unknown;
    allowedScopes?: unknown;
    clientId?: unknown;
    clientType?: unknown;
    status?: unknown;
  };
  clientSecretValue?: unknown;
};

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const defaultOutputDir = ".tmp-gh-artifacts/mcp-oauth-smoke-credentials";

function nonEmpty(value: string | undefined) {
  const trimmed = value?.trim();

  return trimmed ? trimmed : undefined;
}

function envFlag(name: string) {
  const value = process.env[name]?.trim().toLowerCase();

  return value === "1" || value === "true" || value === "yes";
}

function takeValue(args: string[], index: number, name: string) {
  const value = args[index + 1];

  assert(value !== undefined && !value.startsWith("--"), `${name} requires a value.`);

  return value;
}

function defaultRunId() {
  const timestamp = new Date().toISOString().replaceAll(/[^0-9]/g, "").slice(0, 14);
  const nonce = randomBytes(3).toString("hex");

  return `mcp-oauth-${timestamp}-${nonce}`;
}

function safeRunId(value: string) {
  return value
    .trim()
    .replace(/[^a-z0-9]+/gi, "-")
    .replaceAll(/^-|-$/g, "")
    .toLowerCase()
    .slice(0, 80);
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    allowProduction: envFlag("VRDEX_MCP_OAUTH_SMOKE_ALLOW_PRODUCTION"),
    baseUrl:
      nonEmpty(process.env.VRDEX_MCP_OAUTH_SMOKE_BASE_URL)
      ?? nonEmpty(process.env.PLAYWRIGHT_BASE_URL)
      ?? "",
    browserToken: nonEmpty(process.env.VRDEX_E2E_BROWSER_TOKEN) ?? "",
    clientName: nonEmpty(process.env.VRDEX_MCP_OAUTH_SMOKE_CLIENT_NAME) ?? "",
    headless: !envFlag("VRDEX_MCP_OAUTH_SMOKE_SHOW_BROWSER"),
    outputDir: nonEmpty(process.env.VRDEX_MCP_OAUTH_SMOKE_OUTPUT_DIR) ?? defaultOutputDir,
    runId: safeRunId(nonEmpty(process.env.VRDEX_E2E_RUN_ID) ?? defaultRunId()),
    verifyToken: !envFlag("VRDEX_MCP_OAUTH_SMOKE_SKIP_TOKEN_VERIFY"),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    switch (arg) {
      case "--":
        break;
      case "--allow-production":
        options.allowProduction = true;
        break;
      case "--base-url":
        options.baseUrl = takeValue(argv, index, arg);
        index += 1;
        break;
      case "--client-name":
        options.clientName = takeValue(argv, index, arg);
        index += 1;
        break;
      case "--output-dir":
        options.outputDir = takeValue(argv, index, arg);
        index += 1;
        break;
      case "--run-id":
        options.runId = safeRunId(takeValue(argv, index, arg));
        index += 1;
        break;
      case "--show-browser":
        options.headless = false;
        break;
      case "--skip-token-verify":
        options.verifyToken = false;
        break;
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  assert.ok(nonEmpty(options.baseUrl), "--base-url, VRDEX_MCP_OAUTH_SMOKE_BASE_URL, or PLAYWRIGHT_BASE_URL is required.");
  assert.ok(
    nonEmpty(options.browserToken),
    "VRDEX_E2E_BROWSER_TOKEN is required. Pass it through the environment, not a command-line argument.",
  );
  assert.ok(nonEmpty(options.runId), "--run-id must contain at least one alphanumeric character.");

  if (!options.clientName) {
    options.clientName = `VRDex MCP OAuth smoke ${options.runId}`;
  }

  return options;
}

function printHelp() {
  console.log([
    "Usage: pnpm ops:mcp-oauth-smoke-credentials -- --base-url <staging-origin>",
    "",
    "Creates a temporary confidential OAuth app for hosted MCP OAuth smoke evidence.",
    "",
    "Required environment:",
    "  VRDEX_E2E_BROWSER_TOKEN    Browser token matching the hosted E2E auth helper target.",
    "",
    "Options:",
    "  --base-url <url>           Hosted app origin or /mcp URL. Also reads VRDEX_MCP_OAUTH_SMOKE_BASE_URL or PLAYWRIGHT_BASE_URL.",
    "  --client-name <name>       OAuth app display name.",
    "  --output-dir <path>        Output directory for ignored env files.",
    "  --run-id <id>              Stable run id for the E2E account and client name.",
    "  --show-browser            Run Playwright visibly.",
    "  --skip-token-verify       Create credentials without calling /oauth/token.",
    "  --allow-production        Allow production origins for an explicit emergency operator run.",
    "  --help                    Show this help.",
  ].join("\n"));
}

function appOriginFromBaseUrl(rawUrl: string) {
  const url = new URL(rawUrl);

  url.pathname = "";
  url.search = "";
  url.hash = "";

  return url.toString().replace(/\/$/, "");
}

function hostedMcpUrl(origin: string) {
  return `${origin}/mcp`;
}

function isProductionOrigin(origin: string) {
  const host = new URL(origin).hostname.toLowerCase();

  return host === "vrdex.net" || host === "www.vrdex.net";
}

function psSingleQuote(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}

function shSingleQuote(value: string) {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}

function basicAuthorization(clientId: string, clientSecret: string) {
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
}

function loadPlaywright() {
  const webRequire = createRequire(path.join(repoRoot, "apps", "web", "package.json"));

  return import(webRequire.resolve("@playwright/test")) as Promise<typeof import("@playwright/test")>;
}

async function gotoFlowPage(page: import("@playwright/test").Page, pathName: string) {
  try {
    await page.goto(pathName);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    if (!message.includes("net::ERR_ABORTED")) {
      throw error;
    }

    await page.waitForTimeout(250);
    await page.goto(pathName);
  }
}

async function createVerifiedE2eAccount(args: {
  browserToken: string;
  email: string;
  page: import("@playwright/test").Page;
  password: string;
  request: import("@playwright/test").APIRequestContext;
}) {
  await gotoFlowPage(args.page, "/sign-in");
  await args.page.getByRole("button", { name: "Create account" }).click();
  await args.page.getByLabel("Email").fill(args.email);
  await args.page.getByLabel("Password").fill(args.password);
  await args.page.getByRole("button", { name: "Create account" }).click();
  await args.page.getByText(new RegExp(`Check ${args.email} for a verification code`, "i")).waitFor();

  const codeResponse = await args.request.post("/api/e2e/auth", {
    data: { action: "consume-code", email: args.email },
    headers: { "x-vrdex-e2e-token": args.browserToken },
  });

  assert.equal(
    codeResponse.ok(),
    true,
    `E2E auth helper did not return a verification code. HTTP ${codeResponse.status()}: ${await codeResponse.text()}`,
  );

  const authCode = (await codeResponse.json()) as { code?: string };

  assert.ok(authCode.code, "E2E auth helper returned no verification code.");

  await args.page.getByLabel("Verification code").fill(authCode.code);
  await Promise.all([
    args.page.waitForURL(/\/account$/),
    args.page.getByRole("button", { name: "Verify email" }).click(),
  ]);
}

async function postSessionJson(
  page: import("@playwright/test").Page,
  pathName: string,
  payload: Record<string, unknown>,
): Promise<JsonResponse> {
  return await page.evaluate(
    async ({ pathName: requestPath, payload: requestPayload }) => {
      const response = await fetch(requestPath, {
        body: JSON.stringify(requestPayload),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      const body = await response.json().catch(() => null);

      return { body, ok: response.ok, status: response.status };
    },
    { pathName, payload },
  );
}

function assertOAuthAppResponse(body: unknown): asserts body is OAuthAppResponseBody {
  assert.equal(body !== null && typeof body === "object", true, "OAuth app creation did not return a JSON object.");
}

async function createConfidentialMcpOAuthApp(args: {
  clientName: string;
  origin: string;
  page: import("@playwright/test").Page;
}) {
  const response = await postSessionJson(args.page, "/api/developer/oauth-apps", {
    allowedGrants: ["client_credentials"],
    allowedScopes: ["public:read", "mcp:read"],
    clientType: "confidential",
    description: "Temporary MCP OAuth smoke client for staging external-readiness evidence.",
    displayName: args.clientName,
    redirectUris: [`${args.origin}/oauth/e2e-callback`],
  });

  assert.equal(
    response.ok,
    true,
    `OAuth app creation failed with HTTP ${response.status}: ${JSON.stringify(response.body)}`,
  );
  assertOAuthAppResponse(response.body);

  const clientId = response.body.application?.clientId;
  const clientSecret = response.body.clientSecretValue;

  assert.equal(typeof clientId, "string", "OAuth app creation did not return application.clientId.");
  assert.equal(typeof clientSecret, "string", "OAuth app creation did not return clientSecretValue.");
  assert.equal(response.body.application?.clientType, "confidential", "OAuth app is not confidential.");
  assert.equal(response.body.application?.status, "active", "OAuth app is not active.");
  assert.deepEqual(response.body.application?.allowedGrants, ["client_credentials"]);
  assert.deepEqual(response.body.application?.allowedScopes, ["public:read", "mcp:read"]);

  return { clientId, clientSecret };
}

async function verifyClientCredentialsToken(args: {
  clientId: string;
  clientSecret: string;
  origin: string;
}) {
  const response = await fetch(`${args.origin}/oauth/token`, {
    body: new URLSearchParams({
      grant_type: "client_credentials",
      resource: hostedMcpUrl(args.origin),
      scope: "public:read mcp:read",
    }),
    headers: {
      authorization: basicAuthorization(args.clientId, args.clientSecret),
      "content-type": "application/x-www-form-urlencoded",
    },
    method: "POST",
  });
  const text = await response.text();
  const payload = JSON.parse(text) as Record<string, unknown>;

  assert.equal(
    response.ok,
    true,
    `OAuth client-credentials verification failed with HTTP ${response.status}: ${text.slice(0, 300)}`,
  );
  assert.equal(payload.token_type, "Bearer", "OAuth token endpoint did not return token_type Bearer.");
  assert.equal(typeof payload.access_token, "string", "OAuth token endpoint did not return an access token.");
  assert.ok(
    typeof payload.scope === "string" && payload.scope.split(/\s+/).includes("mcp:read"),
    "OAuth token endpoint did not grant mcp:read.",
  );
}

async function writeCredentialFiles(args: {
  clientId: string;
  clientName: string;
  clientSecret: string;
  origin: string;
  outputDir: string;
  runId: string;
  tokenVerified: boolean;
}) {
  const outputDir = path.resolve(repoRoot, args.outputDir);
  const envPs1 = path.join(outputDir, "mcp-oauth-smoke-env.ps1");
  const envSh = path.join(outputDir, "mcp-oauth-smoke-env.sh");
  const summary = path.join(outputDir, "README.md");
  const hostedUrl = hostedMcpUrl(args.origin);

  await mkdir(outputDir, { recursive: true });
  await writeFile(
    envPs1,
    [
      "# Generated by pnpm ops:mcp-oauth-smoke-credentials.",
      "# This file contains a one-time OAuth client secret for staging smoke evidence.",
      `$env:VRDEX_MCP_OAUTH_CLIENT_ID = ${psSingleQuote(args.clientId)}`,
      `$env:VRDEX_MCP_OAUTH_CLIENT_SECRET = ${psSingleQuote(args.clientSecret)}`,
      `$env:VRDEX_CLAUDE_CODE_HOSTED_URL = ${psSingleQuote(hostedUrl)}`,
      `$env:VRDEX_MCP_INSPECTOR_HOSTED_URL = ${psSingleQuote(hostedUrl)}`,
      "",
    ].join("\n"),
  );
  await writeFile(
    envSh,
    [
      "# Generated by pnpm ops:mcp-oauth-smoke-credentials.",
      "# This file contains a one-time OAuth client secret for staging smoke evidence.",
      `export VRDEX_MCP_OAUTH_CLIENT_ID=${shSingleQuote(args.clientId)}`,
      `export VRDEX_MCP_OAUTH_CLIENT_SECRET=${shSingleQuote(args.clientSecret)}`,
      `export VRDEX_CLAUDE_CODE_HOSTED_URL=${shSingleQuote(hostedUrl)}`,
      `export VRDEX_MCP_INSPECTOR_HOSTED_URL=${shSingleQuote(hostedUrl)}`,
      "",
    ].join("\n"),
  );
  await writeFile(
    summary,
    [
      "# MCP OAuth Smoke Credentials",
      "",
      `Target: ${hostedUrl}`,
      `Run id: ${args.runId}`,
      `OAuth app: ${args.clientName}`,
      `OAuth client id: ${args.clientId}`,
      `Client-credentials token verification: ${args.tokenVerified ? "pass" : "skipped"}`,
      "",
      "The client secret is written only to the ignored env files in this directory. Do not paste it into PR comments, logs, docs, or matrix evidence.",
      "",
      "PowerShell:",
      "",
      "```powershell",
      `. ${envPs1}`,
      `corepack pnpm smoke:mcp-claude-code -- --mode hosted-http --hosted-url ${hostedUrl} --hosted-data --hosted-query <known-public-query>`,
      `corepack pnpm smoke:mcp-inspector -- --hosted-url ${hostedUrl} --hosted-data --query <known-public-query>`,
      `corepack pnpm smoke:mcp-gemini-cli -- --mode hosted-http --hosted-url ${hostedUrl} --hosted-data --hosted-query <known-public-query>`,
      "```",
      "",
      "Bash:",
      "",
      "```sh",
      `. ${envSh}`,
      `corepack pnpm smoke:mcp-claude-code -- --mode hosted-http --hosted-url ${hostedUrl} --hosted-data --hosted-query <known-public-query>`,
      `corepack pnpm smoke:mcp-inspector -- --hosted-url ${hostedUrl} --hosted-data --query <known-public-query>`,
      `corepack pnpm smoke:mcp-gemini-cli -- --mode hosted-http --hosted-url ${hostedUrl} --hosted-data --hosted-query <known-public-query>`,
      "```",
      "",
      "After the smokes pass, record sanitized evidence with `pnpm record:mcp-client-smoke` for `claude-code/hosted-oauth`, `mcp-inspector/hosted-oauth`, and `gemini-cli/hosted-oauth` as applicable.",
      "",
    ].join("\n"),
  );

  return { envPs1, envSh, outputDir, summary };
}

async function main() {
  if (process.argv.slice(2).includes("--help")) {
    printHelp();
    return;
  }

  const options = parseArgs(process.argv.slice(2));
  const origin = appOriginFromBaseUrl(options.baseUrl);

  if (isProductionOrigin(origin) && !options.allowProduction) {
    throw new Error("Refusing to use E2E helpers against production. Pass --allow-production only for an explicit emergency operator run.");
  }

  const { chromium } = await loadPlaywright();
  const browser = await chromium.launch({ headless: options.headless });
  const context = await browser.newContext({ baseURL: origin });
  const page = await context.newPage();
  const runSuffix = safeRunId(options.runId);
  const email = `mcp-oauth-${runSuffix}@e2e.vrdex.local`;
  const password = `VRDex-${runSuffix}-${randomBytes(12).toString("base64url")}-12345`;

  try {
    await createVerifiedE2eAccount({
      browserToken: options.browserToken,
      email,
      page,
      password,
      request: context.request,
    });
    const credentials = await createConfidentialMcpOAuthApp({
      clientName: options.clientName,
      origin,
      page,
    });
    let tokenVerified = false;

    if (options.verifyToken) {
      await verifyClientCredentialsToken({ ...credentials, origin });
      tokenVerified = true;
    }

    const files = await writeCredentialFiles({
      ...credentials,
      clientName: options.clientName,
      origin,
      outputDir: options.outputDir,
      runId: options.runId,
      tokenVerified,
    });

    console.log("| Artifact | Value |");
    console.log("| --- | --- |");
    console.log(`| Hosted MCP URL | ${hostedMcpUrl(origin)} |`);
    console.log(`| OAuth client id | ${credentials.clientId} |`);
    console.log(`| Client secret | written to ignored env files only |`);
    console.log(`| Token verification | ${tokenVerified ? "pass" : "skipped"} |`);
    console.log(`| Output directory | ${files.outputDir} |`);
    console.log(`| PowerShell env | ${files.envPs1} |`);
    console.log(`| Bash env | ${files.envSh} |`);
    console.log(`| Next steps | ${files.summary} |`);
  } finally {
    await context.close();
    await browser.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
