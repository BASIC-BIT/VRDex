import {
  type RecentAuthActionClass,
  validRecentAuthChallengeId,
} from "../recent-auth";

const MINUTE_MS = 60 * 1_000;

export const RECENT_AUTH_BINDING_COOKIE = "__Host-vrdexReauthBinding";
export const RECENT_AUTH_BINDING_LOCAL_COOKIE = "vrdexReauthBinding";
export const RECENT_AUTH_FINISH_COOKIE = "__Host-vrdexReauthFinish";
export const RECENT_AUTH_FINISH_LOCAL_COOKIE = "vrdexReauthFinish";
export const RECENT_AUTH_BINDING_MAX_AGE_SECONDS = 10 * 60;
export const RECENT_AUTH_BINDING_MAX_AGE_MS =
  RECENT_AUTH_BINDING_MAX_AGE_SECONDS * 1_000;

export type RecentAuthBinding = {
  actionClass: RecentAuthActionClass;
  challengeId: string;
  issuedAt: number;
  originalSessionId: string;
  userId: string;
};

export type RecentAuthBindingDecision = "match" | "mismatch" | "missing";
export type RecentAuthFinishProof = {
  actionClass: RecentAuthActionClass;
  challengeId: string;
  issuedAt: number;
};

export function encodeRecentAuthBinding(binding: RecentAuthBinding) {
  return Buffer.from(JSON.stringify(binding), "utf8").toString("base64url");
}

export function encodeRecentAuthFinishProof(
  proof: RecentAuthFinishProof,
) {
  return Buffer.from(JSON.stringify(proof), "utf8").toString("base64url");
}

export function decodeRecentAuthFinishProof(
  value: string | null | undefined,
  challengeId: string | null,
  now = Date.now(),
): RecentAuthFinishProof | null {
  if (
    value === undefined ||
    value === null ||
    challengeId === null ||
    value.length > 1_024
  ) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    );
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("actionClass" in parsed) ||
      !("challengeId" in parsed) ||
      !("issuedAt" in parsed) ||
      (parsed.actionClass !== "developer_oauth_application" &&
        parsed.actionClass !== "developer_token" &&
        parsed.actionClass !== "session_revocation") ||
      parsed.challengeId !== challengeId ||
      typeof parsed.issuedAt !== "number" ||
      !Number.isSafeInteger(parsed.issuedAt) ||
      parsed.issuedAt > now + MINUTE_MS ||
      now - parsed.issuedAt > MINUTE_MS
    ) {
      return null;
    }
    return {
      actionClass: parsed.actionClass,
      challengeId,
      issuedAt: parsed.issuedAt,
    };
  } catch {
    return null;
  }
}

export function decodeRecentAuthBinding(
  value: string | null | undefined,
  now = Date.now(),
): RecentAuthBinding | null {
  if (value === undefined || value === null || value.length > 1_024) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    );

    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("actionClass" in parsed) ||
      !("challengeId" in parsed) ||
      !("issuedAt" in parsed) ||
      !("originalSessionId" in parsed) ||
      !("userId" in parsed) ||
      (parsed.actionClass !== "developer_oauth_application" &&
        parsed.actionClass !== "developer_token" &&
        parsed.actionClass !== "session_revocation") ||
      typeof parsed.challengeId !== "string" ||
      validRecentAuthChallengeId(parsed.challengeId) === null ||
      typeof parsed.issuedAt !== "number" ||
      !Number.isSafeInteger(parsed.issuedAt) ||
      typeof parsed.originalSessionId !== "string" ||
      parsed.originalSessionId.length === 0 ||
      parsed.originalSessionId.length > 256 ||
      typeof parsed.userId !== "string" ||
      parsed.userId.length === 0 ||
      parsed.userId.length > 256 ||
      parsed.issuedAt > now + MINUTE_MS ||
      now - parsed.issuedAt > RECENT_AUTH_BINDING_MAX_AGE_MS
    ) {
      return null;
    }

    return {
      actionClass: parsed.actionClass,
      challengeId: parsed.challengeId,
      issuedAt: parsed.issuedAt,
      originalSessionId: parsed.originalSessionId,
      userId: parsed.userId,
    };
  } catch {
    return null;
  }
}

export function recentAuthBindingDecision({
  binding,
  challengeId,
  currentUserId,
  now = Date.now(),
}: {
  binding: string | null | undefined;
  challengeId: string | null;
  currentUserId: string | null;
  now?: number;
}): RecentAuthBindingDecision {
  const decoded = decodeRecentAuthBinding(binding, now);

  if (
    decoded === null ||
    challengeId === null ||
    decoded.challengeId !== challengeId ||
    currentUserId === null
  ) {
    return "missing";
  }

  return decoded.userId === currentUserId ? "match" : "mismatch";
}

function requestCookie(request: Request, name: string) {
  const cookieHeader = request.headers.get("cookie");

  if (cookieHeader === null) {
    return null;
  }

  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) {
      continue;
    }
    if (part.slice(0, separator).trim() === name) {
      return part.slice(separator + 1).trim();
    }
  }

  return null;
}

function bindingCookie(
  value: string,
  request: Request,
  challengeId: string,
  maxAge: number,
) {
  const secure = new URL(request.url).protocol === "https:";
  const prefix = secure
    ? RECENT_AUTH_BINDING_COOKIE
    : RECENT_AUTH_BINDING_LOCAL_COOKIE;
  const safeChallengeId =
    validRecentAuthChallengeId(challengeId) ?? "invalid";
  const name = `${prefix}-${safeChallengeId}`;
  return [
    `${name}=${value}`,
    "Path=/",
    `Max-Age=${maxAge}`,
    "HttpOnly",
    "SameSite=Lax",
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}

export function recentAuthFinishCookieName(
  challengeId: string,
  secure: boolean,
) {
  const prefix = secure
    ? RECENT_AUTH_FINISH_COOKIE
    : RECENT_AUTH_FINISH_LOCAL_COOKIE;
  return `${prefix}-${validRecentAuthChallengeId(challengeId) ?? "invalid"}`;
}

export function recentAuthFinishCookieIsSecure(
  host: string | null,
  forwardedProtocol: string | null,
) {
  const protocol = forwardedProtocol?.split(",", 1)[0]?.trim().toLowerCase();
  const localHost =
    host !== null &&
    /^(?:localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::\d+)?$/i.test(
      host.trim(),
    );
  return !(localHost && (protocol === undefined || protocol === "http"));
}

function finishCookie(
  value: string,
  request: Request,
  challengeId: string,
  maxAge: number,
) {
  const secure = new URL(request.url).protocol === "https:";
  return [
    `${recentAuthFinishCookieName(challengeId, secure)}=${value}`,
    "Path=/",
    `Max-Age=${maxAge}`,
    "HttpOnly",
    "SameSite=Lax",
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}

export function readRecentAuthBindingCookie(
  request: Request,
  challengeId: string | null,
) {
  if (challengeId === null) {
    return null;
  }
  const prefix =
    new URL(request.url).protocol === "https:"
      ? RECENT_AUTH_BINDING_COOKIE
      : RECENT_AUTH_BINDING_LOCAL_COOKIE;
  return requestCookie(request, `${prefix}-${challengeId}`);
}

export function setRecentAuthBindingCookie(
  response: Response,
  request: Request,
  binding: RecentAuthBinding,
) {
  response.headers.append(
    "set-cookie",
    bindingCookie(
      encodeRecentAuthBinding(binding),
      request,
      binding.challengeId,
      RECENT_AUTH_BINDING_MAX_AGE_SECONDS,
    ),
  );
  return response;
}

export function clearRecentAuthBindingCookie(
  response: Response,
  request: Request,
  challengeId: string | null,
) {
  if (challengeId === null) {
    return response;
  }
  response.headers.append(
    "set-cookie",
    `${bindingCookie("", request, challengeId, 0)}; Expires=Thu, 01 Jan 1970 00:00:00 GMT`,
  );
  return response;
}

export function setRecentAuthFinishCookie(
  response: Response,
  request: Request,
  proof: RecentAuthFinishProof,
) {
  response.headers.append(
    "set-cookie",
    finishCookie(
      encodeRecentAuthFinishProof(proof),
      request,
      proof.challengeId,
      60,
    ),
  );
  return response;
}

export function clearRecentAuthFinishCookie(
  response: Response,
  request: Request,
  challengeId: string | null,
) {
  if (challengeId === null) {
    return response;
  }
  response.headers.append(
    "set-cookie",
    `${finishCookie("", request, challengeId, 0)}; Expires=Thu, 01 Jan 1970 00:00:00 GMT`,
  );
  return response;
}
