import { getBearerTokenFromAuthorizationHeader } from "@vrdex/api-contracts";

import {
  apiProblemResponse,
  evaluateOptionalApiBearerRequest,
  type ApiBearerCredentialContext,
  type ApiBearerRequestContext,
} from "./api-v0";

export type DeveloperReadAuthority =
  | {
      ok: true;
      ownerUserId: string;
      source: "personal_api_token" | "user_delegated_oauth";
    }
  | {
      ok: false;
      reason: "anonymous" | "non_user_authority";
    };

function missingDeveloperBearerResponse() {
  return apiProblemResponse({
    type: "about:blank",
    title: "Bearer token required",
    status: 401,
    detail: "Send a personal API token or API-resource OAuth access token with developer:read scope.",
  });
}

function insufficientDeveloperAuthorityResponse() {
  return apiProblemResponse({
    type: "about:blank",
    title: "Developer read authority is insufficient",
    status: 403,
    detail:
      "This route requires a user-owned personal API token or a user-delegated API-resource OAuth access token with developer:read scope.",
  });
}

export function developerReadAuthorityForCredential(
  credential: ApiBearerCredentialContext,
): DeveloperReadAuthority {
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

export async function evaluateDeveloperReadRequest(request: Request): Promise<
  | {
      ok: true;
      context: ApiBearerRequestContext;
      ownerUserId: string;
    }
  | {
      ok: false;
      response: Response;
    }
> {
  if (getBearerTokenFromAuthorizationHeader(request.headers.get("authorization")) === null) {
    return { ok: false, response: missingDeveloperBearerResponse() };
  }

  const evaluation = await evaluateOptionalApiBearerRequest(request, {
    requiredScopes: ["developer:read"],
    routeClass: "developer_credential_management",
  });

  if (!evaluation.ok) {
    return { ok: false, response: evaluation.response };
  }

  const authority = developerReadAuthorityForCredential(evaluation.context.credential);

  if (!authority.ok) {
    return { ok: false, response: insufficientDeveloperAuthorityResponse() };
  }

  return {
    ok: true,
    context: evaluation.context,
    ownerUserId: authority.ownerUserId,
  };
}
