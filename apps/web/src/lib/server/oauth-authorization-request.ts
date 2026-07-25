import {
  normalizeOAuthClientId,
  normalizeOAuthRedirectUris,
  type ApiScope,
} from "@vrdex/api-contracts";

import {
  oauthApiResourceUri,
  oauthMcpResourceUri,
  parseOAuthScopeString,
} from "./oauth-jwt";
import {
  normalizeOAuthCodeChallenge,
  normalizeOAuthCodeChallengeMethod,
} from "./oauth-pkce";
import { normalizedOAuthResourceIndicator } from "./oauth-resource-indicator";

export type OAuthAuthorizationRequest = {
  clientId: string;
  codeChallenge: string;
  codeChallengeMethod: "S256";
  redirectUri: string;
  requestedScopes: ApiScope[];
  resource: string;
  state?: string;
};

function inputValue(input: URLSearchParams | FormData, key: string) {
  const value = input.get(key);

  return typeof value === "string" ? value.trim() : "";
}

function requiredInputValue(input: URLSearchParams | FormData, key: string) {
  const value = inputValue(input, key);

  if (!value) {
    throw new Error(`${key} is required.`);
  }

  return value;
}

function optionalState(input: URLSearchParams | FormData) {
  const state = inputValue(input, "state");

  if (!state) {
    return undefined;
  }

  return state.slice(0, 1024);
}

function requestedResource(
  request: Request,
  input: URLSearchParams | FormData,
  requestedScopes: readonly ApiScope[],
) {
  const resource = normalizedOAuthResourceIndicator(request, input);

  if (!resource) {
    return requestedScopes.some((scope) => scope === "mcp:read" || scope === "mcp:write")
      ? oauthMcpResourceUri(request)
      : oauthApiResourceUri(request);
  }

  return resource;
}

export function normalizeOAuthAuthorizationRequest(
  input: URLSearchParams | FormData,
  request: Request,
): OAuthAuthorizationRequest {
  if (requiredInputValue(input, "response_type") !== "code") {
    throw new Error("response_type must be code.");
  }

  const explicitlyRequestedScopes = parseOAuthScopeString(inputValue(input, "scope"), []);
  const resource = requestedResource(request, input, explicitlyRequestedScopes);
  const fallbackScopes: ApiScope[] = resource === oauthMcpResourceUri(request) ? ["mcp:read"] : ["public:read"];
  const requestedScopes = explicitlyRequestedScopes.length === 0 ? fallbackScopes : explicitlyRequestedScopes;

  return {
    clientId: normalizeOAuthClientId(requiredInputValue(input, "client_id")),
    codeChallenge: normalizeOAuthCodeChallenge(requiredInputValue(input, "code_challenge")),
    codeChallengeMethod: normalizeOAuthCodeChallengeMethod(inputValue(input, "code_challenge_method")) as "S256",
    redirectUri: normalizeOAuthRedirectUris([requiredInputValue(input, "redirect_uri")])[0],
    requestedScopes,
    resource,
    ...(optionalState(input) === undefined ? {} : { state: optionalState(input) }),
  };
}

export function redirectUriWithOAuthResult(args: {
  code?: string;
  error?: string;
  errorDescription?: string;
  redirectUri: string;
  state?: string;
}) {
  const url = new URL(args.redirectUri);

  if (args.code !== undefined) {
    url.searchParams.set("code", args.code);
  }

  if (args.error !== undefined) {
    url.searchParams.set("error", args.error);
  }

  if (args.errorDescription !== undefined) {
    url.searchParams.set("error_description", args.errorDescription);
  }

  if (args.state !== undefined) {
    url.searchParams.set("state", args.state);
  }

  return url.toString();
}

export function redirectUriWithOAuthClientError(args: {
  reason: "invalid_scope" | "wrong_resource";
  redirectUri: string;
  state?: string;
}) {
  const error = args.reason === "invalid_scope" ? "invalid_scope" : "invalid_target";
  const errorDescription = args.reason === "invalid_scope"
    ? "The requested scope is not allowed for this client."
    : "The requested resource is not allowed for this client.";

  return redirectUriWithOAuthResult({
    error,
    errorDescription,
    redirectUri: args.redirectUri,
    state: args.state,
  });
}
