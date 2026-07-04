import { readFileSync } from "node:fs";

export const defaultVrdexApiBaseUrl = "https://vrdex.net";

export type VrdexMcpOutputMode = "compact" | "detail";

export type VrdexMcpConfig = {
  apiBaseUrl: string;
  bearerToken?: string;
  outputMode: VrdexMcpOutputMode;
};

export type VrdexMcpEnv = Record<string, string | undefined>;

type LoadConfigOptions = {
  readTokenFile?: (path: string) => string;
};

function nonEmpty(value: string | undefined) {
  const trimmed = value?.trim();

  return trimmed ? trimmed : undefined;
}

function firstNonEmpty(...values: Array<string | undefined>) {
  for (const value of values) {
    const normalized = nonEmpty(value);

    if (normalized !== undefined) {
      return normalized;
    }
  }

  return undefined;
}

export function normalizeApiBaseUrl(value: string | undefined = defaultVrdexApiBaseUrl) {
  const raw = nonEmpty(value) ?? defaultVrdexApiBaseUrl;
  const url = new URL(raw);

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("VRDEX_API_BASE_URL must use http or https.");
  }

  url.username = "";
  url.password = "";
  url.search = "";
  url.hash = "";

  const pathWithoutTrailingSlash = url.pathname.replace(/\/+$/, "");
  const normalizedPath =
    pathWithoutTrailingSlash === "" || pathWithoutTrailingSlash === "/"
      ? "/api/v0"
      : pathWithoutTrailingSlash.endsWith("/api/v0")
        ? pathWithoutTrailingSlash
        : `${pathWithoutTrailingSlash}/api/v0`;

  url.pathname = normalizedPath;

  return url.toString().replace(/\/$/, "");
}

function parseOutputMode(value: string | undefined): VrdexMcpOutputMode {
  return value?.trim() === "detail" ? "detail" : "compact";
}

function readAccessTokenFromFile(path: string, readTokenFile: (path: string) => string) {
  const contents = readTokenFile(path).trim();

  if (!contents) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(contents) as unknown;

    if (
      parsed !== null &&
      typeof parsed === "object" &&
      "access_token" in parsed &&
      typeof parsed.access_token === "string"
    ) {
      return nonEmpty(parsed.access_token);
    }
  } catch {
    // Plain token files are supported for simple local OAuth exports.
  }

  return contents;
}

export function loadVrdexMcpConfig(env: VrdexMcpEnv = process.env, options: LoadConfigOptions = {}): VrdexMcpConfig {
  const readTokenFile = options.readTokenFile ?? ((path: string) => readFileSync(path, "utf8"));
  const directToken = firstNonEmpty(env.VRDEX_API_TOKEN, env.VRDEX_OAUTH_ACCESS_TOKEN, env.VRDEX_BEARER_TOKEN);
  const oauthTokenFile = nonEmpty(env.VRDEX_OAUTH_TOKEN_FILE);
  const fileToken = directToken === undefined && oauthTokenFile !== undefined
    ? readAccessTokenFromFile(oauthTokenFile, readTokenFile)
    : undefined;

  return {
    apiBaseUrl: normalizeApiBaseUrl(firstNonEmpty(env.VRDEX_API_BASE_URL, env.VRDEX_PUBLIC_API_BASE_URL)),
    bearerToken: directToken ?? fileToken,
    outputMode: parseOutputMode(env.VRDEX_MCP_OUTPUT_MODE),
  };
}
