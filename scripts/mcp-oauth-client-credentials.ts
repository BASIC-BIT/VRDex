import assert from "node:assert/strict";

export type McpOAuthClientCredentials = {
  clientId?: string;
  clientSecret?: string;
};

export type McpOAuthTokenResult = {
  accessToken: string;
  expiresIn?: number;
  scope?: string;
};

export type McpOAuthCredentialSources = {
  clientIdSource?: string;
  clientSecretSource?: string;
  hasCompleteClientCredentials: boolean;
  hasPartialClientCredentials: boolean;
  hasToken: boolean;
  tokenSource?: string;
};

type FetchTokenOptions = McpOAuthClientCredentials & {
  fetchImpl?: typeof fetch;
  hostedUrl: string;
  scope?: string;
};

function nonEmpty(value: string | undefined) {
  const trimmed = value?.trim();

  return trimmed ? trimmed : undefined;
}

function trimTrailingSlashes(value: string) {
  let end = value.length;

  while (end > 0 && value.charCodeAt(end - 1) === 47) {
    end -= 1;
  }

  return value.slice(0, end);
}

export function hostedMcpResourceUrl(rawUrl: string) {
  const url = new URL(rawUrl);
  const pathname = trimTrailingSlashes(url.pathname);

  url.pathname = pathname.endsWith("/mcp") ? pathname : `${pathname}/mcp`;
  url.search = "";
  url.hash = "";

  return url.toString();
}

export function oauthTokenEndpointFromHostedUrl(rawUrl: string) {
  const url = new URL(hostedMcpResourceUrl(rawUrl));

  url.pathname = "/oauth/token";
  url.search = "";
  url.hash = "";

  return url.toString();
}

export function mcpOAuthClientCredentialsFromEnv(env: NodeJS.ProcessEnv, clientSpecificPrefix: string) {
  return {
    clientId:
      nonEmpty(env[`VRDEX_${clientSpecificPrefix}_OAUTH_CLIENT_ID`])
      ?? nonEmpty(env.VRDEX_MCP_OAUTH_CLIENT_ID),
    clientSecret:
      nonEmpty(env[`VRDEX_${clientSpecificPrefix}_OAUTH_CLIENT_SECRET`])
      ?? nonEmpty(env.VRDEX_MCP_OAUTH_CLIENT_SECRET),
  } satisfies McpOAuthClientCredentials;
}

function firstPresentEnvName(env: NodeJS.ProcessEnv, names: string[]) {
  return names.find((name) => nonEmpty(env[name]) !== undefined);
}

export function mcpOAuthCredentialSourcesFromEnv(
  env: NodeJS.ProcessEnv,
  clientSpecificPrefix: string,
  tokenEnvName?: string,
): McpOAuthCredentialSources {
  const clientIdSource = firstPresentEnvName(env, [
    `VRDEX_${clientSpecificPrefix}_OAUTH_CLIENT_ID`,
    "VRDEX_MCP_OAUTH_CLIENT_ID",
  ]);
  const clientSecretSource = firstPresentEnvName(env, [
    `VRDEX_${clientSpecificPrefix}_OAUTH_CLIENT_SECRET`,
    "VRDEX_MCP_OAUTH_CLIENT_SECRET",
  ]);
  const tokenSource = tokenEnvName === undefined
    ? undefined
    : firstPresentEnvName(env, [tokenEnvName]);

  return {
    clientIdSource,
    clientSecretSource,
    hasCompleteClientCredentials: clientIdSource !== undefined && clientSecretSource !== undefined,
    hasPartialClientCredentials:
      (clientIdSource !== undefined && clientSecretSource === undefined) ||
      (clientIdSource === undefined && clientSecretSource !== undefined),
    hasToken: tokenSource !== undefined,
    tokenSource,
  };
}

export function hasAnyMcpOAuthClientCredentials(credentials: McpOAuthClientCredentials) {
  return credentials.clientId !== undefined || credentials.clientSecret !== undefined;
}

function basicAuthorization(clientId: string, clientSecret: string) {
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
}

function parseTokenJson(text: string) {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(`OAuth token endpoint did not return JSON: ${text.slice(0, 300)}`);
  }
}

function safeOAuthError(payload: Record<string, unknown>, fallbackText: string) {
  if (typeof payload.error_description === "string" && payload.error_description.trim()) {
    return payload.error_description.trim();
  }

  if (typeof payload.error === "string" && payload.error.trim()) {
    return payload.error.trim();
  }

  return fallbackText.slice(0, 300);
}

export async function fetchMcpOAuthClientCredentialsToken(options: FetchTokenOptions): Promise<McpOAuthTokenResult> {
  const clientId = nonEmpty(options.clientId);
  const clientSecret = nonEmpty(options.clientSecret);

  assert.ok(clientId, "OAuth client id is required for hosted MCP OAuth token acquisition.");
  assert.ok(clientSecret, "OAuth client secret is required for hosted MCP OAuth token acquisition.");

  const fetchImpl = options.fetchImpl ?? fetch;
  const resource = hostedMcpResourceUrl(options.hostedUrl);
  const scope = nonEmpty(options.scope) ?? "public:read mcp:read";
  const response = await fetchImpl(oauthTokenEndpointFromHostedUrl(options.hostedUrl), {
    body: new URLSearchParams({
      grant_type: "client_credentials",
      resource,
      scope,
    }),
    headers: {
      authorization: basicAuthorization(clientId, clientSecret),
      "content-type": "application/x-www-form-urlencoded",
    },
    method: "POST",
  });
  const text = await response.text();
  const payload = parseTokenJson(text);

  if (!response.ok) {
    throw new Error(`OAuth client credentials token request failed with HTTP ${response.status}: ${safeOAuthError(payload, text)}`);
  }

  assert.equal(payload.token_type, "Bearer", "OAuth token endpoint must return token_type Bearer.");
  assert.equal(typeof payload.access_token, "string", "OAuth token endpoint must return access_token.");

  const grantedScope = typeof payload.scope === "string" ? payload.scope : undefined;

  assert.ok(
    grantedScope?.split(/\s+/).includes("mcp:read"),
    "OAuth token endpoint must grant mcp:read for hosted MCP OAuth smoke evidence.",
  );

  return {
    accessToken: payload.access_token,
    expiresIn: typeof payload.expires_in === "number" ? payload.expires_in : undefined,
    scope: grantedScope,
  };
}
