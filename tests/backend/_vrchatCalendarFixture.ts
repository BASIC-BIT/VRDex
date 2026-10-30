import type { SuiteContext, TestContext } from "node:test";
import type { TestConvex, TestConvexForDataModel } from "convex-test";
import type { Infer } from "convex/values";
import type schema from "../../convex/schema";
import { internal } from "../../convex/_generated/api";
import type { DataModel, Doc, Id } from "../../convex/_generated/dataModel";
import type { ConnectorDirection, ConnectorMode } from "../../convex/_eventConnectors";
import type { ClubIntegrationFeature } from "../../convex/_clubOperationPolicy";
import type { operationResult, VrchatCalendarItem } from "../../convex/_clubOperations";
import { loadEventsWithFixtureCapacity } from "./_eventCapacityFixture";

type T = TestConvex<typeof schema>;

export const NOW = Date.parse("2026-11-02T12:00:00.000Z");
export const SITE = "https://vrdex.test";
export const EVENT_URL = "https://vrdex.test/basic-nights/events/bass-temple-nov-7";
export const GROUP_ID = "grp_11111111-1111-1111-1111-111111111111";
export const BOT_ID = "usr_22222222-2222-2222-2222-222222222222";
export const calId = (n: number) => `cal_00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
export const CAL_1 = calId(1);
const ISSUER = "https://test.clerk.accounts.dev";

export const modules: Record<string, () => Promise<unknown>> = {
  "../../convex/_generated/api.ts": () => import("../../convex/_generated/api"),
  "../../convex/http.ts": () => import("../../convex/http"),
  "../../convex/clubOperations.ts": () => import("../../convex/clubOperations"),
  "../../convex/clubConnection.ts": () => import("../../convex/clubConnection"),
  "../../convex/communityTelemetry.ts": () => import("../../convex/communityTelemetry"),
  "../../convex/events.ts": loadEventsWithFixtureCapacity,
  "../../convex/eventIntake.ts": () => import("../../convex/eventIntake"),
  "../../convex/eventIntakeSources.ts": () => import("../../convex/eventIntakeSources"),
  "../../convex/eventCorrections.ts": () => import("../../convex/eventCorrections"),
  "../../convex/eventConnectors.ts": () => import("../../convex/eventConnectors"),
  "../../convex/eventSync.ts": () => import("../../convex/eventSync"),
  "../../convex/search.ts": () => import("../../convex/search"),
  "../../convex/opsAlerts.ts": () => import("../../convex/opsAlerts"),
  "../../convex/opsAlertEmail.ts": () => import("../../convex/opsAlertEmail"),
  "../../convex/vrchatCalendarConnector.ts": () => import("../../convex/vrchatCalendarConnector"),
};

// Date and setTimeout are mocked so scheduled functions (a resume's runAfter(0, runJob)) never run mid-test.
export function setupEnv(test: TestContext | SuiteContext) {
  process.env.VRDEX_EVENT_CONNECTORS_ENABLED = "true";
  process.env.VRDEX_CONNECTOR_VRCHAT_CALENDAR_ENABLED = "true";
  process.env.SITE_URL = SITE;
  process.env.CLERK_JWT_ISSUER_DOMAIN = ISSUER;
  (test as TestContext).mock.timers.enable({ apis: ["Date", "setTimeout"], now: NOW });
}

const identity = (subject: string) => ({ subject, issuer: ISSUER, tokenIdentifier: `${ISSUER}|${subject}`, emailVerified: true });
export const asOwner = (t: T): TestConvexForDataModel<DataModel> => t.withIdentity(identity("owner"));
export const asStaff = (t: T): TestConvexForDataModel<DataModel> => t.withIdentity(identity("staff"));

export async function seedVrchatConnector(t: T, options: {
  direction?: ConnectorDirection; mode?: ConnectorMode; features?: readonly string[]; assigned?: boolean;
  authority?: "owner" | "integrations_only"; connector?: boolean;
} = {}) {
  return t.run(async (ctx) => {
    const now = Date.now();
    const owner = await ctx.db.insert("users", { clerkUserId: "owner" });
    const communityProfileId = await ctx.db.insert("profiles", {
      slug: "basic-nights", displayName: "Basic Nights", sortName: "basic nights", aliases: [], tags: [],
      claimState: "claimed_verified", publicationState: "published", publicSurfacingState: "public",
      creationSource: "self", updatedAt: now, profileType: "community", community: { categoryTags: [] },
    });
    await ctx.db.insert("profileOwners", { profileId: communityProfileId, userId: owner, roleKey: "owner", state: "active", grantedAt: now, updatedAt: now });
    const collectorAccountId = await ctx.db.insert("collectorAccounts", {
      vrchatUserId: BOT_ID, accountAlias: "bot", state: "ready", capacity: 10, reservedHeadroom: 0, assignedGroupCount: 1,
      requestsPerMinute: 30, secretRef: "secret", workerKeyHash: "hash", credentialGeneration: 1, killSwitchEnabled: false,
      createdAt: now, updatedAt: now,
    });
    const integrationId = await ctx.db.insert("communityVrchatIntegrations", {
      communityProfileId, vrchatGroupId: GROUP_ID, groupVisibility: "public", joinPolicy: "free", state: "active",
      ...(options.assigned === false ? {} : { assignedCollectorAccountId: collectorAccountId }),
      killSwitchEnabled: false, requestsPerMinute: 10, leaseGeneration: 1,
      publicMetrics: { currentPopulation: false, populationHistory: false, groupMemberCount: false, groupMemberGrowth: false, eventRecaps: false },
      consecutiveFailures: 0, telemetryEpochStartedAt: now - 1000, createdAt: now - 1000, updatedAt: now,
      enabledFeatures: (options.features ?? ["calendar"]) as ClubIntegrationFeature[],
    });
    await ctx.db.insert("collectorAccountLeases", {
      integrationId, collectorAccountId, workerId: "worker", fencingToken: 1, state: "active",
      claimedAt: now, expiresAt: now + 600_000, updatedAt: now,
    });
    let authorityUserId = owner;
    if (options.authority === "integrations_only") {
      authorityUserId = await ctx.db.insert("users", { clerkUserId: "staff" });
      const roleId = await ctx.db.insert("communityRoles", {
        communityProfileId, key: "integrations", label: "Integrations", permissions: ["manage_integrations"],
        assignableRoleIds: [], state: "active", createdAt: now, updatedAt: now,
      });
      const subject = { subject: "staff", issuer: ISSUER, tokenIdentifier: `${ISSUER}|staff` };
      await ctx.db.insert("communityAuthorities", {
        communityProfileId, subject, subjectTokenIdentifier: subject.tokenIdentifier, roleId,
        state: "active", grantedAt: now, updatedAt: now,
      });
    }
    const connectorId = options.connector === false ? undefined : await ctx.db.insert("eventConnectors", {
      communityProfileId, kind: "vrchat_calendar", direction: options.direction ?? "export", mode: options.mode ?? "autopublish",
      authorityUserId, target: { groupId: GROUP_ID, timezone: "America/New_York" }, state: "active", createdAt: now, updatedAt: now,
    });
    return { connectorId, communityProfileId, integrationId, collectorAccountId, authorityUserId };
  });
}

const eventDefaults = () => ({
  title: "Bass Temple", sortTitle: "bass temple", slug: "bass-temple-nov-7", eventDate: "2026-11-07", timezone: "America/New_York",
  scheduleKind: "timed" as const, startAt: Date.parse("2026-11-08T01:00:00.000Z"), endAt: Date.parse("2026-11-08T04:00:00.000Z"),
  sortAt: Date.parse("2026-11-08T01:00:00.000Z"), summary: "Weekly bass night.", eventStatus: "scheduled" as const,
  publicationState: "published" as const, sourceType: "community" as const, sourceLabel: "Basic Nights", communityName: "Basic Nights",
  updatedAt: NOW - 60_000,
});

export const seedEvent = (t: T, communityProfileId: Id<"profiles">, overrides: Partial<Doc<"events">> = {}) =>
  t.run((ctx) => ctx.db.insert("events", { ...eventDefaults(), communityProfileId, ...overrides }));

export const eventDoc = (overrides: Partial<Doc<"events">> = {}): Doc<"events"> =>
  ({ _id: "events_fixture" as Id<"events">, _creationTime: NOW - 60_000, ...eventDefaults(), ...overrides });

export const vrchatItem = (overrides: Partial<VrchatCalendarItem> = {}): VrchatCalendarItem => ({
  id: CAL_1, title: "Bass Temple", description: "Weekly bass night.\n\n" + EVENT_URL,
  startsAt: "2026-11-08T01:00:00.000Z", endsAt: "2026-11-08T04:00:00.000Z", updatedAt: "2026-11-02T11:00:00.000Z", ...overrides,
});

export async function rerunJob(t: T, jobId: Id<"eventSyncJobs">) {
  await t.action(internal.eventSync.runJob, { jobId });
  return (await t.run((ctx) => ctx.db.get(jobId)))!;
}

export async function runSyncJob(t: T, job: {
  connectorId: Id<"eventConnectors">; kind: Doc<"eventSyncJobs">["kind"]; eventId?: Id<"events">; payload?: unknown;
}) {
  const jobId = await t.run((ctx) => ctx.db.insert("eventSyncJobs", {
    connectorId: job.connectorId, kind: job.kind, ...(job.eventId ? { eventId: job.eventId } : {}), payload: job.payload ?? {},
    dueAt: NOW, attempts: 0, state: "pending", createdAt: NOW, updatedAt: NOW,
  }));
  return rerunJob(t, jobId);
}

export const workerArgs = (t: T) => t.run(async (ctx) => {
  const integration = (await ctx.db.query("communityVrchatIntegrations").first())!;
  return {
    epochStartedAt: integration.telemetryEpochStartedAt!, collectorAccountId: integration.assignedCollectorAccountId!,
    integrationId: integration._id, workerKeyHash: "hash", workerId: "worker", fencingToken: 1,
  };
});

// Claims the next operation as the collector, authorizes it with calendar grants, and reports the outcome.
export async function workerSettle(t: T, outcome: {
  status: "succeeded" | "rejected" | "indeterminate"; code?: string; result?: Infer<typeof operationResult>;
}) {
  const worker = await workerArgs(t);
  const claimed = await t.mutation(internal.clubOperations.claim, worker);
  if (!claimed) throw new Error("No operation to claim.");
  const authorization = await t.mutation(internal.clubOperations.authorizeSubmission, {
    ...worker, operationId: claimed.operationId, nonce: claimed.nonce,
    authority: {
      groupId: GROUP_ID, userId: BOT_ID, ownerUserId: "usr_99999999-9999-9999-9999-999999999999",
      membershipStatus: "member", permissions: ["group-calendar-manage"], observedAt: Date.now(),
    },
  });
  // A refusal would settle the operation on its own; fail loudly so a test asking for `succeeded` never gets `rejected`.
  if (!authorization.authorized) throw new Error("Submission refused: " + authorization.code);
  await t.mutation(internal.clubOperations.complete, { ...worker, operationId: claimed.operationId, nonce: claimed.nonce, ...outcome });
  return (await t.run((ctx) => ctx.db.get(claimed.operationId)))!;
}

export const operations = (t: T) => t.run((ctx) => ctx.db.query("clubOperations").collect());
