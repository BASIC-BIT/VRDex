import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { ActionCtx } from "./_generated/server";
import { decryptSecret, encryptSecret } from "./_connectorCrypto";

const API = "https://www.googleapis.com/calendar/v3";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

export type GoogleEventDateTime = { date?: string; dateTime?: string; timeZone?: string };
export type GoogleCalendarEvent = {
  id: string; status: "confirmed" | "tentative" | "cancelled"; updated: string;
  summary?: string; description?: string; location?: string;
  start?: GoogleEventDateTime; end?: GoogleEventDateTime; recurringEventId?: string;
};
export type GoogleEventBody = Required<Pick<GoogleCalendarEvent, "summary" | "description" | "location" | "start" | "end" | "status">>;

// The message is always a code: lastError reaches the settings page and the ops alert email.
export class GoogleApiError extends Error {
  constructor(readonly status: number, message = `GOOGLE_API_${status}`) {
    super(message);
  }
}

export function googleCalendarEnabled(): boolean {
  return process.env.VRDEX_CONNECTOR_GOOGLE_CALENDAR_ENABLED === "true";
}

export function requireGoogleCalendarEnabled(): void {
  if (!googleCalendarEnabled()) throw new Error("CONNECTOR_KIND_DISABLED");
}

// JSON.parse errors quote the body, so a malformed answer becomes a code.
async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : undefined;
  } catch {
    throw new Error("GOOGLE_API_RESPONSE");
  }
}

async function readSecret(cipher: string): Promise<string> {
  try {
    return await decryptSecret(cipher);
  } catch {
    // A missing or rotated key is an operator problem, not the organiser's; leave the connector alone.
    throw new Error("CONNECTOR_CREDENTIAL_UNREADABLE");
  }
}

async function refreshAccessToken(ctx: ActionCtx, credential: Doc<"connectorCredentials">): Promise<string> {
  const clientId = process.env.GOOGLE_CONNECTOR_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CONNECTOR_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("GOOGLE_CONNECTOR_CLIENT_MISSING");
  const response = await fetch(TOKEN_URL, { method: "POST", body: new URLSearchParams({
    grant_type: "refresh_token", refresh_token: await readSecret(credential.encryptedRefreshToken), client_id: clientId, client_secret: clientSecret,
  }) });
  if (!response.ok) {
    // Only a revoked or expired grant needs the organiser; invalid_client and 5xx are ours, so jobs fail and alert ops.
    const error = (await readJson(response).catch(() => undefined) as { error?: unknown } | undefined)?.error;
    if (error === "invalid_grant") return await reauthRequired(ctx, credential._id);
    throw new GoogleApiError(response.status, `GOOGLE_TOKEN_${response.status}`);
  }
  const { access_token, expires_in } = (await readJson(response) ?? {}) as { access_token?: unknown; expires_in?: unknown };
  if (typeof access_token !== "string" || typeof expires_in !== "number") throw new Error("GOOGLE_API_RESPONSE");
  // Google omits the refresh token on refresh, so the stored one stays.
  await ctx.runMutation(internal.googleCalendarConnector.saveAccessToken, {
    credentialId: credential._id, encryptedAccessToken: await encryptSecret(access_token), accessTokenExpiresAt: Date.now() + expires_in * 1000,
  });
  return access_token;
}

async function reauthRequired(ctx: ActionCtx, credentialId: Id<"connectorCredentials">): Promise<never> {
  await ctx.runMutation(internal.googleCalendarConnector.markNeedsReauth, { credentialId, error: "GOOGLE_REAUTH_REQUIRED" });
  throw new Error("GOOGLE_REAUTH_REQUIRED");
}

// Refreshes at most once per call: up front when the stored token has expired, else after the first 401.
export async function withGoogleToken<T>(ctx: ActionCtx, credentialId: Id<"connectorCredentials">, fn: (accessToken: string) => Promise<T>): Promise<T> {
  const credential = await ctx.runQuery(internal.googleCalendarConnector.readCredential, { credentialId });
  if (!credential) throw new Error("CONNECTOR_CREDENTIAL");
  if (credential.state === "revoked") return await reauthRequired(ctx, credentialId);
  if (credential.accessTokenExpiresAt <= Date.now()) return await fn(await refreshAccessToken(ctx, credential));
  try {
    return await fn(await readSecret(credential.encryptedAccessToken));
  } catch (error) {
    if (!(error instanceof GoogleApiError && error.status === 401)) throw error;
  }
  return await fn(await refreshAccessToken(ctx, credential));
}

async function google<T>(token: string, method: string, path: string, options: { query?: Record<string, string | undefined>; body?: unknown } = {}): Promise<T> {
  const url = new URL(API + path);
  for (const [key, value] of Object.entries(options.query ?? {})) if (value !== undefined) url.searchParams.set(key, value);
  const response = await fetch(url, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(options.body === undefined ? {} : { "content-type": "application/json" }) },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  if (!response.ok) throw new GoogleApiError(response.status);
  return await readJson(response) as T;
}

const eventsPath = (calendarId: string) => `/calendars/${encodeURIComponent(calendarId)}/events`;

export async function listEvents(token: string, calendarId: string, params: { syncToken?: string; pageToken?: string; timeMin?: string; timeMax?: string }): Promise<{ items: GoogleCalendarEvent[]; nextPageToken?: string; nextSyncToken?: string; timeZone: string }> {
  const page = await google<{ items?: GoogleCalendarEvent[]; nextPageToken?: string; nextSyncToken?: string; timeZone: string }>(token, "GET", eventsPath(calendarId), {
    query: { ...params, singleEvents: "true", maxResults: "250" },
  });
  return { ...page, items: page.items ?? [] };
}

export function insertEvent(token: string, calendarId: string, body: GoogleEventBody): Promise<GoogleCalendarEvent> {
  return google(token, "POST", eventsPath(calendarId), { body });
}

export function patchEvent(token: string, calendarId: string, eventId: string, body: GoogleEventBody): Promise<GoogleCalendarEvent> {
  return google(token, "PATCH", `${eventsPath(calendarId)}/${encodeURIComponent(eventId)}`, { body });
}

export async function deleteEvent(token: string, calendarId: string, eventId: string): Promise<void> {
  try {
    await google(token, "DELETE", `${eventsPath(calendarId)}/${encodeURIComponent(eventId)}`);
  } catch (error) {
    if (!(error instanceof GoogleApiError && (error.status === 404 || error.status === 410))) throw error;
  }
}

export async function watchEvents(token: string, calendarId: string, channel: { id: string; token: string; address: string }): Promise<{ resourceId: string; expiration: number }> {
  const created = await google<{ resourceId: string; expiration: string }>(token, "POST", `${eventsPath(calendarId)}/watch`, { body: { ...channel, type: "web_hook" } });
  return { resourceId: created.resourceId, expiration: Number(created.expiration) };
}

export async function stopChannel(token: string, channel: { id: string; resourceId: string }): Promise<void> {
  await google(token, "POST", "/channels/stop", { body: channel });
}

// writer, so a later direction change to export still works on any calendar offered.
export async function listCalendars(token: string): Promise<Array<{ id: string; summary: string; primary?: boolean }>> {
  const calendars: Array<{ id: string; summary: string; primary?: boolean }> = [];
  let pageToken: string | undefined;
  do {
    const page = await google<{ items?: Array<{ id: string; summary: string; primary?: boolean }>; nextPageToken?: string }>(token, "GET", "/users/me/calendarList", {
      query: { minAccessRole: "writer", maxResults: "250", pageToken },
    });
    calendars.push(...(page.items ?? []).map(({ id, summary, primary }) => ({ id, summary, primary })));
    pageToken = page.nextPageToken;
  } while (pageToken);
  return calendars;
}
