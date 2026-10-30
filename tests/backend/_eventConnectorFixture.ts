import { convexTest } from "convex-test";
import schemaModule from "../../convex/schema";
import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { loadEventsWithFixtureCapacity } from "./_eventCapacityFixture";

const schema = (schemaModule as unknown as { default?: typeof schemaModule }).default ?? schemaModule;
export const START = Date.UTC(2027, 1, 12, 20); // 2027-02-12 20:00 UTC
const grantedBy = { tokenIdentifier: "test|root", issuer: "test", subject: "root" };

export async function connectorFixture(options: { flag?: boolean } = {}) {
  process.env.EVENT_DATE_ONLY_ENABLED = "true";
  process.env.CLERK_JWT_ISSUER_DOMAIN = "test";
  if (options.flag === false) delete process.env.VRDEX_EVENT_CONNECTORS_ENABLED;
  else process.env.VRDEX_EVENT_CONNECTORS_ENABLED = "true";
  const t = convexTest({ schema, modules: {
    "../../convex/_generated/api.ts": () => import("../../convex/_generated/api"),
    "../../convex/events.ts": loadEventsWithFixtureCapacity,
    "../../convex/eventIntake.ts": () => import("../../convex/eventIntake"),
    "../../convex/eventIntakeSources.ts": () => import("../../convex/eventIntakeSources"),
    "../../convex/eventCorrections.ts": () => import("../../convex/eventCorrections"),
    "../../convex/eventConnectors.ts": () => import("../../convex/eventConnectors"),
    "../../convex/eventSync.ts": () => import("../../convex/eventSync"),
    "../../convex/communityTelemetry.ts": () => import("../../convex/communityTelemetry"),
    "../../convex/search.ts": () => import("../../convex/search"),
    "../../convex/opsAlerts.ts": () => import("../../convex/opsAlerts"),
    "../../convex/opsAlertEmail.ts": () => import("../../convex/opsAlertEmail"),
  } });
  const ids = await t.run(async ctx => {
    const now = Date.now();
    const [owner, integrator, eventStaff, outsider, admin] = await Promise.all(
      ["owner", "integrator", "event-staff", "outsider", "admin"].map(clerkUserId => ctx.db.insert("users", { clerkUserId })));
    const communityProfileId = await ctx.db.insert("profiles", { slug: "club", displayName: "Club", sortName: "club", profileType: "community", community: { categoryTags: [] }, aliases: [], tags: [], claimState: "unclaimed", publicationState: "published", publicSurfacingState: "public", creationSource: "community", updatedAt: now });
    await ctx.db.insert("profileOwners", { profileId: communityProfileId, userId: owner, roleKey: "owner", state: "active", grantedAt: now, updatedAt: now });
    await ctx.db.insert("accountFeatureGrants", { userId: admin, feature: "super_admin", state: "active", grantedBy, grantedAt: now, updatedAt: now });
    const role = (key: string, permissions: Doc<"communityRoles">["permissions"]) => ctx.db.insert("communityRoles", { communityProfileId, key, label: key, permissions, assignableRoleIds: [], state: "active", createdAt: now, updatedAt: now });
    const grant = async (subject: string, roleId: Id<"communityRoles">) => ctx.db.insert("communityAuthorities", { communityProfileId, subjectTokenIdentifier: `test|${subject}`, subject: { tokenIdentifier: `test|${subject}`, issuer: "test", subject }, roleId, state: "active", grantedAt: now, updatedAt: now });
    const integratorGrant = await grant("integrator", await role("integrations", ["manage_integrations"]));
    await grant("event-staff", await role("events", ["manage_events"]));
    return { communityProfileId, integratorGrant, users: { owner, integrator, eventStaff, outsider, admin } };
  });
  const as = (subject: string) => t.withIdentity({ subject, issuer: "test", tokenIdentifier: `test|${subject}`, emailVerified: true });
  const insertConnector = (overrides: Partial<Doc<"eventConnectors">> = {}) => t.run(ctx => ctx.db.insert("eventConnectors", {
    communityProfileId: ids.communityProfileId, kind: "google_calendar", direction: "bidirectional", mode: "autopublish",
    authorityUserId: ids.users.integrator, target: { calendarId: "club@example.com" }, state: "active",
    createdAt: Date.now(), updatedAt: Date.now(), ...overrides }));
  const createEvent = (args: { title?: string; startAt?: number; venueLabel?: string; published?: boolean; lineup?: Array<{ clientKey: string; position: number; performerLabel: string }> } = {}) =>
    as("owner").mutation(api.events.createCommunityEvent, { title: args.title ?? "Night Flight", startAt: args.startAt ?? START, timezone: "UTC", communitySlug: "club", published: args.published ?? true, venueLabel: args.venueLabel, lineup: args.lineup });
  return { t, as, ...ids, insertConnector, createEvent };
}
