import { tokenClientAuthentication } from "./oauth-token-client-auth";
import {
  oauthIssuerUrl,
  oauthSupportedResources,
  verifyOAuthAccessToken,
} from "./oauth-jwt";
import {
  hashOAuthRefreshTokenValue,
  normalizeOAuthRefreshTokenValue,
  refreshTokenPepper,
} from "./oauth-pkce";

type RevokeAccessTokenInput = {
  clientId: string;
  tokenId: string;
};

type RevokeRefreshTokenInput = {
  clientId: string;
  refreshTokenHash: string;
  secretPrefix?: string;
  verifierHash?: string;
};

export type OAuthRevokeMutations = {
  revokeClientAccessToken: (input: RevokeAccessTokenInput) => Promise<{ ok: true }>;
  revokeClientRefreshToken: (input: RevokeRefreshTokenInput) => Promise<{ ok: true }>;
};

export type OAuthRevokeDependencies = {
  mutations: OAuthRevokeMutations;
};

async function formData(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";

  if (!contentType.toLowerCase().includes("application/x-www-form-urlencoded")) {
    throw new Error("OAuth revocation requests must use application/x-www-form-urlencoded.");
  }

  return await request.formData();
}

function emptyRevocationResponse() {
  return new Response(null, {
    headers: {
      "cache-control": "no-store",
      pragma: "no-cache",
    },
    status: 200,
  });
}

async function tryRevokeAccessToken(
  request: Request,
  token: string,
  dependencies: OAuthRevokeDependencies,
) {
  const issuer = oauthIssuerUrl(request);

  for (const audience of oauthSupportedResources(request)) {
    try {
      const claims = verifyOAuthAccessToken(token, { audience, issuer });

      await dependencies.mutations.revokeClientAccessToken({
        clientId: claims.client_id,
        tokenId: claims.jti,
      });

      return true;
    } catch {
      // RFC 7009 intentionally keeps revocation responses indistinguishable.
    }
  }

  return false;
}

async function tryRevokeRefreshToken(
  request: Request,
  form: FormData,
  token: string,
  dependencies: OAuthRevokeDependencies,
) {
  try {
    const clientAuthentication = await tokenClientAuthentication(request, form);
    if (!clientAuthentication.ok) {
      return false;
    }

    const refreshTokenHash = await hashOAuthRefreshTokenValue(
      normalizeOAuthRefreshTokenValue(token),
      refreshTokenPepper(),
    );

    await dependencies.mutations.revokeClientRefreshToken({
      clientId: clientAuthentication.clientId,
      refreshTokenHash,
      ...(clientAuthentication.secretPrefix === undefined
        ? {}
        : { secretPrefix: clientAuthentication.secretPrefix }),
      ...(clientAuthentication.verifierHash === undefined
        ? {}
        : { verifierHash: clientAuthentication.verifierHash }),
    });

    return true;
  } catch {
    // RFC 7009 intentionally keeps revocation responses indistinguishable.
    return false;
  }
}

export async function oauthRevokeResponse(
  request: Request,
  dependencies: OAuthRevokeDependencies,
) {
  let form: FormData;

  try {
    form = await formData(request);
  } catch {
    return emptyRevocationResponse();
  }

  const token = String(form.get("token") ?? "").trim();

  if (!token) {
    return emptyRevocationResponse();
  }

  const tokenTypeHint = String(form.get("token_type_hint") ?? "").trim();

  if (tokenTypeHint === "refresh_token") {
    await tryRevokeRefreshToken(request, form, token, dependencies);
  } else {
    const accessRevoked = await tryRevokeAccessToken(request, token, dependencies);

    if (!accessRevoked && tokenTypeHint !== "access_token") {
      await tryRevokeRefreshToken(request, form, token, dependencies);
    }
  }

  return emptyRevocationResponse();
}
