import { api } from "@convex-generated-api";
import {
  hashOAuthClientSecretValue,
  normalizeOAuthClientId,
  normalizeOAuthRedirectUris,
  parseOAuthClientSecretValue,
} from "@vrdex/api-contracts";

import { convexHttpClient } from "@/lib/server/convex-http";
import {
  basicClientCredentials,
  clientSecretPepper,
  tokenClientAuthentication,
} from "@/lib/server/oauth-token-client-auth";
import {
  createOAuthAccessTokenId,
  oauthAccessTokenExpiresAt,
  oauthAccessTokenExpiresInSeconds,
  oauthIssuerUrl,
  oauthMcpResourceUri,
  oauthScopeString,
  oauthSupportedResources,
  parseOAuthScopeString,
  signOAuthAccessToken,
} from "@/lib/server/oauth-jwt";
import {
  deriveS256CodeChallenge,
  createOAuthRefreshTokenValue,
  hashOAuthAuthorizationCodeValue,
  hashOAuthRefreshTokenValue,
  normalizeOAuthAuthorizationCodeValue,
  normalizeOAuthCodeVerifier,
  normalizeOAuthRefreshTokenValue,
  refreshTokenPepper,
} from "@/lib/server/oauth-pkce";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const refreshTokenTtlMs = 30 * 24 * 60 * 60 * 1000;

function oauthProblem(
  status: 400 | 401 | 500,
  error: string,
  errorDescription: string,
  headers: HeadersInit = {},
) {
  return Response.json(
    {
      error,
      error_description: errorDescription,
    },
    {
      headers: {
        "cache-control": "no-store",
        pragma: "no-cache",
        ...headers,
      },
      status,
    },
  );
}

async function formData(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";

  if (!contentType.toLowerCase().includes("application/x-www-form-urlencoded")) {
    throw new Error("OAuth token requests must use application/x-www-form-urlencoded.");
  }

  return await request.formData();
}

function requestedResource(request: Request, form: FormData) {
  const resource = String(form.get("resource") ?? "").trim();
  const supportedResources = oauthSupportedResources(request);

  if (!resource) {
    return supportedResources[0];
  }

  if (!supportedResources.includes(resource)) {
    throw new Error("The requested OAuth resource is not supported by this deployment.");
  }

  return resource;
}

function requestedAuthorizationCodeResource(request: Request, form: FormData) {
  const resource = String(form.get("resource") ?? "").trim();

  if (!resource) {
    return oauthMcpResourceUri(request);
  }

  if (!oauthSupportedResources(request).includes(resource)) {
    throw new Error("The requested OAuth resource is not supported by this deployment.");
  }

  return resource;
}

function requiredFormString(form: FormData, name: string) {
  const value = String(form.get(name) ?? "").trim();

  if (!value) {
    throw new Error(`${name} is required.`);
  }

  return value;
}

async function authorizationCodeTokenResponse(request: Request, form: FormData) {
  const clientAuthentication = await tokenClientAuthentication(request, form);
  if (!clientAuthentication.ok) {
    return clientAuthentication.response;
  }

  let codeHash: string;
  let redirectUri: string;
  let resource: string;
  let derivedCodeChallenge: string;

  try {
    codeHash = await hashOAuthAuthorizationCodeValue(normalizeOAuthAuthorizationCodeValue(requiredFormString(form, "code")));
    redirectUri = normalizeOAuthRedirectUris([requiredFormString(form, "redirect_uri")])[0];
    resource = requestedAuthorizationCodeResource(request, form);
    derivedCodeChallenge = await deriveS256CodeChallenge(normalizeOAuthCodeVerifier(requiredFormString(form, "code_verifier")));
  } catch (error) {
    return oauthProblem(
      400,
      "invalid_request",
      error instanceof Error ? error.message : "The authorization-code token request is invalid.",
    );
  }

  const now = Date.now();
  const expiresAt = oauthAccessTokenExpiresAt(now);
  const tokenId = createOAuthAccessTokenId();
  const refreshToken = createOAuthRefreshTokenValue();
  let refreshTokenHash: string;

  try {
    refreshTokenHash = await hashOAuthRefreshTokenValue(refreshToken, refreshTokenPepper());
  } catch {
    return oauthProblem(
      500,
      "server_error",
      "The server is not configured to issue OAuth refresh tokens.",
    );
  }

  const result = await convexHttpClient().mutation(api.oauthApps.consumeAuthorizationCode, {
    clientId: clientAuthentication.clientId,
    codeHash,
    redirectUri,
    resource,
    derivedCodeChallenge,
    tokenId,
    expiresAt,
    refreshTokenHash,
    refreshTokenExpiresAt: now + refreshTokenTtlMs,
    ...(clientAuthentication.secretPrefix === undefined
      ? {}
      : { secretPrefix: clientAuthentication.secretPrefix }),
    ...(clientAuthentication.verifierHash === undefined
      ? {}
      : { verifierHash: clientAuthentication.verifierHash }),
  });

  if (!result.ok) {
    if (result.reason === "invalid_client") {
      return oauthProblem(401, "invalid_client", "Client authentication failed.");
    }

    return oauthProblem(400, "invalid_grant", "The authorization code is invalid, expired, or already used.");
  }

  const issuer = oauthIssuerUrl(request);
  const issuedAtSeconds = Math.floor(now / 1000);
  const accessToken = signOAuthAccessToken({
    aud: result.resource,
    client_id: result.clientId,
    exp: Math.floor(result.expiresAt / 1000),
    iat: issuedAtSeconds,
    iss: issuer,
    jti: result.tokenId,
    scope: oauthScopeString(result.scopes),
    sub: result.userId,
  });

  return Response.json(
    {
      access_token: accessToken,
      refresh_token: refreshToken,
      token_type: "Bearer",
      expires_in: oauthAccessTokenExpiresInSeconds(),
      scope: oauthScopeString(result.scopes),
    },
    {
      headers: {
        "cache-control": "no-store",
        pragma: "no-cache",
      },
    },
  );
}

async function refreshTokenResponse(request: Request, form: FormData) {
  const clientAuthentication = await tokenClientAuthentication(request, form);
  if (!clientAuthentication.ok) {
    return clientAuthentication.response;
  }

  let refreshToken: string;
  let resource: string;
  let scopes: ReturnType<typeof parseOAuthScopeString> | undefined;

  try {
    refreshToken = normalizeOAuthRefreshTokenValue(requiredFormString(form, "refresh_token"));
    resource = requestedAuthorizationCodeResource(request, form);
    scopes = String(form.get("scope") ?? "").trim()
      ? parseOAuthScopeString(String(form.get("scope") ?? ""), [])
      : undefined;
  } catch (error) {
    return oauthProblem(
      400,
      "invalid_request",
      error instanceof Error ? error.message : "The refresh-token request is invalid.",
    );
  }

  const now = Date.now();
  const expiresAt = oauthAccessTokenExpiresAt(now);
  const tokenId = createOAuthAccessTokenId();
  const replacementRefreshToken = createOAuthRefreshTokenValue();
  let refreshTokenHash: string;
  let replacementRefreshTokenHash: string;

  try {
    const pepper = refreshTokenPepper();

    refreshTokenHash = await hashOAuthRefreshTokenValue(refreshToken, pepper);
    replacementRefreshTokenHash = await hashOAuthRefreshTokenValue(replacementRefreshToken, pepper);
  } catch {
    return oauthProblem(
      500,
      "server_error",
      "The server is not configured to validate OAuth refresh tokens.",
    );
  }

  const result = await convexHttpClient().mutation(api.oauthApps.rotateRefreshToken, {
    clientId: clientAuthentication.clientId,
    refreshTokenHash,
    replacementRefreshTokenHash,
    requestedScopes: scopes,
    resource,
    tokenId,
    expiresAt,
    refreshTokenExpiresAt: now + refreshTokenTtlMs,
    ...(clientAuthentication.secretPrefix === undefined
      ? {}
      : { secretPrefix: clientAuthentication.secretPrefix }),
    ...(clientAuthentication.verifierHash === undefined
      ? {}
      : { verifierHash: clientAuthentication.verifierHash }),
  });

  if (!result.ok) {
    if (result.reason === "invalid_client") {
      return oauthProblem(401, "invalid_client", "Client authentication failed.");
    }

    if (result.reason === "invalid_scope") {
      return oauthProblem(400, "invalid_scope", "The requested scope is not allowed for this refresh token.");
    }

    return oauthProblem(400, "invalid_grant", "The refresh token is invalid, expired, revoked, or already rotated.");
  }

  const issuer = oauthIssuerUrl(request);
  const issuedAtSeconds = Math.floor(now / 1000);
  const accessToken = signOAuthAccessToken({
    aud: result.resource,
    client_id: result.clientId,
    exp: Math.floor(result.expiresAt / 1000),
    iat: issuedAtSeconds,
    iss: issuer,
    jti: result.tokenId,
    scope: oauthScopeString(result.scopes),
    sub: result.userId,
  });

  return Response.json(
    {
      access_token: accessToken,
      refresh_token: replacementRefreshToken,
      token_type: "Bearer",
      expires_in: oauthAccessTokenExpiresInSeconds(),
      scope: oauthScopeString(result.scopes),
    },
    {
      headers: {
        "cache-control": "no-store",
        pragma: "no-cache",
      },
    },
  );
}

export async function POST(request: Request) {
  let form: FormData;

  try {
    form = await formData(request);
  } catch (error) {
    return oauthProblem(
      400,
      "invalid_request",
      error instanceof Error ? error.message : "The OAuth token request is invalid.",
    );
  }

  const grantType = String(form.get("grant_type") ?? "");

  if (grantType === "authorization_code") {
    return await authorizationCodeTokenResponse(request, form);
  }

  if (grantType === "refresh_token") {
    return await refreshTokenResponse(request, form);
  }

  if (grantType !== "client_credentials") {
    return oauthProblem(400, "unsupported_grant_type", "Supported grant types are authorization_code, refresh_token, and client_credentials.");
  }

  const basicCredentials = basicClientCredentials(request);
  const clientId = basicCredentials.clientId ?? String(form.get("client_id") ?? "");
  const clientSecret = basicCredentials.clientSecret ?? String(form.get("client_secret") ?? "");
  const parsedSecret = parseOAuthClientSecretValue(clientSecret);
  let normalizedClientId: string;

  if (!clientId || parsedSecret === null) {
    return oauthProblem(401, "invalid_client", "Client authentication failed.", {
      "www-authenticate": 'Basic realm="VRDex OAuth"',
    });
  }

  try {
    normalizedClientId = normalizeOAuthClientId(clientId);
  } catch {
    return oauthProblem(401, "invalid_client", "Client authentication failed.", {
      "www-authenticate": 'Basic realm="VRDex OAuth"',
    });
  }

  let scopes: ReturnType<typeof parseOAuthScopeString>;
  let resource: string;

  try {
    scopes = parseOAuthScopeString(String(form.get("scope") ?? ""), ["public:read"]);
    resource = requestedResource(request, form);
  } catch (error) {
    return oauthProblem(
      400,
      "invalid_scope",
      error instanceof Error ? error.message : "The requested OAuth scope or resource is invalid.",
    );
  }

  let verifierHash: string;

  try {
    verifierHash = await hashOAuthClientSecretValue(clientSecret, clientSecretPepper());
  } catch {
    return oauthProblem(
      500,
      "server_error",
      "The server is not configured to validate OAuth client secrets.",
    );
  }

  const now = Date.now();
  const expiresAt = oauthAccessTokenExpiresAt(now);
  const tokenId = createOAuthAccessTokenId();
  const convex = convexHttpClient();
  const result = await convex.mutation(api.oauthApps.issueClientCredentialsAccessToken, {
    clientId: normalizedClientId,
    secretPrefix: parsedSecret.secretPrefix,
    verifierHash,
    requestedScopes: scopes,
    resource,
    tokenId,
    expiresAt,
  });

  if (!result.ok) {
    if (result.reason === "invalid_scope") {
      return oauthProblem(400, "invalid_scope", "The requested scope is not allowed for this OAuth client.");
    }

    return oauthProblem(401, "invalid_client", "Client authentication failed.", {
      "www-authenticate": 'Basic realm="VRDex OAuth"',
    });
  }

  const issuer = oauthIssuerUrl(request);
  const issuedAtSeconds = Math.floor(now / 1000);
  const accessToken = signOAuthAccessToken({
    aud: result.resource,
    client_id: result.clientId,
    exp: Math.floor(result.expiresAt / 1000),
    iat: issuedAtSeconds,
    iss: issuer,
    jti: result.tokenId,
    scope: oauthScopeString(result.scopes),
    sub: result.clientId,
  });

  return Response.json(
    {
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: oauthAccessTokenExpiresInSeconds(),
      scope: oauthScopeString(result.scopes),
    },
    {
      headers: {
        "cache-control": "no-store",
        pragma: "no-cache",
      },
    },
  );
}
