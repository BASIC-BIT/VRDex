import type { TestContext } from "node:test";
import type { TestConvex } from "convex-test";
import schemaModule from "../../convex/schema";
import { internal } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { encryptSecret } from "../../convex/_connectorCrypto";
import type { ConnectorDirection, ConnectorMode, ConnectorState } from "../../convex/_eventConnectors";
import { eventSortAt } from "../../convex/_eventSchedule";
import type { GoogleCalendarEvent } from "../../convex/_googleCalendar";
import { connectorModules } from "./_eventConnectorFixture";

export const schema = (schemaModule as unknown as { default?: typeof schemaModule }).default ?? schemaModule;
export const modules = {
  ...connectorModules,
  "../../convex/googleCalendarConnector.ts": () => import("../../convex/googleCalendarConnector"),
};
export const NOW = Date.parse("2026-11-02T12:00:00.000Z");
export const SITE = "https://vrdex.test";
export const EVENT_URL = "https://vrdex.test/basic-nights/events/bass-temple-nov-7";

export function setupEnv(context: TestContext): void {
  context.mock.timers.enable({ apis: ["Date", "setTimeout"], now: NOW });
  Object.assign(process.env, {
    VRDEX_EVENT_CONNECTORS_ENABLED: "true", VRDEX_CONNECTOR_GOOGLE_CALENDAR_ENABLED: "true", SITE_URL: SITE, CONVEX_SITE_URL: "https://convex.test",
    VRDEX_CONNECTOR_TOKEN_KEY: "A".repeat(43) + "=", GOOGLE_CONNECTOR_CLIENT_ID: "client-id", GOOGLE_CONNECTOR_CLIENT_SECRET: "client-secret",
    CLERK_JWT_ISSUER_DOMAIN: "test", EVENT_DATE_ONLY_ENABLED: "true",
  });
}

type FetchCall = { method: string; url: URL; body: unknown; authorization: string | null };

export function fakeFetch(handler: (request: FetchCall) => Response | Promise<Response>): { calls: FetchCall[]; restore(): void } {
  const original = globalThis.fetch;
  const calls: FetchCall[] = [];
  globalThis.fetch = async (input, init) => {
    const raw = init?.body;
    const body = raw instanceof URLSearchParams ? Object.fromEntries(raw) : typeof raw === "string" ? JSON.parse(raw) : raw;
    const call = { method: init?.method ?? "GET", url: new URL(String(input)), body, authorization: new Headers(init?.headers).get("authorization") };
    calls.push(call);
    return handler(call);
  };
  return { calls, restore: () => { globalThis.fetch = original; } };
}

export async function seedGoogleConnector(t: TestConvex<typeof schema>, options: { direction: ConnectorDirection; mode?: ConnectorMode; state?: ConnectorState; target?: Record<string, unknown> }) {
  const encryptedAccessToken = await encryptSecret("old-access");
  const encryptedRefreshToken = await encryptSecret("refresh-1");
  return await t.run(async ctx => {
    const now = Date.now();
    const user = async (clerkUserId: string) => (await ctx.db.query("users").withIndex("clerkUserId", q => q.eq("clerkUserId", clerkUserId)).unique())?._id
      ?? await ctx.db.insert("users", { clerkUserId });
    const staffUserId = await user("staff");
    const outsiderUserId = await user("outsider");
    let communityProfileId = (await ctx.db.query("profiles").withIndex("by_slug", q => q.eq("slug", "basic-nights")).unique())?._id;
    if (!communityProfileId) {
      communityProfileId = await ctx.db.insert("profiles", { slug: "basic-nights", displayName: "Basic Nights", sortName: "basic nights", profileType: "community", community: { categoryTags: [] }, aliases: [], tags: [], claimState: "unclaimed", publicationState: "published", publicSurfacingState: "public", creationSource: "community", updatedAt: now });
      const roleId = await ctx.db.insert("communityRoles", { communityProfileId, key: "staff", label: "Staff", permissions: ["manage_integrations", "manage_events"], assignableRoleIds: [], state: "active", createdAt: now, updatedAt: now });
      await ctx.db.insert("communityAuthorities", { communityProfileId, subjectTokenIdentifier: "test|staff", subject: { tokenIdentifier: "test|staff", issuer: "test", subject: "staff" }, roleId, state: "active", grantedAt: now, updatedAt: now });
    }
    const credentialId = await ctx.db.insert("connectorCredentials", {
      provider: "google", ownerUserId: staffUserId, encryptedAccessToken, encryptedRefreshToken, accessTokenExpiresAt: NOW + 3_600_000,
      scopes: [], externalAccountId: "google-sub-1", state: "active", createdAt: now, updatedAt: now,
    });
    const connectorId = await ctx.db.insert("eventConnectors", {
      communityProfileId, kind: "google_calendar", direction: options.direction, mode: options.mode ?? "autopublish", authorityUserId: staffUserId,
      credentialId, target: { calendarId: "cal-1", ...options.target }, state: options.state ?? "active", createdAt: now, updatedAt: now,
    });
    return { connectorId, credentialId, communityProfileId, staffUserId, outsiderUserId };
  });
}

export async function seedEvent(t: TestConvex<typeof schema>, communityProfileId: Id<"profiles">, overrides: Partial<Doc<"events">> = {}): Promise<Id<"events">> {
  const row = {
    title: "Bass Temple", slug: "bass-temple-nov-7", eventDate: "2026-11-07", timezone: "America/New_York", scheduleKind: "timed" as const,
    startAt: Date.parse("2026-11-08T01:00:00.000Z"), endAt: Date.parse("2026-11-08T04:00:00.000Z"), summary: "Weekly bass night.", venueLabel: "The Temple",
    eventStatus: "scheduled" as const, publicationState: "published" as const, sourceType: "community" as const, sourceLabel: "Community-submitted event",
    updatedAt: NOW - 60_000, communityProfileId, ...overrides,
  };
  const { sortAt: _sortAt, ...schedule } = row;
  return await t.run(ctx => ctx.db.insert("events", { sortTitle: row.title.toLowerCase(), sortAt: eventSortAt(schedule), ...row }));
}

export function googleItem(overrides: Partial<GoogleCalendarEvent> = {}): GoogleCalendarEvent {
  return {
    id: "g1", status: "confirmed", summary: "Bass Temple", location: "The Temple", description: "Weekly bass night.\n\n" + EVENT_URL,
    start: { dateTime: "2026-11-07T20:00:00-05:00", timeZone: "America/New_York" }, end: { dateTime: "2026-11-07T23:00:00-05:00", timeZone: "America/New_York" },
    updated: "2026-11-02T11:00:00.000Z", ...overrides,
  };
}

export async function runSyncJob(t: TestConvex<typeof schema>, job: { connectorId: Id<"eventConnectors">; kind: Doc<"eventSyncJobs">["kind"]; eventId?: Id<"events">; payload?: unknown }): Promise<Doc<"eventSyncJobs">> {
  const jobId = await t.run(ctx => ctx.db.insert("eventSyncJobs", {
    connectorId: job.connectorId, eventId: job.eventId, kind: job.kind, payload: job.payload ?? null, dueAt: NOW, attempts: 0, state: "pending", createdAt: NOW, updatedAt: NOW,
  }));
  await t.action(internal.eventSync.runJob, { jobId });
  return (await t.run(ctx => ctx.db.get(jobId)))!;
}
