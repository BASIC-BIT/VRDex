import {
  getBearerTokenFromAuthorizationHeader,
  type ApiRouteClass,
  type ApiScope,
} from "@vrdex/api-contracts";

import {
  apiProblemResponse,
  evaluateOptionalApiBearerRequest,
  type ApiBearerCredentialContext,
  type ApiBearerRequestContext,
} from "./api-v0";

export type ApiUserAuthority =
  | {
      ok: true;
      ownerUserId: string;
      source: "personal_api_token" | "user_delegated_oauth";
    }
  | {
      ok: false;
      reason: "anonymous" | "non_user_authority";
    };

function missingBearerResponse(requiredScope: ApiScope) {
  return apiProblemResponse({
    type: "about:blank",
    title: "Bearer token required",
    status: 401,
    detail: `Send a personal API token or API-resource OAuth access token with ${requiredScope} scope.`,
  });
}

function insufficientUserAuthorityResponse(requiredScope: ApiScope) {
  return apiProblemResponse({
    type: "about:blank",
    title: "User authority is insufficient",
    status: 403,
    detail:
      `This route requires a user-owned personal API token or a user-delegated API-resource OAuth access token with ${requiredScope} scope.`,
  });
}

export function apiUserAuthorityForCredential(credential: ApiBearerCredentialContext): ApiUserAuthority {
  if (credential.kind === "anonymous") {
    return { ok: false, reason: "anonymous" };
  }

  if (credential.kind === "api_token" && credential.ownerKind === "user") {
    return {
      ok: true,
      ownerUserId: credential.ownerUserId,
      source: "personal_api_token",
    };
  }

  if (credential.kind === "oauth" && credential.subjectType === "user" && credential.userId !== undefined) {
    return {
      ok: true,
      ownerUserId: credential.userId,
      source: "user_delegated_oauth",
    };
  }

  return { ok: false, reason: "non_user_authority" };
}

async function evaluateApiUserCredentialRequest(
  request: Request,
  options: {
    requiredScope: ApiScope;
    routeClass: ApiRouteClass;
  },
): Promise<
  | {
      ok: true;
      context: ApiBearerRequestContext;
      ownerUserId: string;
      source: "personal_api_token" | "user_delegated_oauth";
    }
  | {
      ok: false;
      response: Response;
    }
> {
  if (getBearerTokenFromAuthorizationHeader(request.headers.get("authorization")) === null) {
    return { ok: false, response: missingBearerResponse(options.requiredScope) };
  }

  const evaluation = await evaluateOptionalApiBearerRequest(request, {
    requiredScopes: [options.requiredScope],
    routeClass: options.routeClass,
  });

  if (!evaluation.ok) {
    return { ok: false, response: evaluation.response };
  }

  const authority = apiUserAuthorityForCredential(evaluation.context.credential);

  if (!authority.ok) {
    return { ok: false, response: insufficientUserAuthorityResponse(options.requiredScope) };
  }

  return {
    ok: true,
    context: evaluation.context,
    ownerUserId: authority.ownerUserId,
    source: authority.source,
  };
}

export async function evaluateApiUserReadRequest(
  request: Request,
  options: {
    requiredScope: ApiScope;
  },
) {
  return await evaluateApiUserCredentialRequest(request, {
    ...options,
    routeClass: "authenticated_public_read",
  });
}

/**
 * Whether the validated credential carries a scope, for authority a route must
 * check beyond the one it required to get in.
 *
 * Profile writes need this because the authority depends on the target: editing
 * your own profile is `profile:write`, and correcting somebody else's unclaimed
 * one is a wider grant the user has to have made separately.
 */
export function apiCredentialHasScope(
  context: { credential: { kind: string; scopes?: readonly string[] } },
  scope: ApiScope,
) {
  return context.credential.scopes?.includes(scope) === true;
}

export async function evaluateApiUserWriteRequest(
  request: Request,
  options: {
    requiredScope: ApiScope;
  },
) {
  return await evaluateApiUserCredentialRequest(request, {
    ...options,
    routeClass: "public_write",
  });
}

export async function evaluateApiUserAssetUploadRequest(
  request: Request,
  options: {
    requiredScope: ApiScope;
  },
) {
  return await evaluateApiUserCredentialRequest(request, {
    ...options,
    routeClass: "asset_upload_intent",
  });
}
