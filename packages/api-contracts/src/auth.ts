export const apiScopes = [
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
  "time:parse",
] as const;

export type ApiScope = (typeof apiScopes)[number];

export const oauthApiScopes = apiScopes.filter(
  (scope): scope is Exclude<ApiScope, "time:parse"> => scope !== "time:parse",
);

export const apiRouteClasses = [
  "anonymous_public_read",
  "authenticated_public_read",
  "developer_credential_management",
  "oauth_authorize",
  "oauth_token",
  "oauth_dynamic_client_registration",
  "asset_upload_intent",
  "public_write",
  "anonymous_mcp_public_read",
  "authenticated_mcp",
  "authenticated_mcp_write",
  "time_parse",
] as const;

export type ApiRouteClass = (typeof apiRouteClasses)[number];

const bearerTokenQueryParams = ["access_token", "api_token", "token"] as const;

export function getBearerTokenFromAuthorizationHeader(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const [scheme, token, ...extra] = value.trim().split(/\s+/);
  if (scheme?.toLowerCase() !== "bearer" || !token || extra.length > 0) {
    return null;
  }

  return token;
}

export function hasBearerTokenInUrl(value: string | URL) {
  const url = typeof value === "string" ? new URL(value, "https://vrdex.invalid") : value;
  return bearerTokenQueryParams.some((key) => url.searchParams.has(key));
}
