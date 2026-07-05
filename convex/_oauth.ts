import { v } from "convex/values";

import type { Id } from "./_generated/dataModel";
import { apiScopeValidator, hasRequiredApiScopes, type ApiScope } from "./_apiTokens";

export const oauthClientSecretHashVersion = "sha256-pepper-v1";

export const oauthClientTypeValidator = v.union(v.literal("public"), v.literal("confidential"));
export const oauthApplicationOwnerKindValidator = v.union(v.literal("user"), v.literal("community"));
export const oauthApplicationStatusValidator = v.union(v.literal("active"), v.literal("revoked"));
export const oauthApplicationTrustTierValidator = v.union(v.literal("standard"), v.literal("trusted_partner"));
export const oauthDynamicClientStatusValidator = v.union(
  v.literal("active"),
  v.literal("revoked"),
  v.literal("promoted"),
);
export const oauthAuthorizationCodeStatusValidator = v.union(
  v.literal("active"),
  v.literal("consumed"),
  v.literal("revoked"),
);
export const oauthRefreshTokenStatusValidator = v.union(
  v.literal("active"),
  v.literal("rotated"),
  v.literal("revoked"),
);
export const oauthCodeChallengeMethodValidator = v.literal("S256");
export const oauthGrantTypeValidator = v.union(
  v.literal("authorization_code"),
  v.literal("refresh_token"),
  v.literal("client_credentials"),
);
export const oauthResponseTypeValidator = v.literal("code");
export const oauthTokenEndpointAuthMethodValidator = v.literal("none");
export const oauthClientSecretStatusValidator = v.union(v.literal("active"), v.literal("revoked"));
export const oauthClientEventTypeValidator = v.union(
  v.literal("application_created"),
  v.literal("application_updated"),
  v.literal("application_revoked"),
  v.literal("authorization_code_issued"),
  v.literal("authorization_code_redeemed"),
  v.literal("dynamic_client_registered"),
  v.literal("refresh_token_rotated"),
  v.literal("secret_created"),
  v.literal("secret_revoked"),
  v.literal("client_credentials_rejected"),
  v.literal("dynamic_client_metadata_refreshed"),
  v.literal("token_issued"),
  v.literal("token_revoked"),
);
export const oauthClientEventResultValidator = v.union(v.literal("accepted"), v.literal("rejected"));
export const oauthAccessTokenSubjectTypeValidator = v.union(v.literal("client"), v.literal("user"));
export const oauthAccessTokenStatusValidator = v.union(v.literal("active"), v.literal("revoked"));

export type OAuthClientType = "public" | "confidential";
export type OAuthGrantType = "authorization_code" | "refresh_token" | "client_credentials";
export type OAuthResponseType = "code";
export type OAuthTokenEndpointAuthMethod = "none";
export type OAuthCodeChallengeMethod = "S256";
export type OAuthAccessTokenValidationResult =
  | {
      ok: true;
      tokenId: string;
      accessTokenRecordId: Id<"oauthAccessTokens">;
      applicationId?: Id<"oauthApplications">;
      dynamicClientId?: Id<"oauthDynamicClients">;
      clientId: string;
      subjectType: "client" | "user";
      userId?: Id<"users">;
      resource: string;
      scopes: ApiScope[];
    }
  | {
      ok: false;
      reason: "not_found" | "wrong_resource" | "revoked" | "expired" | "missing_scope";
    };

const apiScopes = new Set<ApiScope>([
  "public:read",
  "profile:read",
  "profile:write",
  "community:read",
  "community:write",
  "events:read",
  "events:write",
  "assets:read",
  "assets:write",
  "developer:read",
  "developer:write",
  "mcp:read",
  "mcp:write",
]);
const oauthGrantTypes = new Set<OAuthGrantType>([
  "authorization_code",
  "refresh_token",
  "client_credentials",
]);
const oauthResponseTypes = new Set<OAuthResponseType>(["code"]);
const dynamicMcpScopes = new Set<ApiScope>(["public:read", "mcp:read"]);
const clientMetadataDocumentMaxLength = 2048;
const clientIdPattern = /^vrdx_app_[0-9a-f]{24}$/;
const secretPrefixPattern = /^vrdx_secret_[0-9a-f]{16}$/;
const verifierHashPattern = /^[0-9a-f]{64}$/;
const tokenIdPattern = /^vrdx_at_[0-9a-f]{32}$/;
const authorizationCodeHashPattern = /^[0-9a-f]{64}$/;
const refreshTokenHashPattern = /^[0-9a-f]{64}$/;
const codeChallengePattern = /^[A-Za-z0-9_-]{43,128}$/;

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

export function normalizeOAuthClientId(value: string) {
  const clientId = value.trim();

  if (clientIdPattern.test(clientId)) {
    return clientId;
  }

  try {
    return normalizeOAuthClientMetadataDocumentUrl(clientId);
  } catch {
    throw new Error("OAuth client id must use the vrdx_app_<24 hex> format or an HTTPS client metadata document URL.");
  }
}

export function normalizeOAuthClientMetadataDocumentUrl(value: string) {
  const raw = value.trim();
  let url: URL;

  if (raw.length > clientMetadataDocumentMaxLength) {
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

export function normalizeOAuthClientType(value: string): OAuthClientType {
  if (value === "public" || value === "confidential") {
    return value;
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
    if (!apiScopes.has(scope as ApiScope)) {
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
    if (!oauthGrantTypes.has(grantType as OAuthGrantType)) {
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
    if (!oauthResponseTypes.has(responseType as OAuthResponseType)) {
      throw new Error(`Unsupported OAuth response type: ${responseType}`);
    }
  }

  return uniqueResponseTypes as OAuthResponseType[];
}

export function normalizeOAuthTokenEndpointAuthMethod(value: string | undefined): OAuthTokenEndpointAuthMethod {
  const method = value?.trim() || "none";

  if (method === "none") {
    return method;
  }

  throw new Error("Dynamic MCP clients must use token_endpoint_auth_method=none.");
}

export function normalizeOAuthCodeChallengeMethod(value: string | undefined): OAuthCodeChallengeMethod {
  const method = value?.trim() || "S256";

  if (method === "S256") {
    return method;
  }

  throw new Error("OAuth authorization code requests must use PKCE code_challenge_method=S256.");
}

export function normalizeOAuthCodeChallenge(value: string) {
  const codeChallenge = value.trim();

  if (!codeChallengePattern.test(codeChallenge)) {
    throw new Error("OAuth code_challenge must be a valid base64url S256 challenge.");
  }

  return codeChallenge;
}

export function normalizeOAuthAuthorizationCodeHash(value: string) {
  const codeHash = value.trim();

  if (!authorizationCodeHashPattern.test(codeHash)) {
    throw new Error("OAuth authorization code hash must be a 64-character lowercase hex digest.");
  }

  return codeHash;
}

export function normalizeOAuthRefreshTokenHash(value: string) {
  const tokenHash = value.trim();

  if (!refreshTokenHashPattern.test(tokenHash)) {
    throw new Error("OAuth refresh token hash must be a 64-character lowercase hex digest.");
  }

  return tokenHash;
}

export function normalizeOAuthContactValues(values: readonly string[] | undefined) {
  const contacts =
    values
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

export function normalizeDynamicMcpScopes(scopes: readonly string[] | undefined) {
  const normalizedScopes = normalizeOAuthScopes(scopes ?? ["public:read", "mcp:read"]);
  const unsupportedScopes = normalizedScopes.filter((scope) => !dynamicMcpScopes.has(scope));

  if (unsupportedScopes.length > 0) {
    throw new Error("Dynamic MCP clients can only request public:read and mcp:read.");
  }

  if (!normalizedScopes.includes("mcp:read")) {
    throw new Error("Dynamic MCP clients must request mcp:read.");
  }

  return normalizedScopes;
}

export function normalizeOAuthRedirectHost(value: string) {
  const url = new URL(value);

  return url.host.toLowerCase();
}

export function normalizeOAuthClientSecretPrefix(value: string) {
  const secretPrefix = value.trim();

  if (!secretPrefixPattern.test(secretPrefix)) {
    throw new Error("OAuth client secret prefix must use the vrdx_secret_<16 hex> format.");
  }

  return secretPrefix;
}

export function normalizeOAuthClientSecretHash(value: string) {
  const verifierHash = value.trim();

  if (!verifierHashPattern.test(verifierHash)) {
    throw new Error("OAuth client secret verifier hash must be a 64-character lowercase hex digest.");
  }

  return verifierHash;
}

export function normalizeOAuthAccessTokenId(value: string) {
  const tokenId = value.trim();

  if (!tokenIdPattern.test(tokenId)) {
    throw new Error("OAuth access token id must use the vrdx_at_<32 hex> format.");
  }

  return tokenId;
}

export function normalizeOAuthResourceUri(value: string) {
  const normalized = normalizeUrlString(value, { label: "OAuth resource URI", allowLoopbackHttp: true });
  const url = new URL(normalized);

  if (url.pathname === "/" && !url.search) {
    return url.origin;
  }

  return normalized;
}

export function normalizeOAuthTokenExpiry(expiresAt: number, now = Date.now()) {
  if (!Number.isFinite(expiresAt) || expiresAt <= now) {
    throw new Error("OAuth access token expiry must be a future timestamp.");
  }

  return Math.floor(expiresAt);
}

export function validateOAuthAccessTokenRecord(
  token: {
    _id: Id<"oauthAccessTokens">;
    tokenId: string;
    applicationId?: Id<"oauthApplications">;
    dynamicClientId?: Id<"oauthDynamicClients">;
    clientId: string;
    subjectType: "client" | "user";
    userId?: Id<"users">;
    resource: string;
    scopes: ApiScope[];
    status: "active" | "revoked";
    expiresAt: number;
  } | null,
  input: {
    clientId: string;
    resource: string;
    requiredScopes: ApiScope[];
    tokenId: string;
    now?: number;
  },
): OAuthAccessTokenValidationResult {
  if (token === null || token.tokenId !== input.tokenId || token.clientId !== input.clientId) {
    return { ok: false, reason: "not_found" };
  }

  if (token.resource !== input.resource) {
    return { ok: false, reason: "wrong_resource" };
  }

  if (token.status === "revoked") {
    return { ok: false, reason: "revoked" };
  }

  if (token.expiresAt <= (input.now ?? Date.now())) {
    return { ok: false, reason: "expired" };
  }

  if (!hasRequiredApiScopes(token.scopes, input.requiredScopes)) {
    return { ok: false, reason: "missing_scope" };
  }

  return {
    ok: true,
    tokenId: token.tokenId,
    accessTokenRecordId: token._id,
    ...(token.applicationId === undefined ? {} : { applicationId: token.applicationId }),
    ...(token.dynamicClientId === undefined ? {} : { dynamicClientId: token.dynamicClientId }),
    clientId: token.clientId,
    subjectType: token.subjectType,
    ...(token.userId === undefined ? {} : { userId: token.userId }),
    resource: token.resource,
    scopes: token.scopes,
  };
}

export function normalizeOAuthRevokeReason(value: string | undefined) {
  const reason = value?.trim().replace(/\s+/g, " ");

  if (!reason) {
    return undefined;
  }

  return reason.slice(0, 240);
}
