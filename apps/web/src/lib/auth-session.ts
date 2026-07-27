const SECOND_MS = 1_000;
const MINUTE_MS = 60 * SECOND_MS;
const DAY_MS = 24 * 60 * MINUTE_MS;

export const AUTH_JWT_DURATION_MS = 60 * MINUTE_MS;
export const AUTH_SESSION_INACTIVE_DURATION_MS = 30 * DAY_MS;
export const AUTH_SESSION_TOTAL_DURATION_MS = 90 * DAY_MS;
export const AUTH_SESSION_COOKIE_MAX_AGE_SECONDS =
  AUTH_SESSION_INACTIVE_DURATION_MS / SECOND_MS;
export const AUTH_SESSION_RESTORE_SLOW_MS = 10 * SECOND_MS;
export const AUTH_SIGNOUT_REQUESTED_BROWSER_EVENT =
  "vrdex:auth-signout-requested";
export const AUTH_SIGNOUT_FAILED_BROWSER_EVENT =
  "vrdex:auth-signout-failed";

export type AuthSessionLifecycleState =
  | "anonymous"
  | "authenticated"
  | "restoring";
export type AuthSessionRouteClass = "auth" | "protected" | "public";
export type AuthSessionRestoreLatencyBucket =
  | "over_10s"
  | "under_10s"
  | "under_1s"
  | "under_3s";
export type AuthSessionTransitionIntent =
  | "explicit_signout_current_tab"
  | "unclassified";
export type AuthRevocationConvergenceEvent =
  | "revocation_detected"
  | "signed_out"
  | "signout_failed"
  | "signout_requested";
export type AuthSessionDeploymentCategory =
  | "development"
  | "preview"
  | "production"
  | "staging";
export type AuthSessionBrowserFamily =
  | "chromium"
  | "firefox"
  | "other"
  | "safari";
export type AuthSessionOsFamily =
  | "android"
  | "ios"
  | "linux"
  | "macos"
  | "other"
  | "windows";

export type AuthSessionValidity =
  | "active"
  | "absolute_expired"
  | "inactive_expired"
  | "revoked";

export function nextAuthRevocationConvergenceStarted(
  current: boolean,
  event: AuthRevocationConvergenceEvent,
) {
  if (event === "signed_out" || event === "signout_failed") {
    return false;
  }

  return current || event === "revocation_detected" || event === "signout_requested";
}

export function shouldConvergeRevokedSession(
  routeClass: AuthSessionRouteClass,
) {
  return routeClass !== "auth";
}

export function authSessionValidityAt({
  now,
  sessionExpiresAt,
  refreshExpiresAt,
  refreshCredentialPresent,
}: {
  now: number;
  sessionExpiresAt: number;
  refreshExpiresAt: number;
  refreshCredentialPresent: boolean;
}): AuthSessionValidity {
  if (!refreshCredentialPresent) {
    return "revoked";
  }

  if (now >= sessionExpiresAt) {
    return "absolute_expired";
  }

  if (now >= refreshExpiresAt) {
    return "inactive_expired";
  }

  return "active";
}

export function authLifecycleEvent(
  previous: AuthSessionLifecycleState | null,
  current: AuthSessionLifecycleState,
  {
    credentialPresent = true,
    intent = "unclassified",
    restoreDurationMs = 0,
    routeClass = "public",
  }: {
    credentialPresent?: boolean;
    intent?: AuthSessionTransitionIntent;
    restoreDurationMs?: number;
    routeClass?: AuthSessionRouteClass;
  } = {},
) {
  if (current === "restoring" || previous === current) {
    return null;
  }

  if (previous === null || previous === "restoring") {
    if (current === "anonymous" && !credentialPresent) {
      return null;
    }
    return {
      event: "auth_session_restore_completed" as const,
      properties: {
        latency_bucket: authSessionRestoreLatencyBucket(restoreDurationMs),
        outcome: current,
        route_class: routeClass,
      },
    };
  }

  return {
    event: "auth_session_state_changed" as const,
    properties: {
      from: previous,
      intent,
      to: current,
    },
  };
}

export function authSessionRestoreLatencyBucket(
  durationMs: number,
): AuthSessionRestoreLatencyBucket {
  if (durationMs < SECOND_MS) {
    return "under_1s";
  }
  if (durationMs < 3 * SECOND_MS) {
    return "under_3s";
  }
  if (durationMs < AUTH_SESSION_RESTORE_SLOW_MS) {
    return "under_10s";
  }
  return "over_10s";
}

export function authSessionRouteClass(
  pathname: string,
): AuthSessionRouteClass {
  if (
    pathname === "/sign-in" ||
    pathname.startsWith("/sign-in/") ||
    pathname === "/verify-email" ||
    pathname.startsWith("/verify-email/")
  ) {
    return "auth";
  }

  if (
    pathname === "/account" ||
    pathname.startsWith("/account/") ||
    pathname === "/claim" ||
    pathname.startsWith("/claim/") ||
    pathname === "/developers" ||
    pathname.startsWith("/developers/")
  ) {
    return "protected";
  }

  return "public";
}

export function authSessionRestoreSlowEvent({
  alreadyEmitted,
  credentialPresent = true,
  elapsedMs,
  routeClass,
}: {
  alreadyEmitted: boolean;
  credentialPresent?: boolean;
  elapsedMs: number;
  routeClass: AuthSessionRouteClass;
}) {
  if (
    alreadyEmitted ||
    !credentialPresent ||
    elapsedMs < AUTH_SESSION_RESTORE_SLOW_MS
  ) {
    return null;
  }

  return {
    event: "auth_session_restore_slow" as const,
    properties: {
      route_class: routeClass,
    },
  };
}

export function announceAuthSignoutRequested() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(AUTH_SIGNOUT_REQUESTED_BROWSER_EVENT));
  }
}

export function announceAuthSignoutFailed() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(AUTH_SIGNOUT_FAILED_BROWSER_EVENT));
  }
}

export async function requestBrowserSignOut(
  signOut: () => Promise<unknown>,
) {
  announceAuthSignoutRequested();
  try {
    return await signOut();
  } catch (error) {
    announceAuthSignoutFailed();
    throw error;
  }
}

export function authSessionCredentialPresent(cookieNames: Iterable<string>) {
  for (const name of cookieNames) {
    if (
      name === "__convexAuthJWT" ||
      name === "__convexAuthRefreshToken" ||
      name === "__Host-__convexAuthJWT" ||
      name === "__Host-__convexAuthRefreshToken"
    ) {
      return true;
    }
  }
  return false;
}

export function authSessionDiagnosticContext({
  hostname,
  userAgent,
}: {
  hostname: string;
  userAgent: string;
}) {
  const normalizedHost = hostname.trim().toLowerCase();
  const normalizedAgent = userAgent.toLowerCase();

  const deployment_category: AuthSessionDeploymentCategory =
    normalizedHost === "vrdex.net" || normalizedHost === "www.vrdex.net"
      ? "production"
      : normalizedHost === "staging.vrdex.net"
        ? "staging"
        : normalizedHost === "localhost" ||
            normalizedHost === "127.0.0.1" ||
            normalizedHost === "::1"
          ? "development"
          : "preview";

  const browser_family: AuthSessionBrowserFamily =
    /firefox|fxios/.test(normalizedAgent)
      ? "firefox"
      : /edg|chrome|chromium|crios/.test(normalizedAgent)
        ? "chromium"
        : /safari/.test(normalizedAgent)
          ? "safari"
          : "other";

  const os_family: AuthSessionOsFamily =
    /android/.test(normalizedAgent)
      ? "android"
      : /iphone|ipad|ipod/.test(normalizedAgent)
        ? "ios"
        : /windows/.test(normalizedAgent)
          ? "windows"
          : /mac os|macintosh/.test(normalizedAgent)
            ? "macos"
            : /linux/.test(normalizedAgent)
              ? "linux"
              : "other";

  return {
    browser_family,
    deployment_category,
    os_family,
  };
}
