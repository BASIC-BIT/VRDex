import { oauthIssuerUrl } from "./oauth-jwt";

const problemDetails = {
  invalid_client:
    "This OAuth client cannot use the requested redirect URI, resource, or scopes.",
  invalid_client_metadata: "The OAuth client metadata document is invalid or unavailable.",
  invalid_request:
    "response_type, client_id, redirect_uri, scope, resource, and an S256 PKCE code challenge are required.",
  server_error: "The server could not create the OAuth consent transaction.",
} as const;

export type OAuthAuthorizeProblem = keyof typeof problemDetails;

export function oauthAuthorizeProblemDetail(value: string | undefined) {
  if (value === undefined || !(value in problemDetails)) {
    return undefined;
  }

  return problemDetails[value as OAuthAuthorizeProblem];
}

export function oauthAuthorizeProblemRedirect(request: Request, problem: OAuthAuthorizeProblem) {
  const problemUrl = new URL("/oauth/authorize/review", oauthIssuerUrl(request));
  problemUrl.searchParams.set("problem", problem);

  return Response.redirect(problemUrl, 303);
}
