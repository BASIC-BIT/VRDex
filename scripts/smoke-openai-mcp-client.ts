import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { loadRepoEnvLocal } from "./env-local";

type HostedSearchType = "all" | "community" | "event" | "person" | "profile" | "world";

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
    "  --model <model>             OpenAI model. Defaults to o4-mini-deep-research.",
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
    model: nonEmpty(process.env.VRDEX_OPENAI_MCP_MODEL) ?? "o4-mini-deep-research",
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
