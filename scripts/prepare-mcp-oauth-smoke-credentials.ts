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

type PlaywrightChromiumModule<T> = {
  chromium?: T;
  default?: {
    chromium?: T;
  };
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
    "  CLERK_SECRET_KEY           Secret key for the Clerk development instance backing the target.",
    "  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY  Matching publishable key. A production key is rejected.",
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

export function resolvePlaywrightChromium<T>(module: PlaywrightChromiumModule<T>) {
  const chromium = module.chromium ?? module.default?.chromium;

  assert.ok(chromium, "The Playwright module does not expose chromium directly or through its default export.");

  return { chromium };
}

async function loadPlaywright() {
  const webRequire = createRequire(path.join(repoRoot, "apps", "web", "package.json"));
  const playwrightModule = await import(webRequire.resolve("@playwright/test")) as unknown as
    PlaywrightChromiumModule<typeof import("@playwright/test").chromium>;

  return resolvePlaywrightChromium(playwrightModule);
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

const CLERK_API_BASE = process.env.CLERK_API_URL?.trim().replace(/\/+$/, "") || "https://api.clerk.com";

/**
 * Resolved through `apps/web` for the same reason Playwright is: this script
 * lives at the repository root, where neither package is a dependency.
 */
async function loadClerkTesting() {
  const webRequire = createRequire(path.join(repoRoot, "apps", "web", "package.json"));

  return await import(webRequire.resolve("@clerk/testing/playwright")) as unknown as
    typeof import("@clerk/testing/playwright");
}

export function clerkKeysFromEnv() {
  const secretKey = process.env.CLERK_SECRET_KEY?.trim() ?? "";
  const publishableKey =
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim() ??
    process.env.CLERK_PUBLISHABLE_KEY?.trim() ??
    "";

  assert.ok(
    secretKey && publishableKey,
    "CLERK_SECRET_KEY and NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY are required. Use the development instance backing the target; clerkSetup() rejects a production secret key.",
  );

  return { publishableKey, secretKey };
}

async function clerkBackendRequest(pathName: string, init: RequestInit) {
  const { secretKey } = clerkKeysFromEnv();

  return await fetch(`${CLERK_API_BASE}${pathName}`, {
    ...init,
    headers: { ...init.headers, authorization: `Bearer ${secretKey}`, "content-type": "application/json" },
  });
}

/**
 * Creates the temporary account through the Clerk Backend API and signs in with
 * a one-time ticket. Replaces the email/password sign-up form and the
 * `/api/e2e/auth` verification-code lookup, both removed by the Clerk cutover.
 *
 * Backend-API addresses arrive already verified, so the account satisfies the
 * verified-email guard on OAuth app registration without a code round-trip.
 */
async function createSignedInClerkAccount(args: {
  email: string;
  page: import("@playwright/test").Page;
}) {
  const { clerk, clerkSetup, setupClerkTestingToken } = await loadClerkTesting();
  const { publishableKey } = clerkKeysFromEnv();

  await clerkSetup({ publishableKey });

  const response = await clerkBackendRequest("/v1/users", {
    method: "POST",
    body: JSON.stringify({ email_address: [args.email], skip_password_requirement: true }),
  });

  // Read once, then parse the saved text. An `await response.text()` inside the
  // assertion message is evaluated eagerly — even when the assertion passes —
  // which consumed the body and made the following `response.json()` throw on
  // every *successful* creation, so the generated-credential path could never
  // get past its own happy path.
  const responseBody = await response.text();

  assert.equal(
    response.ok,
    true,
    `Clerk test user creation failed. HTTP ${response.status}: ${responseBody}`,
  );

  const user = JSON.parse(responseBody) as { id?: unknown };

  assert.ok(typeof user.id === "string" && user.id, "Clerk test user creation returned no user id.");

  const clerkUserId = user.id;

  // Deleted here on failure rather than left to the caller's `finally`. The
  // caller learns the id from the *return* value, so a throw in any of the
  // browser steps below left it undefined and skipped teardown — and auth drift
  // is exactly what this hosted path exists to detect, so failing runs and their
  // retries would steadily accumulate users in the staging Clerk tenant.
  try {
    await setupClerkTestingToken({ page: args.page });
    await gotoFlowPage(args.page, "/");
    await clerk.signIn({ page: args.page, emailAddress: args.email });

    // `users:ensureCurrentUser` provisions the Convex row on the first
    // authenticated page load, and OAuth app registration needs it to exist.
    await gotoFlowPage(args.page, "/account");
    await args.page.getByRole("heading", { name: args.email }).waitFor({ timeout: 30_000 });
  } catch (error) {
    await deleteClerkAccount(clerkUserId);
    throw error;
  }

  return { clerkUserId };
}

async function deleteClerkAccount(clerkUserId: string | undefined) {
  if (clerkUserId === undefined) {
    return;
  }

  try {
    await clerkBackendRequest(`/v1/users/${encodeURIComponent(clerkUserId)}`, { method: "DELETE" });
  } catch (error) {
    console.warn(`Failed to delete Clerk test user ${clerkUserId}:`, error);
  }
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

export function parseOAuthTokenResponse(args: { ok: boolean; status: number; text: string }) {
  const responseBody = args.text.trim().slice(0, 300) || "<empty response body>";

  assert.equal(
    args.ok,
    true,
    `OAuth client-credentials verification failed with HTTP ${args.status}: ${responseBody}`,
  );

  try {
    return JSON.parse(args.text) as Record<string, unknown>;
  } catch {
    throw new Error(`OAuth token endpoint returned non-JSON with HTTP ${args.status}: ${responseBody}`);
  }
}

export function parseMcpOAuthVerificationResponse(args: {
  ok: boolean;
  status: number;
  text: string;
}) {
  const responseBody = args.text.trim().slice(0, 500) || "<empty response body>";

  assert.equal(
    args.ok,
    true,
    `OAuth bearer verification against hosted MCP failed with HTTP ${args.status}: ${responseBody}`,
  );

  const trimmed = args.text.trim();
  const payloadText = trimmed.startsWith("{")
    ? trimmed
    : trimmed
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.startsWith("data:"))
      ?.slice("data:".length)
      .trim();

  if (!payloadText) {
    throw new Error(`OAuth bearer verification against hosted MCP returned no JSON or SSE data: ${responseBody}`);
  }

  let payload: Record<string, unknown>;

  try {
    payload = JSON.parse(payloadText) as Record<string, unknown>;
  } catch {
    throw new Error(`OAuth bearer verification against hosted MCP returned invalid JSON or SSE data: ${responseBody}`);
  }

  const result = payload.result as { tools?: unknown } | undefined;
  assert.equal(
    Array.isArray(result?.tools),
    true,
    `OAuth bearer verification against hosted MCP did not return a tools array: ${responseBody}`,
  );

  return payload;
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
  const payload = parseOAuthTokenResponse({ ok: response.ok, status: response.status, text });
  assert.equal(payload.token_type, "Bearer", "OAuth token endpoint did not return token_type Bearer.");
  assert.equal(typeof payload.access_token, "string", "OAuth token endpoint did not return an access token.");
  assert.ok(
    typeof payload.scope === "string" && payload.scope.split(/\s+/).includes("mcp:read"),
    "OAuth token endpoint did not grant mcp:read.",
  );

  const mcpResponse = await fetch(hostedMcpUrl(args.origin), {
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "vrdex-oauth-smoke-verification",
      method: "tools/list",
      params: {},
    }),
    headers: {
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${payload.access_token}`,
      "content-type": "application/json",
      "mcp-protocol-version": "2025-06-18",
    },
    method: "POST",
  });
  const mcpText = await mcpResponse.text();
  parseMcpOAuthVerificationResponse({
    ok: mcpResponse.ok,
    status: mcpResponse.status,
    text: mcpText,
  });
}

async function writeCredentialFiles(args: {
  accountEmail: string;
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
      // The Convex user and its OAuth application outlive this script, because
      // the smokes that follow need the client. Emitting the address is what
      // lets the caller delete them once those smokes are done.
      `$env:VRDEX_MCP_OAUTH_SMOKE_ACCOUNT_EMAIL = ${psSingleQuote(args.accountEmail)}`,
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
      `export VRDEX_MCP_OAUTH_SMOKE_ACCOUNT_EMAIL=${shSingleQuote(args.accountEmail)}`,
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
      `Client-credentials MCP authentication: ${args.tokenVerified ? "pass" : "skipped"}`,
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
  // `+clerk_test` suppresses every Clerk delivery attempt; `@e2e.vrdex.net` is
  // the only domain `normalizeE2eEmail` in `convex/e2e.ts` accepts.
  //
  // Bounded to the 64-character local-part maximum. `safeRunId` allows 80, and
  // the fixed `mcp-oauth-` prefix plus the `+clerk_test` marker spend 21 of the
  // budget, so an operator-supplied `--run-id` over 43 characters produced an
  // address Clerk rejects — after the run id had already passed this script's
  // own validation.
  const emailRunSuffix = runSuffix.slice(0, 64 - "mcp-oauth-".length - "+clerk_test".length);
  const email = `mcp-oauth-${emailRunSuffix}+clerk_test@e2e.vrdex.net`;
  let clerkUserId: string | undefined;

  try {
    ({ clerkUserId } = await createSignedInClerkAccount({ email, page }));
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
      accountEmail: email,
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
    console.log(`| MCP bearer verification | ${tokenVerified ? "pass" : "skipped"} |`);
    console.log(`| Output directory | ${files.outputDir} |`);
    console.log(`| PowerShell env | ${files.envPs1} |`);
    console.log(`| Bash env | ${files.envSh} |`);
    console.log(`| Next steps | ${files.summary} |`);
  } finally {
    await deleteClerkAccount(clerkUserId);
    await context.close();
    await browser.close();
  }
}

const isDirectRun = process.argv[1] !== undefined
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
