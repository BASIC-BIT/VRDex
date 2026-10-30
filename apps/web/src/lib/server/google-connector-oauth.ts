import { timingSafeEqual } from "node:crypto";

export const GOOGLE_CONNECTOR_SCOPES = ["https://www.googleapis.com/auth/calendar.calendarlist.readonly", "https://www.googleapis.com/auth/calendar.events"] as const;
export const GOOGLE_CONNECTOR_STATE_COOKIE = "vrdex_google_connector_state";
export const GOOGLE_CONNECTOR_COOKIE_PATH = "/api/connectors/google";
export const GOOGLE_CONNECTOR_CALLBACK_PATH = "/api/connectors/google/callback";

export type GoogleConnectorState = { state: string; communitySlug: string; connectorId?: string };

export function googleAuthorizeUrl(input: { clientId: string; redirectUri: string; state: string }): string {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: input.clientId, redirect_uri: input.redirectUri, response_type: "code", scope: GOOGLE_CONNECTOR_SCOPES.join(" "),
    access_type: "offline", prompt: "consent", state: input.state,
  }).toString();
  return url.toString();
}

export function encodeStateCookie(value: GoogleConnectorState): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

export function readStateCookie(cookie: string | undefined, queryState: string | null): GoogleConnectorState | null {
  if (!cookie || !queryState) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cookie, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  const { state, communitySlug, connectorId } = (parsed ?? {}) as Record<string, unknown>;
  if (typeof state !== "string" || typeof communitySlug !== "string" || (connectorId !== undefined && typeof connectorId !== "string")) return null;
  const expected = Buffer.from(state);
  const actual = Buffer.from(queryState);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  return connectorId === undefined ? { state, communitySlug } : { state, communitySlug, connectorId };
}

// Every failure is a code: Google's bodies can quote the code or the grant.
async function postForm(fetchImplementation: typeof fetch, url: string, body: Record<string, string>, failure: string): Promise<Record<string, unknown>> {
  const response = await fetchImplementation(url, { method: "POST", body: new URLSearchParams(body) });
  if (!response.ok) throw new Error(`${failure}_${response.status}`);
  try {
    const json: unknown = await response.json();
    if (typeof json === "object" && json !== null) return json as Record<string, unknown>;
  } catch {
    // fall through to the code below
  }
  throw new Error(`${failure}_RESPONSE`);
}

// Only decides whether a sync token survives a reconnect, and the granted calendar scope can always read it. Every failure is one code.
async function primaryCalendarId(fetchImplementation: typeof fetch, accessToken: string): Promise<string> {
  try {
    const response = await fetchImplementation("https://www.googleapis.com/calendar/v3/users/me/calendarList/primary", { headers: { authorization: `Bearer ${accessToken}` } });
    const { id } = (response.ok ? await response.json() : {}) as { id?: unknown };
    if (typeof id === "string" && id) return id;
  } catch {
    // fall through to the code below
  }
  throw new Error("GOOGLE_ACCOUNT_UNKNOWN");
}

export async function exchangeGoogleCode(input: { code: string; redirectUri: string; clientId: string; clientSecret: string; fetchImplementation?: typeof fetch }): Promise<{ accessToken: string; refreshToken: string; expiresAt: number; scopes: string[]; externalAccountId: string }> {
  const fetchImplementation = input.fetchImplementation ?? fetch;
  const token = await postForm(fetchImplementation, "https://oauth2.googleapis.com/token", {
    grant_type: "authorization_code", code: input.code, redirect_uri: input.redirectUri, client_id: input.clientId, client_secret: input.clientSecret,
  }, "GOOGLE_TOKEN");
  const { access_token: accessToken, refresh_token: refreshToken, expires_in: expiresIn, scope } = token;
  if (typeof accessToken !== "string" || typeof expiresIn !== "number") throw new Error("GOOGLE_TOKEN_RESPONSE");
  if (typeof refreshToken !== "string" || !refreshToken) throw new Error("GOOGLE_REFRESH_TOKEN_MISSING");
  const scopes = typeof scope === "string" ? scope.split(" ").filter(Boolean) : [];
  if (!GOOGLE_CONNECTOR_SCOPES.every(required => scopes.includes(required))) throw new Error("GOOGLE_SCOPES_MISSING");
  return { accessToken, refreshToken, expiresAt: Date.now() + expiresIn * 1000, scopes, externalAccountId: await primaryCalendarId(fetchImplementation, accessToken) };
}

export const integrationsPath = (communitySlug: string) => `/account/communities/${encodeURIComponent(communitySlug)}/integrations`;

export const stateCookieOptions = { httpOnly: true, secure: true, sameSite: "lax", path: GOOGLE_CONNECTOR_COOKIE_PATH } as const;

// Logs and redirects carry codes only; a code or token must never reach them.
export function errorCode(error: unknown): string {
  const data = (error as { data?: { code?: unknown } } | null)?.data;
  if (typeof data?.code === "string") return data.code;
  const message = error instanceof Error ? error.message : "";
  return /^[A-Z][A-Z0-9_]{2,63}$/.test(message) ? message : "UNKNOWN";
}
