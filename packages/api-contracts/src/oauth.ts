import { apiScopes, oauthApiScopes, type ApiScope } from "./auth";

const oauthClientIdHexLength = 24;
const oauthClientMetadataDocumentMaxLength = 2048;
const oauthSecretLookupHexLength = 16;
const oauthSecretVerifierHexLength = 64;
const oauthClientIdPattern = new RegExp(`^vrdx_app_[0-9a-f]{${oauthClientIdHexLength}}$`);
const oauthClientSecretPattern = new RegExp(
  `^vrdx_secret_([0-9a-f]{${oauthSecretLookupHexLength}})\\.([0-9a-f]{${oauthSecretVerifierHexLength}})$`,
);

export const oauthClientTypes = ["public", "confidential"] as const;
export const oauthGrantTypes = ["authorization_code", "refresh_token", "client_credentials"] as const;
export const oauthApplicationStatuses = ["active", "revoked"] as const;
export const oauthDynamicClientStatuses = ["active", "revoked", "promoted"] as const;
export const oauthResponseTypes = ["code"] as const;
export const oauthTokenEndpointAuthMethods = ["none"] as const;
/**
 * What a dynamic MCP client gets when it names no scopes at all.
 *
 * Public reads only. A registration that did not ask has not asked, and the
 * deployment must not answer on its author's behalf.
 */
export const dynamicMcpDefaultClientScopes = ["public:read", "mcp:read"] as const;
/**
 * The read scopes a dynamic MCP client may ask for.
 *
 * `profile:read` is requestable but not default, because `mcp:read` alone is
 * the wrong shape for it: the transport scope says a hosted session may read at
 * all, and must not also mean every such session can enumerate somebody's
 * unpublished drafts. Asking for it gets the same resource scope
 * `/api/v0/me/profiles` asks for, so there is one rule rather than two, and its
 * consent line already says what it grants.
 */
export const dynamicMcpClientScopes = [...dynamicMcpDefaultClientScopes, "profile:read"] as const;
/**
 * The resources a dynamic MCP client may write.
 *
 * `mcp:write` is the transport half and grants nothing on its own -- it says a
 * hosted MCP session may call write tools at all, not which ones. A client pairs
 * it with the resource it actually intends to write, so a set-link agent asks
 * for `profile:write` without also being handed the ability to publish events.
 */
export const dynamicMcpResourceWriteScopes = [
  "assets:write",
  "events:write",
  "profile:write",
  "profile:contribute",
] as const;
export const dynamicMcpWriteScopes = ["mcp:write", ...dynamicMcpResourceWriteScopes] as const;
const resourceWriteScopeList = dynamicMcpResourceWriteScopes.join(", ");
export const OAUTH_CONSENT_TRANSACTION_TTL_MS = 30 * 60 * 1000;

export type OAuthClientType = (typeof oauthClientTypes)[number];
export type OAuthGrantType = (typeof oauthGrantTypes)[number];
export type OAuthApplicationStatus = (typeof oauthApplicationStatuses)[number];
export type OAuthDynamicClientStatus = (typeof oauthDynamicClientStatuses)[number];
export type OAuthResponseType = (typeof oauthResponseTypes)[number];
export type OAuthTokenEndpointAuthMethod = (typeof oauthTokenEndpointAuthMethods)[number];

export type OAuthClientSecretParts = {
  secretPrefix: string;
  secretValue: string;
  verifier: string;
};

export type DynamicMcpClientRegistration = {
  allowedScopes: ApiScope[];
  clientName: string;
  clientType: "public";
  clientUri?: string;
  contacts: string[];
  grantTypes: OAuthGrantType[];
  logoUri?: string;
  redirectUris: string[];
  responseTypes: OAuthResponseType[];
  softwareId?: string;
  softwareVersion?: string;
  tokenEndpointAuthMethod: OAuthTokenEndpointAuthMethod;
};

function randomHex(byteLength: number) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);

  return bytesToHex(bytes);
}

function bytesToHex(bytes: Uint8Array | ArrayBuffer) {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);

  return [...view].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function isLoopbackHostname(hostname: string) {
  const normalized = hostname.toLowerCase();

  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "[::1]" || normalized === "::1";
}

function normalizeUrlString(value: string, options: { label: string; allowLoopbackHttp?: boolean }) {
  let url: URL;

  try {
    url = new URL(value.trim());
  } catch {
    throw new Error(`${options.label} must be an absolute URL.`);
  }

  if (url.username || url.password) {
    throw new Error(`${options.label} must not contain credentials.`);
  }

  if (url.hash) {
    throw new Error(`${options.label} must not contain a fragment.`);
  }

  if (url.protocol === "https:") {
    return url.toString();
  }

  if (options.allowLoopbackHttp === true && url.protocol === "http:" && isLoopbackHostname(url.hostname)) {
    return url.toString();
  }

  throw new Error(`${options.label} must use HTTPS${options.allowLoopbackHttp ? " or loopback HTTP" : ""}.`);
}

export function createOAuthClientId() {
  return `vrdx_app_${randomHex(12)}`;
}

export function normalizeOAuthClientMetadataDocumentUrl(value: string) {
  const raw = value.trim();
  let url: URL;

  if (raw.length > oauthClientMetadataDocumentMaxLength) {
    throw new Error("OAuth client metadata document URL must be 2048 characters or fewer.");
  }

  try {
    url = new URL(raw);
  } catch {
    throw new Error("OAuth client metadata document URL must be an absolute URL.");
  }

  if (url.protocol !== "https:") {
    throw new Error("OAuth client metadata document URL must use HTTPS.");
  }

  if (url.username || url.password) {
    throw new Error("OAuth client metadata document URL must not contain credentials.");
  }

  if (url.hash) {
    throw new Error("OAuth client metadata document URL must not contain a fragment.");
  }

  if (!url.pathname || url.pathname === "/") {
    throw new Error("OAuth client metadata document URL must include a non-root path.");
  }

  const schemeSeparatorIndex = raw.indexOf("://");
  const afterAuthority = schemeSeparatorIndex < 0 ? "" : raw.slice(schemeSeparatorIndex + 3);
  const rawPathWithSearch = afterAuthority.includes("/") ? afterAuthority.slice(afterAuthority.indexOf("/")) : "";
  const rawPath = rawPathWithSearch.split(/[?#]/)[0] ?? "";

  if (rawPath.split("/").some((segment) => segment === "." || segment === "..")) {
    throw new Error("OAuth client metadata document URL must not contain dot path segments.");
  }

  return url.toString();
}

export function isOAuthClientMetadataDocumentUrl(value: string) {
  try {
    normalizeOAuthClientMetadataDocumentUrl(value);
    return true;
  } catch {
    return false;
  }
}

export function normalizeOAuthClientId(value: string) {
  const clientId = value.trim();

  if (oauthClientIdPattern.test(clientId)) {
    return clientId;
  }

  try {
    return normalizeOAuthClientMetadataDocumentUrl(clientId);
  } catch {
    throw new Error("OAuth client id must use the vrdx_app_<24 hex> format or an HTTPS client metadata document URL.");
  }
}

export function createOAuthClientSecretValue(): OAuthClientSecretParts {
  const lookup = randomHex(8);
  const verifier = randomHex(32);
  const secretPrefix = `vrdx_secret_${lookup}`;

  return {
    secretPrefix,
    verifier,
    secretValue: `${secretPrefix}.${verifier}`,
  };
}

export function parseOAuthClientSecretValue(value: string) {
  const match = oauthClientSecretPattern.exec(value.trim());

  if (match === null) {
    return null;
  }

  return {
    secretPrefix: `vrdx_secret_${match[1]}`,
    verifier: match[2],
  };
}

export async function hashOAuthClientSecretValue(value: string, pepper: string) {
  const normalizedPepper = pepper.trim();

  if (!normalizedPepper) {
    throw new Error("VRDEX_OAUTH_CLIENT_SECRET_PEPPER is required for OAuth client secret hashing.");
  }

  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${normalizedPepper}:${value.trim()}`),
  );

  return bytesToHex(digest);
}

export function normalizeOAuthClientType(value: string): OAuthClientType {
  if ((oauthClientTypes as readonly string[]).includes(value)) {
    return value as OAuthClientType;
  }

  throw new Error("OAuth client type must be public or confidential.");
}

export function normalizeOAuthApplicationName(value: string) {
  const name = value.trim().replace(/\s+/g, " ");

  if (!name) {
    throw new Error("OAuth application name is required.");
  }

  if (name.length > 80) {
    throw new Error("OAuth application name must be 80 characters or fewer.");
  }

  return name;
}

export function normalizeOAuthApplicationDescription(value: string | undefined) {
  const description = value?.trim().replace(/\s+/g, " ");

  if (!description) {
    return undefined;
  }

  return description.slice(0, 500);
}

export function normalizeOAuthOptionalUrl(value: string | undefined, label: string) {
  const raw = value?.trim();

  if (!raw) {
    return undefined;
  }

  return normalizeUrlString(raw, { label });
}

export function normalizeOAuthRedirectUris(values: readonly string[]) {
  if (values.length === 0) {
    throw new Error("At least one OAuth redirect URI is required.");
  }

  if (values.length > 10) {
    throw new Error("OAuth applications can register at most 10 redirect URIs.");
  }

  const redirectUris = values.map((value) =>
    normalizeUrlString(value, { label: "OAuth redirect URI", allowLoopbackHttp: true }),
  );

  return [...new Set(redirectUris)];
}

export function normalizeOAuthScopes(scopes: readonly string[] | undefined): ApiScope[] {
  const requested = scopes === undefined || scopes.length === 0 ? ["public:read"] : scopes;
  const uniqueScopes = [...new Set(requested)];

  for (const scope of uniqueScopes) {
    if (!(oauthApiScopes as readonly string[]).includes(scope)) {
      throw new Error(`Unsupported OAuth scope: ${scope}`);
    }
  }

  return uniqueScopes as ApiScope[];
}

export function normalizeOAuthGrantTypes(
  grantTypes: readonly string[] | undefined,
  clientType: OAuthClientType,
): OAuthGrantType[] {
  const requested =
    grantTypes === undefined || grantTypes.length === 0
      ? clientType === "public"
        ? ["authorization_code", "refresh_token"]
        : ["authorization_code", "refresh_token", "client_credentials"]
      : grantTypes;
  const uniqueGrantTypes = [...new Set(requested)];

  for (const grantType of uniqueGrantTypes) {
    if (!(oauthGrantTypes as readonly string[]).includes(grantType)) {
      throw new Error(`Unsupported OAuth grant type: ${grantType}`);
    }
  }

  if (clientType === "public" && uniqueGrantTypes.includes("client_credentials")) {
    throw new Error("Public OAuth clients cannot use client credentials.");
  }

  return uniqueGrantTypes as OAuthGrantType[];
}

export function normalizeOAuthResponseTypes(values: readonly string[] | undefined): OAuthResponseType[] {
  const requested = values === undefined || values.length === 0 ? ["code"] : values;
  const uniqueResponseTypes = [...new Set(requested)];

  for (const responseType of uniqueResponseTypes) {
    if (!(oauthResponseTypes as readonly string[]).includes(responseType)) {
      throw new Error(`Unsupported OAuth response type: ${responseType}`);
    }
  }

  return uniqueResponseTypes as OAuthResponseType[];
}

export function normalizeOAuthTokenEndpointAuthMethod(
  value: string | undefined,
): OAuthTokenEndpointAuthMethod {
  const method = value?.trim() || "none";

  if ((oauthTokenEndpointAuthMethods as readonly string[]).includes(method)) {
    return method as OAuthTokenEndpointAuthMethod;
  }

  throw new Error("Dynamic MCP clients must use token_endpoint_auth_method=none.");
}

export function normalizeOAuthContactValues(values: readonly string[] | undefined) {
  const contacts = values
    ?.map((value) => value.trim())
    .filter(Boolean)
    .map((value) => value.slice(0, 160)) ?? [];

  if (contacts.length > 5) {
    throw new Error("Dynamic MCP clients can register at most 5 contacts.");
  }

  return [...new Set(contacts)];
}

export function normalizeOAuthSoftwareValue(value: string | undefined, label: string) {
  const normalized = value?.trim().replace(/\s+/g, " ");

  if (!normalized) {
    return undefined;
  }

  if (normalized.length > 120) {
    throw new Error(`${label} must be 120 characters or fewer.`);
  }

  return normalized;
}

function stringArray(value: unknown, label: string) {
  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array of strings.`);
  }

  return value.map((entry) => String(entry));
}

function optionalString(value: unknown, label: string) {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new Error(`${label} must be a string.`);
  }

  return value;
}

const allowedDynamicMcpScopes = [...dynamicMcpClientScopes, ...dynamicMcpWriteScopes];

function scopeValues(value: unknown) {
  if (value === undefined || value === null || value === "") {
    return [...dynamicMcpDefaultClientScopes];
  }

  if (typeof value !== "string") {
    throw new Error("scope must be a space-delimited string.");
  }

  return value.trim().split(/\s+/);
}

export function normalizeDynamicMcpClientRegistration(
  input: Record<string, unknown>,
  options: {
    discardKnownNonMcpScopes?: boolean;
  } = {},
): DynamicMcpClientRegistration {
  const clientName = normalizeOAuthApplicationName(optionalString(input.client_name, "client_name") ?? "VRDex MCP Client");
  const redirectUris = normalizeOAuthRedirectUris(stringArray(input.redirect_uris, "redirect_uris") ?? []);
  const grantTypes = normalizeOAuthGrantTypes(stringArray(input.grant_types, "grant_types"), "public").filter(
    (grantType) => grantType !== "client_credentials",
  );
  const responseTypes = normalizeOAuthResponseTypes(stringArray(input.response_types, "response_types"));
  const tokenEndpointAuthMethod = normalizeOAuthTokenEndpointAuthMethod(
    optionalString(input.token_endpoint_auth_method, "token_endpoint_auth_method"),
  );
  const supportedScopes = allowedDynamicMcpScopes;
  const supportedScopeSet = new Set<ApiScope>(supportedScopes);
  const recognizedMcpScopeSet = supportedScopeSet;
  const requestedScopeValues = scopeValues(input.scope);
  const requestedScopes = options.discardKnownNonMcpScopes === true
    ? [...new Set(requestedScopeValues)].map((scope) => {
      if (!(apiScopes as readonly string[]).includes(scope)) {
        throw new Error(`Unsupported OAuth scope: ${scope}`);
      }

      return scope as ApiScope;
    })
    : normalizeOAuthScopes(requestedScopeValues);
  const requestedMcpScopes = requestedScopes.filter((scope) => recognizedMcpScopeSet.has(scope));
  const unsupportedScopes = requestedScopes.filter((scope) => {
    if (recognizedMcpScopeSet.has(scope)) {
      return !supportedScopeSet.has(scope);
    }

    return options.discardKnownNonMcpScopes !== true || requestedMcpScopes.length === 0;
  });

  if (unsupportedScopes.length > 0) {
    throw new Error(`Dynamic MCP clients can only request ${supportedScopes.join(" ")}.`);
  }

  const allowedScopes = requestedMcpScopes;
  const writeScopesRequested = allowedScopes.some((scope) =>
    (dynamicMcpWriteScopes as readonly ApiScope[]).includes(scope)
  );
  // `mcp:write` plus at least one resource. Either half alone is incoherent: the
  // transport scope with nothing to write reaches no tool, and a resource scope
  // without it cannot open a hosted write session to use.
  const completeWriteScopes = allowedScopes.includes("mcp:write")
    && dynamicMcpResourceWriteScopes.some((scope) => allowedScopes.includes(scope));

  if (writeScopesRequested && !completeWriteScopes) {
    throw new Error(
      `Dynamic MCP write clients must request mcp:write and at least one of ${resourceWriteScopeList}.`,
    );
  }

  if (!allowedScopes.includes("mcp:read") && !completeWriteScopes) {
    throw new Error(
      `Dynamic MCP clients must request mcp:read, or mcp:write with at least one of ${resourceWriteScopeList}.`,
    );
  }

  if (!grantTypes.includes("authorization_code")) {
    throw new Error("Dynamic MCP clients must support authorization_code.");
  }

  if (!responseTypes.includes("code")) {
    throw new Error("Dynamic MCP clients must support response_type=code.");
  }

  const clientUri = normalizeOAuthOptionalUrl(optionalString(input.client_uri, "client_uri"), "client_uri");
  const logoUri = normalizeOAuthOptionalUrl(optionalString(input.logo_uri, "logo_uri"), "logo_uri");
  const softwareId = normalizeOAuthSoftwareValue(optionalString(input.software_id, "software_id"), "software_id");
  const softwareVersion = normalizeOAuthSoftwareValue(
    optionalString(input.software_version, "software_version"),
    "software_version",
  );

  return {
    allowedScopes,
    clientName,
    clientType: "public",
    ...(clientUri === undefined ? {} : { clientUri }),
    contacts: normalizeOAuthContactValues(stringArray(input.contacts, "contacts")),
    grantTypes,
    ...(logoUri === undefined ? {} : { logoUri }),
    redirectUris,
    responseTypes,
    ...(softwareId === undefined ? {} : { softwareId }),
    ...(softwareVersion === undefined ? {} : { softwareVersion }),
    tokenEndpointAuthMethod,
  };
}
