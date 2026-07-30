import { validateSignInReturnTo } from "../safe-return-to";

export const AUTH_SESSION_INVALID_CODE = "AUTH_SESSION_INVALID";

const AUTH_COOKIE_NAMES = [
  "__convexAuthJWT",
  "__convexAuthRefreshToken",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isAuthSessionInvalidError(error: unknown) {
  return (
    isRecord(error) &&
    isRecord(error.data) &&
    error.data.code === AUTH_SESSION_INVALID_CODE
  );
}

export function invalidAuthSessionSignInPath(returnTo: string) {
  const safeReturnTo = validateSignInReturnTo(returnTo);
  return `/sign-in?returnTo=${encodeURIComponent(safeReturnTo)}`;
}

export function invalidAuthSessionRedirectPath(returnTo: string) {
  const safeReturnTo = validateSignInReturnTo(returnTo);
  return `/auth/session-invalid?returnTo=${encodeURIComponent(safeReturnTo)}`;
}

function expiredCookie(name: string, secure: boolean) {
  return [
    `${name}=`,
    "Path=/",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
    "Max-Age=0",
    "HttpOnly",
    "SameSite=Lax",
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}

export function expireAuthSessionCookies(response: Response) {
  for (const name of AUTH_COOKIE_NAMES) {
    response.headers.append("set-cookie", expiredCookie(name, false));
    response.headers.append(
      "set-cookie",
      expiredCookie(`__Host-${name}`, true),
    );
  }

  return response;
}

export function invalidAuthSessionResponse(returnTo: string) {
  const signInUrl = invalidAuthSessionSignInPath(returnTo);
  const response = Response.json(
    {
      code: AUTH_SESSION_INVALID_CODE,
      detail: "Sign in to continue.",
      signInUrl,
      status: 401,
      title: "Sign in required",
      type: "about:blank",
    },
    {
      status: 401,
      headers: {
        "cache-control": "private, no-store",
      },
    },
  );

  return expireAuthSessionCookies(response);
}

/**
 * The browser-navigation counterpart to `invalidAuthSessionResponse`.
 *
 * That one answers a fetch with 401 JSON, which is right for the developer
 * APIs. A route the user reaches by following a link — the Discord OAuth start
 * and callback — has to send them somewhere instead, or they land on a raw JSON
 * document. Both clear the cookies either way.
 *
 * `returnTo` falls back to the query parameter when not given, so
 * `/auth/session-invalid` can keep calling it with a request alone.
 */
export function invalidAuthSessionRedirectResponse(request: Request, returnTo?: string) {
  const requestUrl = new URL(request.url);
  const signInUrl = invalidAuthSessionSignInPath(
    returnTo ?? requestUrl.searchParams.get("returnTo") ?? "/account",
  );
  const response = new Response(null, {
    status: 303,
    headers: {
      "cache-control": "private, no-store",
      location: new URL(signInUrl, requestUrl).toString(),
    },
  });

  return expireAuthSessionCookies(response);
}
