const SECOND_MS = 1_000;
const MINUTE_MS = 60 * SECOND_MS;
const DAY_MS = 24 * 60 * MINUTE_MS;

export const AUTH_JWT_DURATION_MS = 60 * MINUTE_MS;
export const AUTH_SESSION_INACTIVE_DURATION_MS = 30 * DAY_MS;
export const AUTH_SESSION_TOTAL_DURATION_MS = 90 * DAY_MS;
export const AUTH_SESSION_COOKIE_MAX_AGE_SECONDS =
  AUTH_SESSION_INACTIVE_DURATION_MS / SECOND_MS;

export type AuthSessionLifecycleState =
  | "anonymous"
  | "authenticated"
  | "restoring";

export type AuthSessionValidity =
  | "active"
  | "absolute_expired"
  | "inactive_expired"
  | "revoked";

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
) {
  if (current === "restoring" || previous === current) {
    return null;
  }

  if (previous === null || previous === "restoring") {
    return {
      event: "auth_session_restore_completed" as const,
      properties: {
        outcome: current,
      },
    };
  }

  return {
    event: "auth_session_state_changed" as const,
    properties: {
      from: previous,
      to: current,
    },
  };
}
