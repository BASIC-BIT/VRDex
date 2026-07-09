import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { loadRepoEnvLocal } from "./env-local";
import { summarizeMcpToolFailure } from "./lib/mcp-smoke-diagnostics";

type HostedSearchType = "all" | "community" | "event" | "person" | "profile" | "world";

type JsonRpcMessage = {
  error?: unknown;
  id?: number | string | null;
  jsonrpc: "2.0";
  method?: string;
  params?: unknown;
  result?: unknown;
};

type OpenAiMcpOptions = {
  apiKey?: string;
  apiKeyEnvName: string;
  endpoint: string;
  fixturePath?: string;
  hostedDataPublicReads: boolean;
  hostedSearch: {
    limit: number;
    query: string;
    type: HostedSearchType;
  };
  hostedUrl?: string;
  model: string;
  requestTimeoutMs: number;
};

const hostedSearchTypes = new Set<HostedSearchType>(["all", "community", "event", "person", "profile", "world"]);
const openAiRequiredHostedTools = ["search", "fetch"] as const;

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

function parseHostedSearchType(value: string | undefined): HostedSearchType {
  const normalized = nonEmpty(value) ?? "all";

  assert(
    hostedSearchTypes.has(normalized as HostedSearchType),
    `Hosted search type must be one of ${[...hostedSearchTypes].join(", ")}.`,
  );

  return normalized as HostedSearchType;
}

function parseHostedSearchLimit(value: string | undefined) {
  const normalized = nonEmpty(value) ?? "1";
  const parsed = Number.parseInt(normalized, 10);

  assert(Number.isSafeInteger(parsed), "Hosted search limit must be an integer.");
  assert(parsed >= 1 && parsed <= 50, "Hosted search limit must be between 1 and 50.");

  return parsed;
}

function parseRequestTimeoutMs(value: string | undefined) {
  const normalized = nonEmpty(value) ?? "90000";
  const parsed = Number.parseInt(normalized, 10);

  assert(Number.isSafeInteger(parsed), "OpenAI request timeout must be an integer.");
  assert(parsed >= 1000 && parsed <= 600000, "OpenAI request timeout must be between 1000 and 600000 milliseconds.");

  return parsed;
}

function printHelp() {
  console.log([
    "Usage: pnpm smoke:mcp-openai -- --hosted-url <production-like-/mcp-url> --hosted-data",
    "",
    "Runs an OpenAI Responses API remote MCP smoke against hosted VRDex MCP.",
    "This is API integration evidence, not ChatGPT app UI evidence.",
    "Before calling OpenAI, the smoke directly preflights hosted /mcp for search/fetch tools plus data-backed search/fetch results.",
    "",
    "Required environment:",
    "  OPENAI_API_KEY              OpenAI API key. Use --api-key-env to choose another variable.",
    "",
    "Options:",
    "  --hosted-url <url>          Hosted VRDex MCP URL.",
    "  --hosted-data               Required. Require data-backed search and fetch calls.",
    "  --hosted-query <query>      Search query. Defaults to club when --hosted-data is set.",
    "  --hosted-type <type>        Kept for matrix row metadata; compatibility search always uses all.",
    "  --hosted-limit <n>          Kept for matrix row metadata; compatibility search returns server-bounded results.",
    "  --model <model>             OpenAI model. Defaults to gpt-4.1-mini.",
    "  --endpoint <url>            Responses endpoint. Defaults to https://api.openai.com/v1/responses.",
    "  --api-key-env <name>        Environment variable containing the API key.",
    "  --request-timeout-ms <n>    Live Responses API timeout. Defaults to 90000.",
    "  --fixture <path>            Read a saved Responses API JSON payload instead of calling OpenAI.",
    "  --help                      Show this help.",
  ].join("\n"));
}

function parseArgs(argv: string[]): OpenAiMcpOptions {
  const apiKeyEnvName = nonEmpty(process.env.VRDEX_OPENAI_MCP_API_KEY_ENV) ?? "OPENAI_API_KEY";
  const options: OpenAiMcpOptions = {
    apiKey: nonEmpty(process.env[apiKeyEnvName]),
    apiKeyEnvName,
    endpoint: nonEmpty(process.env.VRDEX_OPENAI_MCP_ENDPOINT) ?? "https://api.openai.com/v1/responses",
    fixturePath: nonEmpty(process.env.VRDEX_OPENAI_MCP_RESPONSES_FIXTURE),
    hostedDataPublicReads: envFlag("VRDEX_OPENAI_MCP_HOSTED_DATA"),
    hostedSearch: {
      limit: parseHostedSearchLimit(process.env.VRDEX_OPENAI_MCP_HOSTED_LIMIT),
      query: process.env.VRDEX_OPENAI_MCP_HOSTED_QUERY?.trim() ?? "",
      type: parseHostedSearchType(process.env.VRDEX_OPENAI_MCP_HOSTED_TYPE),
    },
    hostedUrl: nonEmpty(process.env.VRDEX_OPENAI_MCP_HOSTED_URL),
    model: nonEmpty(process.env.VRDEX_OPENAI_MCP_MODEL) ?? "gpt-4.1-mini",
    requestTimeoutMs: parseRequestTimeoutMs(process.env.VRDEX_OPENAI_MCP_REQUEST_TIMEOUT_MS),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    switch (arg) {
      case "--":
        break;
      case "--api-key-env": {
        options.apiKeyEnvName = takeValue(argv, index, arg);
        options.apiKey = nonEmpty(process.env[options.apiKeyEnvName]);
        index += 1;
        break;
      }
      case "--endpoint":
        options.endpoint = takeValue(argv, index, arg);
        index += 1;
        break;
      case "--fixture":
        options.fixturePath = takeValue(argv, index, arg);
        index += 1;
        break;
      case "--hosted-data":
      case "--hosted-data-public-reads":
        options.hostedDataPublicReads = true;
        break;
      case "--hosted-limit":
        options.hostedSearch.limit = parseHostedSearchLimit(takeValue(argv, index, arg));
        index += 1;
        break;
      case "--hosted-query":
        options.hostedSearch.query = takeValue(argv, index, arg).trim();
        index += 1;
        break;
      case "--hosted-type":
        options.hostedSearch.type = parseHostedSearchType(takeValue(argv, index, arg));
        index += 1;
        break;
      case "--hosted-url":
        options.hostedUrl = takeValue(argv, index, arg);
        index += 1;
        break;
      case "--model":
        options.model = takeValue(argv, index, arg);
        index += 1;
        break;
      case "--request-timeout-ms":
        options.requestTimeoutMs = parseRequestTimeoutMs(takeValue(argv, index, arg));
        index += 1;
        break;
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (options.hostedDataPublicReads && !options.hostedSearch.query) {
    options.hostedSearch.query = "club";
  }

  assert.ok(nonEmpty(options.hostedUrl), "--hosted-url or VRDEX_OPENAI_MCP_HOSTED_URL is required.");
  assert.notEqual(options.model.trim(), "", "--model must not be empty.");
  assert.notEqual(options.endpoint.trim(), "", "--endpoint must not be empty.");
  assert.ok(
    options.hostedDataPublicReads,
    "--hosted-data is required because the OpenAI compatibility smoke must search and then fetch a real result.",
  );
  if (options.hostedDataPublicReads) {
    assert.notEqual(options.hostedSearch.query, "", "--hosted-data requires a non-empty hosted search query.");
  }
  if (options.fixturePath === undefined) {
    assert.ok(
      options.apiKey,
      `${options.apiKeyEnvName} is required for OpenAI Responses API MCP smoke evidence. Use --fixture only for tests.`,
    );
  }

  return options;
}

function buildResponsesPayload(options: OpenAiMcpOptions) {
  const search = options.hostedSearch;

  return {
    input: [
      {
        content: [
          {
            text: [
              "You are validating a remote MCP server.",
              "You must call the search MCP tool exactly once, then call the fetch MCP tool exactly once using the first search result id before answering.",
            ].join(" "),
            type: "input_text",
          },
        ],
        role: "developer",
      },
      {
        content: [
          {
            text: [
              "Call the VRDex MCP search tool.",
              `Use query ${JSON.stringify(search.query)}.`,
              "Then fetch the first result returned by search.",
              "After the tool returns, respond exactly openai-mcp-ok and no other text.",
            ].join(" "),
            type: "input_text",
          },
        ],
        role: "user",
      },
    ],
    model: options.model,
    reasoning: {
      summary: "auto",
    },
    tools: [
      {
        allowed_tools: ["search", "fetch"],
        require_approval: "never",
        server_label: "vrdex",
        server_url: options.hostedUrl,
        type: "mcp",
      },
    ],
  };
}

async function fetchResponsesPayload(options: OpenAiMcpOptions) {
  if (options.fixturePath !== undefined) {
    return JSON.parse(await readFile(options.fixturePath, "utf8")) as unknown;
  }

  let response: Response;

  try {
    response = await fetch(options.endpoint, {
      body: JSON.stringify(buildResponsesPayload(options)),
      headers: {
        authorization: `Bearer ${options.apiKey}`,
        "content-type": "application/json",
      },
      method: "POST",
      signal: AbortSignal.timeout(options.requestTimeoutMs),
    });
  } catch (error) {
    if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) {
      throw new Error(
        `OpenAI Responses API MCP smoke timed out after ${options.requestTimeoutMs}ms for ${options.hostedUrl}. The remote MCP target may be unavailable or returning tool errors that prevent the model from completing.`,
      );
    }

    throw error;
  }

  const text = await response.text();

  assert.equal(
    response.ok,
    true,
    `OpenAI Responses API MCP smoke failed with HTTP ${response.status}: ${text.slice(0, 500)}`,
  );

  return JSON.parse(text) as unknown;
}

function collectStrings(value: unknown): string[] {
  if (typeof value === "string") {
    return [value];
  }

  if (Array.isArray(value)) {
    return value.flatMap((entry) => collectStrings(entry));
  }

  if (value !== null && typeof value === "object") {
    return Object.values(value).flatMap((entry) => collectStrings(entry));
  }

  return [];
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function trimTrailingSlashes(value: string) {
  let end = value.length;

  while (end > 0 && value.charCodeAt(end - 1) === 47) {
    end -= 1;
  }

  return value.slice(0, end);
}

function hostedMcpUrl(rawUrl: string) {
  const url = new URL(rawUrl);
  const pathname = trimTrailingSlashes(url.pathname);

  if (!pathname.endsWith("/mcp")) {
    url.pathname = `${pathname}/mcp`;
  } else {
    url.pathname = pathname;
  }

  return url;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function parseMcpHttpResponse(response: Response) {
  const text = await response.text();
  const trimmed = text.trim();

  if (!trimmed) {
    return undefined;
  }

  if (trimmed.startsWith("{")) {
    return JSON.parse(trimmed) as unknown;
  }

  const dataLine = trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.startsWith("data:"));

  return dataLine === undefined ? undefined : (JSON.parse(dataLine.slice("data:".length).trim()) as unknown);
}

async function assertMcpHttpStatus(response: Response, expectedStatus: number, label: string) {
  if (response.status === expectedStatus) {
    return;
  }

  const text = await response.text();
  const body = text.trim() ? text.slice(0, 500) : "<empty body>";

  throw new Error(`${label} expected HTTP ${expectedStatus}, got HTTP ${response.status}: ${body}`);
}

async function postMcpJsonRpc(url: URL, body: JsonRpcMessage) {
  return fetch(url, {
    body: JSON.stringify(body),
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      "mcp-protocol-version": "2025-06-18",
    },
    method: "POST",
  });
}

function toolNamesFromListResponse(payload: unknown) {
  if (!isRecord(payload) || !isRecord(payload.result) || !Array.isArray(payload.result.tools)) {
    throw new Error(`Hosted MCP tools/list did not return a tools array: ${summarizeMcpToolFailure(payload)}`);
  }

  return payload.result.tools
    .map((tool) => (isRecord(tool) && typeof tool.name === "string" ? tool.name : undefined))
    .filter((toolName): toolName is string => toolName !== undefined);
}

function assertNoMcpToolError(payload: unknown, label: string) {
  if (!isRecord(payload)) {
    throw new Error(`${label} returned an invalid MCP response: ${summarizeMcpToolFailure(payload)}`);
  }

  if (payload.error !== undefined || (isRecord(payload.result) && payload.result.isError === true)) {
    throw new Error(`${label} failed: ${summarizeMcpToolFailure(payload)}`);
  }
}

async function assertOpenAiMcpTargetReady(options: OpenAiMcpOptions) {
  const url = hostedMcpUrl(options.hostedUrl!);

  const initialized = await postMcpJsonRpc(url, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      capabilities: {},
      clientInfo: { name: "vrdex-openai-mcp-smoke", version: "0.0.0" },
      protocolVersion: "2025-06-18",
    },
  });

  await assertMcpHttpStatus(initialized, 200, "OpenAI hosted MCP preflight initialize");
  assertNoMcpToolError(await parseMcpHttpResponse(initialized), "OpenAI hosted MCP preflight initialize");

  const listed = await postMcpJsonRpc(url, {
    jsonrpc: "2.0",
    id: 2,
    method: "tools/list",
    params: {},
  });

  await assertMcpHttpStatus(listed, 200, "OpenAI hosted MCP preflight tools/list");

  const toolNames = toolNamesFromListResponse(await parseMcpHttpResponse(listed));
  const missingTools = openAiRequiredHostedTools.filter((toolName) => !toolNames.includes(toolName));

  if (missingTools.length > 0) {
    throw new Error(
      `Hosted MCP target ${url.href} does not expose OpenAI-compatible ${missingTools.join(", ")} tool(s). Found tools: ${toolNames.join(", ") || "<none>"}.`,
    );
  }

  const searchResponse = await postMcpJsonRpc(url, {
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: {
      arguments: { query: options.hostedSearch.query },
      name: "search",
    },
  });

  await assertMcpHttpStatus(searchResponse, 200, "OpenAI hosted MCP preflight search");

  const searchPayload = await parseMcpHttpResponse(searchResponse);

  assertNoMcpToolError(searchPayload, "OpenAI hosted MCP preflight search");

  const results =
    isRecord(searchPayload) && isRecord(searchPayload.result) && isRecord(searchPayload.result.structuredContent)
      ? searchPayload.result.structuredContent.results
      : undefined;

  assert.equal(Array.isArray(results), true, "OpenAI hosted MCP preflight search did not return results.");
  assert.ok(
    results.length > 0,
    `OpenAI hosted MCP preflight search returned no results for query ${JSON.stringify(options.hostedSearch.query)}.`,
  );

  const firstResult = results[0];
  const firstResultId = isRecord(firstResult) && typeof firstResult.id === "string" ? firstResult.id : undefined;

  assert.ok(firstResultId, "OpenAI hosted MCP preflight search first result did not include an id.");

  const fetchResponse = await postMcpJsonRpc(url, {
    jsonrpc: "2.0",
    id: 4,
    method: "tools/call",
    params: {
      arguments: { id: firstResultId },
      name: "fetch",
    },
  });

  await assertMcpHttpStatus(fetchResponse, 200, "OpenAI hosted MCP preflight fetch");

  const fetchPayload = await parseMcpHttpResponse(fetchResponse);

  assertNoMcpToolError(fetchPayload, "OpenAI hosted MCP preflight fetch");

  const text =
    isRecord(fetchPayload) && isRecord(fetchPayload.result) && isRecord(fetchPayload.result.structuredContent)
      ? fetchPayload.result.structuredContent.text
      : undefined;

  assert.equal(typeof text, "string", "OpenAI hosted MCP preflight fetch did not return document text.");
  assert.notEqual(text.trim(), "", "OpenAI hosted MCP preflight fetch returned empty document text.");
}

function assertOpenAiMcpResponse(payload: unknown, options: OpenAiMcpOptions) {
  const serialized = JSON.stringify(payload);
  const strings = collectStrings(payload);

  assert.match(serialized, /"name":"search"/, "OpenAI response did not include a search MCP tool call.");
  assert.match(serialized, /"name":"fetch"/, "OpenAI response did not include a fetch MCP tool call.");

  if (options.hostedDataPublicReads) {
    assert.match(
      serialized,
      new RegExp(escapeRegExp(options.hostedSearch.query)),
      "OpenAI response did not include the hosted search query.",
    );
    assert.ok(
      strings.some((entry) => entry.includes("results")),
      "OpenAI response did not include structured hosted MCP search results.",
    );
    assert.ok(
      strings.some((entry) => entry.includes("text")),
      "OpenAI response did not include structured hosted MCP fetch text.",
    );
  }

  assert.match(serialized, /openai-mcp-ok/, "OpenAI response did not include the expected openai-mcp-ok final answer.");
}

async function main() {
  if (process.argv.slice(2).includes("--help")) {
    printHelp();
    return;
  }

  loadRepoEnvLocal();

  const options = parseArgs(process.argv.slice(2));

  if (options.fixturePath === undefined) {
    await assertOpenAiMcpTargetReady(options);
  }

  const payload = await fetchResponsesPayload(options);

  assertOpenAiMcpResponse(payload, options);

  console.log("| Smoke target | Status | Details |");
  console.log("| --- | --- | --- |");
  console.log(
    `| OpenAI Responses API hosted anonymous MCP | pass | ${options.model} called search and fetch for ${options.hostedUrl} with query=${JSON.stringify(options.hostedSearch.query)}, type=${options.hostedSearch.type}, limit=${options.hostedSearch.limit} |`,
  );
  console.log(
    "| ChatGPT app hosted MCP | skip | Responses API smoke is API integration evidence; record ChatGPT Apps/Connectors UI evidence separately when product access is available |",
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
