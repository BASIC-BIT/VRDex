import { v } from "convex/values";

import type { Id } from "./_generated/dataModel";

export const apiTokenHashVersion = "sha256-pepper-v1";

export const apiScopeValidator = v.union(
  v.literal("public:read"),
  v.literal("profile:read"),
  v.literal("profile:write"),
  v.literal("community:read"),
  v.literal("community:write"),
  v.literal("events:read"),
  v.literal("events:write"),
  v.literal("assets:read"),
  v.literal("assets:write"),
  v.literal("developer:read"),
  v.literal("developer:write"),
  v.literal("mcp:read"),
  v.literal("mcp:write"),
  v.literal("time:parse"),
);

export const apiRouteClassValidator = v.union(
  v.literal("anonymous_public_read"),
  v.literal("profile_asset_file"),
  v.literal("authenticated_public_read"),
  v.literal("developer_credential_management"),
  v.literal("oauth_authorize"),
  v.literal("oauth_token"),
  v.literal("oauth_dynamic_client_registration"),
  v.literal("asset_upload_intent"),
  v.literal("public_write"),
  v.literal("anonymous_mcp_public_read"),
  v.literal("authenticated_mcp"),
  v.literal("authenticated_mcp_write"),
  v.literal("time_parse"),
);

export const apiTokenOwnerKindValidator = v.union(v.literal("user"), v.literal("community"));
export const apiTokenStatusValidator = v.union(v.literal("active"), v.literal("revoked"));
export const apiTokenTrustTierValidator = v.union(v.literal("personal"), v.literal("trusted_partner"));
export const apiTokenEventTypeValidator = v.union(
  v.literal("created"),
  v.literal("validation_accepted"),
  v.literal("validation_rejected"),
  v.literal("revoked"),
);
export const apiTokenValidationResultValidator = v.union(
  v.literal("accepted"),
  v.literal("not_found"),
  v.literal("revoked"),
  v.literal("expired"),
  v.literal("missing_scope"),
);
export const apiStatusCodeClassValidator = v.union(
  v.literal("2xx"),
  v.literal("3xx"),
  v.literal("4xx"),
  v.literal("5xx"),
);

export type ApiScope =
  | "public:read"
  | "profile:read"
  | "profile:write"
  | "community:read"
  | "community:write"
  | "events:read"
  | "events:write"
  | "assets:read"
  | "assets:write"
  | "developer:read"
  | "developer:write"
  | "mcp:read"
  | "mcp:write"
  | "time:parse";

export type ApiRouteClass =
  | "anonymous_public_read"
  | "profile_asset_file"
  | "authenticated_public_read"
  | "developer_credential_management"
  | "oauth_authorize"
  | "oauth_token"
  | "oauth_dynamic_client_registration"
  | "asset_upload_intent"
  | "public_write"
  | "anonymous_mcp_public_read"
  | "authenticated_mcp"
  | "authenticated_mcp_write"
  | "time_parse";

export const apiRouteClassValues: ApiRouteClass[] = [
  "anonymous_public_read",
  "profile_asset_file",
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
];

export type ApiTokenValidationResult =
  | {
      ok: true;
      tokenId: Id<"apiTokens">;
      ownerKind: "user" | "community";
      ownerUserId: Id<"users">;
      ownerCommunityProfileId?: Id<"profiles">;
      trustTier: "personal" | "trusted_partner";
      scopes: ApiScope[];
    }
  | {
      ok: false;
      reason: "not_found" | "revoked" | "expired" | "missing_scope";
    };

export type ApiTokenValidationEventMetadata = {
  eventType: "validation_accepted" | "validation_rejected";
  result: "accepted" | "not_found" | "revoked" | "expired" | "missing_scope";
  statusCodeClass: "2xx" | "4xx";
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
  "time:parse",
]);

const tokenPrefixPattern = /^vrdx_[0-9a-f]{24}$/;
const verifierHashPattern = /^[0-9a-f]{64}$/;

export function normalizeApiTokenLabel(value: string) {
  const label = value.trim().replace(/\s+/g, " ");

  if (!label) {
    throw new Error("API token label is required.");
  }

  if (label.length > 80) {
    throw new Error("API token label must be 80 characters or fewer.");
  }

  return label;
}

export function normalizeApiTokenPrefix(value: string) {
  const tokenPrefix = value.trim();

  if (!tokenPrefixPattern.test(tokenPrefix)) {
    throw new Error("API token prefix must use the vrdx_<24 hex> format.");
  }

  return tokenPrefix;
}

export function normalizeApiTokenVerifierHash(value: string) {
  const verifierHash = value.trim();

  if (!verifierHashPattern.test(verifierHash)) {
    throw new Error("API token verifier hash must be a 64-character lowercase hex digest.");
  }

  return verifierHash;
}

export function normalizeApiTokenScopes(scopes: readonly string[] | undefined): ApiScope[] {
  const requested = scopes === undefined || scopes.length === 0 ? ["public:read"] : scopes;
  const uniqueScopes = [...new Set(requested)];

  for (const scope of uniqueScopes) {
    if (!apiScopes.has(scope as ApiScope)) {
      throw new Error(`Unsupported API token scope: ${scope}`);
    }
  }

  return uniqueScopes as ApiScope[];
}

export function normalizeApiTokenExpiry(expiresAt: number | undefined, now = Date.now()) {
  if (expiresAt === undefined) {
    return undefined;
  }

  if (!Number.isFinite(expiresAt) || expiresAt <= now) {
    throw new Error("API token expiry must be a future timestamp.");
  }

  return Math.floor(expiresAt);
}

export function normalizeApiTokenRevokeReason(value: string | undefined) {
  const reason = value?.trim().replace(/\s+/g, " ");

  if (!reason) {
    return undefined;
  }

  return reason.slice(0, 240);
}

export function hasRequiredApiScopes(grantedScopes: readonly ApiScope[], requiredScopes: readonly ApiScope[]) {
  const granted = new Set(grantedScopes);

  return requiredScopes.every((scope) => granted.has(scope));
}

export function timingSafeEqualString(first: string, second: string) {
  const length = Math.max(first.length, second.length);
  let mismatch = first.length === second.length ? 0 : 1;

  for (let index = 0; index < length; index += 1) {
    mismatch |= (first.charCodeAt(index) || 0) ^ (second.charCodeAt(index) || 0);
  }

  return mismatch === 0;
}

export function validateApiTokenRecord(
  token: {
    _id: Id<"apiTokens">;
    verifierHash: string;
    ownerKind: "user" | "community";
    ownerUserId: Id<"users">;
    ownerCommunityProfileId?: Id<"profiles">;
    scopes: ApiScope[];
    status: "active" | "revoked";
    expiresAt?: number;
    trustTier: "personal" | "trusted_partner";
  } | null,
  input: {
    verifierHash: string;
    requiredScopes: ApiScope[];
    now?: number;
  },
): ApiTokenValidationResult {
  if (token === null || !timingSafeEqualString(token.verifierHash, input.verifierHash)) {
    return { ok: false, reason: "not_found" };
  }

  if (token.status === "revoked") {
    return { ok: false, reason: "revoked" };
  }

  if (token.expiresAt !== undefined && token.expiresAt <= (input.now ?? Date.now())) {
    return { ok: false, reason: "expired" };
  }

  if (!hasRequiredApiScopes(token.scopes, input.requiredScopes)) {
    return { ok: false, reason: "missing_scope" };
  }

  return {
    ok: true,
    tokenId: token._id,
    ownerKind: token.ownerKind,
    ownerUserId: token.ownerUserId,
    ...(token.ownerCommunityProfileId !== undefined
      ? { ownerCommunityProfileId: token.ownerCommunityProfileId }
      : {}),
    trustTier: token.trustTier,
    scopes: token.scopes,
  };
}

export function apiTokenValidationEventMetadata(
  result: ApiTokenValidationResult,
): ApiTokenValidationEventMetadata {
  if (result.ok) {
    return {
      eventType: "validation_accepted",
      result: "accepted",
      statusCodeClass: "2xx",
    };
  }

  return {
    eventType: "validation_rejected",
    result: result.reason,
    statusCodeClass: "4xx",
  };
}
