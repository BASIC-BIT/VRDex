const FIXTURE_DEMO_PATHS = new Set(["/account/appearance", "/account/privacy", "/account/media-kit"]);

export type ProtectedRouteOptions = {
  allowFixtureDemos?: boolean;
};

export function isProtectedRoute(
  pathname: string,
  options: ProtectedRouteOptions = {},
): boolean {
  if (options.allowFixtureDemos && FIXTURE_DEMO_PATHS.has(pathname)) {
    return false;
  }

  if (pathname === "/account" || pathname.startsWith("/account/")) {
    return true;
  }

  if (pathname === "/claim" || pathname.startsWith("/claim/")) {
    return true;
  }

  if (
    pathname === "/submit" ||
    pathname === "/events/new" ||
    pathname === "/developers/tokens" ||
    pathname === "/developers/apps"
  ) {
    return true;
  }

  return /^\/[^/]+\/events\/create$/.test(pathname)
    || /^\/[^/]+\/events\/[^/]+\/edit$/.test(pathname);
}

export function protectedRouteSignInPath(pathname: string, search = ""): string {
  return `/sign-in?returnTo=${encodeURIComponent(`${pathname}${search}`)}`;
}

export function hasE2eSubmitBypass({
  pathname,
  helpersEnabled,
  expectedToken,
  requestToken,
}: {
  pathname: string;
  helpersEnabled: boolean;
  expectedToken: string | undefined;
  requestToken: string | undefined;
}): boolean {
  return (
    pathname === "/submit" &&
    helpersEnabled &&
    Boolean(expectedToken) &&
    requestToken === expectedToken
  );
}
