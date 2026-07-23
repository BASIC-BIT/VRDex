import { createPrivateKey, createPublicKey, randomBytes, sign, verify, type JsonWebKey } from "node:crypto";

import { oauthApiScopes, type ApiScope } from "@vrdex/api-contracts";

const accessTokenTtlSeconds = 60 * 60;
const signingAlgorithm = "RS256";
const publicKeyUse = "sig";

export type OAuthAccessTokenClaims = {
  aud: string;
  client_id: string;
  exp: number;
  iat: number;
  iss: string;
  jti: string;
  scope: string;
  sub: string;
};

type OAuthPublicJwk = JsonWebKey & {
  alg?: string;
  kid?: string;
  use?: string;
};

function base64UrlEncode(value: Buffer | string) {
  return Buffer.from(value).toString("base64url");
}

function base64UrlDecodeJson(value: string) {
  return JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Record<string, unknown>;
}

function signingKeyPem() {
  const key = process.env.VRDEX_OAUTH_ACCESS_TOKEN_SIGNING_KEY?.trim();

  if (!key) {
    throw new Error("VRDEX_OAUTH_ACCESS_TOKEN_SIGNING_KEY is required to issue OAuth access tokens.");
  }

  return key.replace(/\\n/g, "\n");
}

export function oauthAccessTokenSigningConfigured() {
  return Boolean(process.env.VRDEX_OAUTH_ACCESS_TOKEN_SIGNING_KEY?.trim());
}

function signingKeyId() {
  return process.env.VRDEX_OAUTH_ACCESS_TOKEN_SIGNING_KID?.trim() || "vrdex-local";
}

function currentPublicJwk() {
  const publicJwk = createPublicKey(signingKeyPem()).export({ format: "jwk" });

  return withPublicJwkMetadata(publicJwk, signingKeyId());
}

function withPublicJwkMetadata(jwk: JsonWebKey, kid: string) {
  return {
    ...jwk,
    alg: signingAlgorithm,
    kid,
    use: publicKeyUse,
  } satisfies OAuthPublicJwk;
}

function normalizeAdditionalPublicJwk(value: unknown, index: number) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`VRDEX_OAUTH_ACCESS_TOKEN_ADDITIONAL_PUBLIC_JWKS key ${index} must be a JSON object.`);
  }

  const jwk = value as OAuthPublicJwk;
  const kid = jwk.kid?.trim();

  if (!kid) {
    throw new Error(`VRDEX_OAUTH_ACCESS_TOKEN_ADDITIONAL_PUBLIC_JWKS key ${index} must include kid.`);
  }

  if (jwk.alg && jwk.alg !== signingAlgorithm) {
    throw new Error(`VRDEX_OAUTH_ACCESS_TOKEN_ADDITIONAL_PUBLIC_JWKS key ${kid} must use ${signingAlgorithm}.`);
  }

  if (jwk.use && jwk.use !== publicKeyUse) {
    throw new Error(`VRDEX_OAUTH_ACCESS_TOKEN_ADDITIONAL_PUBLIC_JWKS key ${kid} must use ${publicKeyUse}.`);
  }

  const publicJwk = createPublicKey({ key: jwk, format: "jwk" }).export({ format: "jwk" });

  return withPublicJwkMetadata(publicJwk, kid);
}

function additionalPublicJwks() {
  const value = process.env.VRDEX_OAUTH_ACCESS_TOKEN_ADDITIONAL_PUBLIC_JWKS?.trim();

  if (!value) {
    return [];
  }

  const parsed = JSON.parse(value) as { keys?: unknown };

  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.keys)) {
    throw new Error("VRDEX_OAUTH_ACCESS_TOKEN_ADDITIONAL_PUBLIC_JWKS must be a JWKS object with a keys array.");
  }

  return parsed.keys.map(normalizeAdditionalPublicJwk);
}

function oauthPublicVerificationJwks() {
  const byKid = new Map<string, OAuthPublicJwk>();

  for (const jwk of [currentPublicJwk(), ...additionalPublicJwks()]) {
    if (jwk.kid && !byKid.has(jwk.kid)) {
      byKid.set(jwk.kid, jwk);
    }
  }

  return [...byKid.values()];
}

function issuerFromRequest(request: Request) {
  const configured = process.env.VRDEX_OAUTH_ISSUER_URL?.trim();

  if (configured) {
    return new URL(configured).origin;
  }

  return new URL(request.url).origin;
}

function apiResourceFromRequest(request: Request) {
  const configured = process.env.VRDEX_PUBLIC_API_BASE_URL?.trim();

  if (configured) {
    return new URL(configured).origin;
  }

  return new URL(request.url).origin;
}

export function oauthIssuerUrl(request: Request) {
  return issuerFromRequest(request);
}

export function oauthApiResourceUri(request: Request) {
  return apiResourceFromRequest(request);
}

export function oauthMcpResourceUri(request: Request) {
  const configured = process.env.VRDEX_MCP_RESOURCE_URI?.trim();

  if (configured) {
    return configured;
  }

  return `${issuerFromRequest(request)}/mcp`;
}

export function oauthSupportedResources(request: Request) {
  return [...new Set([apiResourceFromRequest(request), oauthMcpResourceUri(request)])];
}

export function createOAuthAccessTokenId() {
  return `vrdx_at_${randomBytes(16).toString("hex")}`;
}

export function oauthAccessTokenExpiresAt(now = Date.now()) {
  return now + accessTokenTtlSeconds * 1000;
}

export function oauthAccessTokenExpiresInSeconds() {
  return accessTokenTtlSeconds;
}

export function parseOAuthScopeString(value: string | null | undefined, fallbackScopes: readonly ApiScope[]) {
  const requested = value?.trim() ? value.trim().split(/\s+/) : [...fallbackScopes];
  const uniqueScopes = [...new Set(requested)];

  for (const scope of uniqueScopes) {
    if (!(oauthApiScopes as readonly string[]).includes(scope)) {
      throw new Error(`Unsupported OAuth scope: ${scope}`);
    }
  }

  return uniqueScopes as ApiScope[];
}

export function oauthScopeString(scopes: readonly string[]) {
  return [...new Set(scopes)].join(" ");
}

export function signOAuthAccessToken(claims: OAuthAccessTokenClaims) {
  const header = {
    alg: signingAlgorithm,
    kid: signingKeyId(),
    typ: "at+jwt",
  };
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(claims));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = sign("RSA-SHA256", Buffer.from(signingInput), createPrivateKey(signingKeyPem()));

  return `${signingInput}.${signature.toString("base64url")}`;
}

export function verifyOAuthAccessToken(token: string, options: { audience: string; issuer: string; now?: number }) {
  const [encodedHeader, encodedPayload, encodedSignature, ...extra] = token.split(".");

  if (!encodedHeader || !encodedPayload || !encodedSignature || extra.length > 0) {
    throw new Error("OAuth access token must be a compact JWT.");
  }

  const header = base64UrlDecodeJson(encodedHeader);

  if (header.alg !== signingAlgorithm) {
    throw new Error("OAuth access token uses an unsupported signing algorithm.");
  }

  if (header.typ !== "at+jwt") {
    throw new Error("OAuth access token type is invalid.");
  }

  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const kid = typeof header.kid === "string" ? header.kid : undefined;
  const publicKeys = oauthPublicVerificationJwks();
  const matchingKeys = kid ? publicKeys.filter((jwk) => jwk.kid === kid) : publicKeys;

  if (matchingKeys.length === 0) {
    throw new Error("OAuth access token signing key is unknown.");
  }

  const isValid = matchingKeys.some((jwk) =>
    verify(
      "RSA-SHA256",
      Buffer.from(signingInput),
      createPublicKey({ key: jwk, format: "jwk" }),
      Buffer.from(encodedSignature, "base64url"),
    ),
  );

  if (!isValid) {
    throw new Error("OAuth access token signature is invalid.");
  }

  const claims = base64UrlDecodeJson(encodedPayload) as Partial<OAuthAccessTokenClaims>;
  const nowSeconds = Math.floor((options.now ?? Date.now()) / 1000);

  if (claims.iss !== options.issuer) {
    throw new Error("OAuth access token issuer is invalid.");
  }

  if (claims.aud !== options.audience) {
    throw new Error("OAuth access token audience is invalid.");
  }

  if (typeof claims.exp !== "number" || claims.exp <= nowSeconds) {
    throw new Error("OAuth access token is expired.");
  }

  if (
    typeof claims.client_id !== "string" ||
    typeof claims.iat !== "number" ||
    typeof claims.jti !== "string" ||
    typeof claims.scope !== "string" ||
    typeof claims.sub !== "string"
  ) {
    throw new Error("OAuth access token is missing required claims.");
  }

  return claims as OAuthAccessTokenClaims;
}

export function oauthPublicJwks() {
  return {
    keys: oauthPublicVerificationJwks(),
  };
}
