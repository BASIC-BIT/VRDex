import {
  hashOAuthClientSecretValue,
  normalizeOAuthClientId,
  normalizeOAuthRedirectUris,
  parseOAuthClientSecretValue,
} from "@vrdex/api-contracts";

import {
  basicClientCredentials,
  clientSecretPepper,
  tokenClientAuthentication,
} from "./oauth-token-client-auth";
import {
  createOAuthAccessTokenId,
  oauthAccessTokenExpiresAt,
  oauthAccessTokenExpiresInSeconds,
  oauthIssuerUrl,
  oauthScopeString,
  oauthSupportedResources,
  parseOAuthScopeString,
  signOAuthAccessToken,
} from "./oauth-jwt";
import {
  deriveS256CodeChallenge,
  createOAuthRefreshTokenValue,
  hashOAuthAuthorizationCodeValue,
  hashOAuthRefreshTokenValue,
  normalizeOAuthAuthorizationCodeValue,
  normalizeOAuthCodeVerifier,
  normalizeOAuthRefreshTokenValue,
  refreshTokenPepper,
} from "./oauth-pkce";
import { normalizedOAuthResourceIndicator } from "./oauth-resource-indicator";

type OAuthScope = ReturnType<typeof parseOAuthScopeString>[number];

type AuthorizationCodeMutationInput = {
  clientId: string;
  codeHash: string;
  derivedCodeChallenge: string;
  expiresAt: number;
  redirectUri: string;
  refreshTokenExpiresAt: number;
  refreshTokenHash: string;
  resource?: string;
  secretPrefix?: string;
  tokenId: string;
  verifierHash?: string;
};

type RefreshTokenMutationInput = {
  clientId: string;
  expiresAt: number;
  refreshTokenExpiresAt: number;
  refreshTokenHash: string;
  replacementRefreshTokenHash: string;
  requestedScopes?: OAuthScope[];
  resource?: string;
  secretPrefix?: string;
  tokenId: string;
  verifierHash?: string;
};

export type ClientCredentialsMutationInput = {
  clientId: string;
  expiresAt: number;
  requestedScopes: OAuthScope[];
  resource: string;
  secretPrefix: string;
  tokenId: string;
  verifierHash: string;
};

type UserAccessTokenResult = {
  clientId: string;
  expiresAt: number;
  ok: true;
  resource: string;
  scopes: OAuthScope[];
  tokenId: string;
  userId: string;
};

type ClientCredentialsResult =
  | {
      clientId: string;
      expiresAt: number;
      ok: true;
      resource: string;
      scopes: OAuthScope[];
      tokenId: string;
    }
  | { ok: false; reason: "invalid_client" | "invalid_scope" };

type AuthorizationCodeResult =
  | (UserAccessTokenResult & { refreshTokenIssued: boolean })
  | {
      ok: false;
      reason: "invalid_client" | "invalid_grant";
      rejectionReason?:
        | "client_mismatch"
        | "code_expired"
        | "code_not_active"
        | "code_not_found"
        | "pkce_mismatch"
        | "redirect_mismatch"
        | "resource_mismatch"
        | "unsupported_challenge_method";
      redirectDiagnostics?: {
        authorizationLength: number;
        firstMismatchIndex: number;
        tokenRequestLength: number;
      };
    };

type RefreshTokenResult =
  | UserAccessTokenResult
  | { ok: false; reason: "invalid_client" | "invalid_grant" | "invalid_scope" };

export type OAuthTokenMutations = {
  consumeAuthorizationCode: (input: AuthorizationCodeMutationInput) => Promise<AuthorizationCodeResult>;
  issueClientCredentialsAccessToken: (input: ClientCredentialsMutationInput) => Promise<ClientCredentialsResult>;
  rotateRefreshToken: (input: RefreshTokenMutationInput) => Promise<RefreshTokenResult>;
};

export type OAuthTokenDependencies = {
  createAccessTokenId?: () => string;
  createRefreshTokenValue?: () => string;
  mutations: OAuthTokenMutations;
  now?: () => number;
};

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
  const resource = normalizedOAuthResourceIndicator(request, form);
  const supportedResources = oauthSupportedResources(request);

  if (!resource) {
    return supportedResources[0];
  }

  return resource;
}

function requestedAuthorizationCodeResource(request: Request, form: FormData) {
  const resource = normalizedOAuthResourceIndicator(request, form);

  if (!resource) {
    return undefined;
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

function nowMs(dependencies: OAuthTokenDependencies) {
  return dependencies.now?.() ?? Date.now();
}

function accessTokenId(dependencies: OAuthTokenDependencies) {
  return dependencies.createAccessTokenId?.() ?? createOAuthAccessTokenId();
}

function refreshTokenValue(dependencies: OAuthTokenDependencies) {
  return dependencies.createRefreshTokenValue?.() ?? createOAuthRefreshTokenValue();
}

async function authorizationCodeTokenResponse(
  request: Request,
  form: FormData,
  dependencies: OAuthTokenDependencies,
) {
  const clientAuthentication = await tokenClientAuthentication(request, form);
  if (!clientAuthentication.ok) {
    return clientAuthentication.response;
  }

  let codeHash: string;
  let redirectUri: string;
  let resource: string | undefined;
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

  const now = nowMs(dependencies);
  const expiresAt = oauthAccessTokenExpiresAt(now);
  const tokenId = accessTokenId(dependencies);
  const refreshToken = refreshTokenValue(dependencies);
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

  const result = await dependencies.mutations.consumeAuthorizationCode({
    clientId: clientAuthentication.clientId,
    codeHash,
    redirectUri,
    ...(resource === undefined ? {} : { resource }),
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

    console.warn(JSON.stringify({
      event: "oauth_authorization_code_rejected",
      reason: result.rejectionReason ?? "unspecified",
      ...(result.redirectDiagnostics === undefined
        ? {}
        : { redirectDiagnostics: result.redirectDiagnostics }),
    }));

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
      ...(result.refreshTokenIssued ? { refresh_token: refreshToken } : {}),
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

async function refreshTokenResponse(
  request: Request,
  form: FormData,
  dependencies: OAuthTokenDependencies,
) {
  const clientAuthentication = await tokenClientAuthentication(request, form);
  if (!clientAuthentication.ok) {
    return clientAuthentication.response;
  }

  let refreshToken: string;
  let resource: string | undefined;
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

  const now = nowMs(dependencies);
  const expiresAt = oauthAccessTokenExpiresAt(now);
  const tokenId = accessTokenId(dependencies);
  const replacementRefreshToken = refreshTokenValue(dependencies);
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

  const result = await dependencies.mutations.rotateRefreshToken({
    clientId: clientAuthentication.clientId,
    refreshTokenHash,
    replacementRefreshTokenHash,
    requestedScopes: scopes,
    ...(resource === undefined ? {} : { resource }),
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

async function clientCredentialsTokenResponse(
  request: Request,
  form: FormData,
  dependencies: OAuthTokenDependencies,
) {
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

  const now = nowMs(dependencies);
  const expiresAt = oauthAccessTokenExpiresAt(now);
  const tokenId = accessTokenId(dependencies);
  const result = await dependencies.mutations.issueClientCredentialsAccessToken({
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

export async function oauthTokenResponse(
  request: Request,
  dependencies: OAuthTokenDependencies,
) {
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
    return await authorizationCodeTokenResponse(request, form, dependencies);
  }

  if (grantType === "refresh_token") {
    return await refreshTokenResponse(request, form, dependencies);
  }

  if (grantType === "client_credentials") {
    return await clientCredentialsTokenResponse(request, form, dependencies);
  }

  return oauthProblem(400, "unsupported_grant_type", "Supported grant types are authorization_code, refresh_token, and client_credentials.");
}
