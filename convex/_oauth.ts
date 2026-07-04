import { v } from "convex/values";

import { apiScopeValidator, type ApiScope } from "./_apiTokens";

export const oauthClientSecretHashVersion = "sha256-pepper-v1";

export const oauthClientTypeValidator = v.union(v.literal("public"), v.literal("confidential"));
export const oauthApplicationOwnerKindValidator = v.union(v.literal("user"), v.literal("community"));
export const oauthApplicationStatusValidator = v.union(v.literal("active"), v.literal("revoked"));
export const oauthApplicationTrustTierValidator = v.union(v.literal("standard"), v.literal("trusted_partner"));
export const oauthGrantTypeValidator = v.union(
  v.literal("authorization_code"),
  v.literal("refresh_token"),
  v.literal("client_credentials"),
);
export const oauthClientSecretStatusValidator = v.union(v.literal("active"), v.literal("revoked"));
export const oauthClientEventTypeValidator = v.union(
  v.literal("application_created"),
  v.literal("application_updated"),
  v.literal("application_revoked"),
  v.literal("secret_created"),
  v.literal("secret_revoked"),
);
export const oauthClientEventResultValidator = v.union(v.literal("accepted"), v.literal("rejected"));

export type OAuthClientType = "public" | "confidential";
export type OAuthGrantType = "authorization_code" | "refresh_token" | "client_credentials";

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
const clientIdPattern = /^vrdx_app_[0-9a-f]{24}$/;
const secretPrefixPattern = /^vrdx_secret_[0-9a-f]{16}$/;
const verifierHashPattern = /^[0-9a-f]{64}$/;

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

  if (!clientIdPattern.test(clientId)) {
    throw new Error("OAuth client id must use the vrdx_app_<24 hex> format.");
  }

  return clientId;
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

export function normalizeOAuthRevokeReason(value: string | undefined) {
  const reason = value?.trim().replace(/\s+/g, " ");

  if (!reason) {
    return undefined;
  }

  return reason.slice(0, 240);
}
