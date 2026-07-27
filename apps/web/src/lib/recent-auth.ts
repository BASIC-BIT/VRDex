import { validateSignInReturnTo } from "./safe-return-to";

export const RECENT_AUTH_REQUIRED_CODE = "RECENT_AUTH_REQUIRED";
export type RecentAuthActionClass =
  | "developer_oauth_application"
  | "developer_token"
  | "session_revocation";

export function recentAuthProviderAllowed(
  provider: "discord" | "google" | "password",
) {
  return provider === "password";
}
export type RecentAuthDraftKey =
  | "developer_oauth_application"
  | "developer_token";
export type RecentAuthDraft = Record<string, string | string[]>;

const RECENT_AUTH_DRAFT_PREFIX = "vrdex:recent-auth-draft:";
const RECENT_AUTH_DRAFT_MAX_BYTES = 16_384;
const RECENT_AUTH_CHALLENGE_ID_PATTERN = /^[a-f0-9]{32}$/;

export function browserRecentAuthDraftStorage(): Storage | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isRecentAuthRequiredError(error: unknown) {
  return (
    isRecord(error) &&
    isRecord(error.data) &&
    error.data.code === RECENT_AUTH_REQUIRED_CODE
  );
}

export function isReauthenticationRequest(
  value: string | string[] | null | undefined,
) {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate === "1";
}

export function recentAuthActionClassForReturnTo(
  returnTo: string,
): RecentAuthActionClass {
  const safeReturnTo = validateSignInReturnTo(returnTo);

  if (safeReturnTo.startsWith("/developers/apps")) {
    return "developer_oauth_application";
  }
  if (safeReturnTo.startsWith("/account/security")) {
    return "session_revocation";
  }
  return "developer_token";
}

export function validRecentAuthChallengeId(
  value: string | string[] | null | undefined,
) {
  const candidate = Array.isArray(value) ? value[0] : value;
  return typeof candidate === "string" &&
    RECENT_AUTH_CHALLENGE_ID_PATTERN.test(candidate)
    ? candidate
    : null;
}

export function reauthenticationPath(returnTo: string) {
  const safeReturnTo = validateSignInReturnTo(returnTo);
  return `/auth/reauth/start?returnTo=${encodeURIComponent(safeReturnTo)}`;
}

export function reauthenticationCompletionPath(
  returnTo: string,
  challengeId: string,
) {
  const safeReturnTo = validateSignInReturnTo(returnTo);
  const safeChallengeId = validRecentAuthChallengeId(challengeId);
  const challengeQuery =
    safeChallengeId === null
      ? ""
      : `&challenge=${encodeURIComponent(safeChallengeId)}`;
  return `/auth/reauth/complete?returnTo=${encodeURIComponent(safeReturnTo)}${challengeQuery}`;
}

export function reauthenticationFinishPath(
  returnTo: string,
  challengeId: string,
) {
  const safeReturnTo = validateSignInReturnTo(returnTo);
  const safeChallengeId = validRecentAuthChallengeId(challengeId);
  const challengeQuery =
    safeChallengeId === null
      ? ""
      : `&challenge=${encodeURIComponent(safeChallengeId)}`;
  return `/auth/reauth/finish?returnTo=${encodeURIComponent(safeReturnTo)}${challengeQuery}`;
}

export function reauthenticationCancellationPath(
  returnTo: string,
  challengeId: string,
) {
  const safeReturnTo = validateSignInReturnTo(returnTo);
  const safeChallengeId = validRecentAuthChallengeId(challengeId);
  const challengeQuery =
    safeChallengeId === null
      ? ""
      : `&challenge=${encodeURIComponent(safeChallengeId)}`;
  return `/auth/reauth/cancel?returnTo=${encodeURIComponent(safeReturnTo)}${challengeQuery}`;
}

export function reauthenticationFailurePath(
  returnTo: string,
  challengeId: string,
) {
  const safeReturnTo = validateSignInReturnTo(returnTo);
  const safeChallengeId = validRecentAuthChallengeId(challengeId);
  const challengeQuery =
    safeChallengeId === null
      ? ""
      : `&challenge=${encodeURIComponent(safeChallengeId)}`;
  return `/auth/reauth/fail?returnTo=${encodeURIComponent(safeReturnTo)}${challengeQuery}`;
}

export function reauthenticationFinishClearPath(
  returnTo: string,
  challengeId: string,
) {
  const safeReturnTo = validateSignInReturnTo(returnTo);
  const safeChallengeId = validRecentAuthChallengeId(challengeId);
  const challengeQuery =
    safeChallengeId === null
      ? ""
      : `&challenge=${encodeURIComponent(safeChallengeId)}`;
  return `/auth/reauth/finish/clear?returnTo=${encodeURIComponent(safeReturnTo)}${challengeQuery}`;
}

export function validRecentAuthActionClass(
  value: string | string[] | null | undefined,
): RecentAuthActionClass {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate === "developer_oauth_application" ||
    candidate === "session_revocation"
    ? candidate
    : "developer_token";
}

export function recentAuthRequiredResponse(returnTo: string) {
  return Response.json(
    {
      code: RECENT_AUTH_REQUIRED_CODE,
      detail: "Sign in again to continue.",
      reauthUrl: reauthenticationPath(returnTo),
      status: 401,
      title: "Sign in again",
      type: "about:blank",
    },
    {
      status: 401,
      headers: {
        "cache-control": "private, no-store",
      },
    },
  );
}

export function saveRecentAuthDraft(
  storage: Pick<Storage, "setItem"> | null,
  key: RecentAuthDraftKey,
  draft: RecentAuthDraft,
) {
  if (storage === null) {
    return false;
  }

  const serialized = JSON.stringify(draft);

  if (serialized.length > RECENT_AUTH_DRAFT_MAX_BYTES) {
    return false;
  }

  try {
    storage.setItem(`${RECENT_AUTH_DRAFT_PREFIX}${key}`, serialized);
    return true;
  } catch {
    return false;
  }
}

export function takeRecentAuthDraft(
  storage: Pick<Storage, "getItem" | "removeItem"> | null,
  key: RecentAuthDraftKey,
): RecentAuthDraft | null {
  if (storage === null) {
    return null;
  }

  const storageKey = `${RECENT_AUTH_DRAFT_PREFIX}${key}`;
  let serialized: string | null;

  try {
    serialized = storage.getItem(storageKey);
    storage.removeItem(storageKey);
  } catch {
    return null;
  }

  if (serialized === null || serialized.length > RECENT_AUTH_DRAFT_MAX_BYTES) {
    return null;
  }

  try {
    const draft: unknown = JSON.parse(serialized);

    if (
      !isRecord(draft) ||
      !Object.values(draft).every(
        (value) =>
          typeof value === "string" ||
          (Array.isArray(value) &&
            value.every((item) => typeof item === "string")),
      )
    ) {
      return null;
    }

    return draft as RecentAuthDraft;
  } catch {
    return null;
  }
}
