import type { DatabaseReader, MutationCtx } from "./_generated/server";
import { requireActiveBrowserSessionSubject } from "./_browserSessionAuthority";
import { requireControlProof } from "./_externalControl";
import type { Doc, Id } from "./_generated/dataModel";
import { readClubVisibility } from "./_clubAccess";
import type { ClubVisibility } from "./_clubModel";
import { canReadProfile } from "./_profilePermissions";

export type CollectionSubject = NonNullable<Doc<"communityVrchatIntegrations">["collectionScope"]>;

export function readCollectionSubject(integration: Doc<"communityVrchatIntegrations">): CollectionSubject {
  const scope = integration.collectionScope;
  if (scope?.kind === "automatic") {
    if (integration.communityProfileId !== undefined) throw new Error("Automatic collection scope cannot manage a community.");
    return { kind: "automatic" };
  }
  const communityProfileId = scope?.communityProfileId ?? integration.communityProfileId;
  if (!communityProfileId || (scope && integration.communityProfileId !== communityProfileId)) {
    throw new Error("Managed collection scope does not match its community.");
  }
  return { kind: "managed", communityProfileId };
}

export async function readManagedIntegration(db: DatabaseReader, communityProfileId: Id<"profiles">) {
  // shortcut: more than 100 historical connections require reconciliation before managed access.
  const rows = await db.query("communityVrchatIntegrations")
    .withIndex("by_communityProfileId", q => q.eq("communityProfileId", communityProfileId)).take(101);
  if (rows.length > 100) throw new Error("Group connections require reconciliation.");
  for (const row of rows) {
    const subject = readCollectionSubject(row);
    if (subject.kind !== "managed" || subject.communityProfileId !== communityProfileId) throw new Error("Collection scope does not manage this community.");
  }
  const current = rows.filter(row => row.state !== "disconnected");
  if (current.length > 1) throw new Error("Group connections require reconciliation.");
  return current[0] ?? rows.sort((a, b) => b.createdAt - a.createdAt || b._id.localeCompare(a._id))[0] ?? null;
}

export async function saveManagedPublicationChoice(ctx: MutationCtx, communityProfileId: Id<"profiles">) {
  const integration = await readManagedIntegration(ctx.db, communityProfileId);
  if (!integration) return;
  if (integration.publicationPolicy === "automatic_aggregate") {
    const { userId } = await requireActiveBrowserSessionSubject(ctx);
    await requireControlProof(ctx.db, userId, "vrchat_group", integration.vrchatGroupId, "manager");
  }
  await ctx.db.patch(integration._id, { publicationPolicy: "managed_categories", updatedAt: Date.now() });
}

export async function readPublicGroupId(db: DatabaseReader, profileId: Id<"profiles">) {
  const links = await db.query("profileExternalLinks")
    .withIndex("by_profileId_assetType_state", q => q.eq("profileId", profileId)
      .eq("assetType", "vrchat_group").eq("state", "active")).take(101);
  if (links.length > 100) return null;
  const primary = links.filter(link => link.linkRole === "primary");
  if (primary.length) {
    if (primary.length !== 1) return null;
    const link = primary[0]!;
    if (link.provenance === "directory_reference") {
      const selected = (await db.get(profileId))?.primaryGroupReference;
      if (!selected) return null;
      const destination = await db.query("profileLinkDestinations")
        .withIndex("by_key", q => q.eq("key", selected.key)).unique();
      if (destination?.kind !== "vrchat_group" || destination.status !== "resolved" ||
        destination.entityId !== link.assetExternalId) return null;
    }
    return link.assetExternalId;
  }
  const integration = await readManagedIntegration(db, profileId);
  if (!integration || integration.state === "disconnected" || integration.state === "disconnecting") return null;
  const priorLinks = await db.query("profileExternalLinks")
    .withIndex("by_profileId_assetType_assetExternalId", q => q.eq("profileId", profileId)
      .eq("assetType", "vrchat_group").eq("assetExternalId", integration.vrchatGroupId)).take(101);
  return priorLinks.length > 100 || priorLinks.some(link => link.state === "removed") ? null : integration.vrchatGroupId;
}

type Integration = Doc<"communityVrchatIntegrations">;
export type GroupObservationPolicy =
  | { kind: "hidden" }
  | { kind: "member_metadata"; integration: Integration | null; historyStartAt: number }
  | { kind: "automatic_aggregate"; integration: Integration; historyStartAt: number }
  | { kind: "managed"; integration: Integration; communityProfileId: Id<"profiles">; categories: ClubVisibility; historyStartAt: number };

export async function resolveGroupObservationPolicy(
  db: DatabaseReader,
  input: { vrchatGroupId: string; profileId: Id<"profiles">; now: number },
): Promise<GroupObservationPolicy> {
  const registry = await db.query("vrchatGroupObservationPolicies")
    .withIndex("by_vrchatGroupId", q => q.eq("vrchatGroupId", input.vrchatGroupId)).unique();
  if (registry?.decision.kind === "stopped") return { kind: "hidden" };
  const historyStartAt = registry?.publicHistoryStartAt ?? 0;
  const profile = await db.get(input.profileId);
  if (!profile || profile.profileType !== "community" || !canReadProfile("public", profile) ||
    await readPublicGroupId(db, input.profileId) !== input.vrchatGroupId) return { kind: "hidden" };
  const rows = await db.query("communityVrchatIntegrations")
    .withIndex("by_vrchatGroupId", q => q.eq("vrchatGroupId", input.vrchatGroupId)).take(101);
  // shortcut: fail closed on oversized or conflicting group assignments until operator reconciliation.
  if (rows.length > 100) return { kind: "hidden" };
  const managed = rows.filter(row => readCollectionSubject(row).kind === "managed");
  const liveManaged = managed.filter(row => row.state !== "disconnected");
  if (liveManaged.length > 1) return { kind: "hidden" };
  const managing = liveManaged[0] ?? managed.sort((a, b) => b.createdAt - a.createdAt || b._id.localeCompare(a._id))[0];
  const canonical = registry?.integrationId ? await db.get(registry.integrationId) : null;
  if (registry?.integrationId && (!canonical || canonical.vrchatGroupId !== input.vrchatGroupId)) return { kind: "hidden" };
  if (managing) {
    if (canonical && canonical._id !== managing._id) return { kind: "hidden" };
    if (["disconnected", "disconnecting", "blocked"].includes(managing.state)) return { kind: "hidden" };
    const subject = readCollectionSubject(managing);
    if (subject.kind !== "managed") return { kind: "hidden" };
    const categories = await readClubVisibility(db, subject.communityProfileId);
    if ((managing.enabledFeatures && !managing.enabledFeatures.includes("analytics")) || registry?.decision.kind === "admission_blocked") {
      return categories.group_size.audience === "public" ? { kind: "member_metadata", integration: managing, historyStartAt } : { kind: "hidden" };
    }
    if (managing.publicationPolicy !== "automatic_aggregate") return {
      kind: "managed", integration: managing, communityProfileId: subject.communityProfileId, categories, historyStartAt,
    };
  }
  const integration = managing ?? canonical;
  if (integration) {
    const links = await db.query("profileExternalLinks")
      .withIndex("by_profileId_assetType_state", q => q.eq("profileId", input.profileId)
        .eq("assetType", "vrchat_group").eq("state", "active")).take(101);
    if (readCollectionSubject(integration).kind === "automatic" && registry?.decision.kind === "enabled" && !["active", "degraded"].includes(integration.state)) {
      return (await readClubVisibility(db, input.profileId)).group_size.audience === "public"
        ? { kind: "member_metadata", integration, historyStartAt } : { kind: "hidden" };
    }
    if (!registry || registry.decision.kind !== "enabled" ||
      !links.some(link => link.linkRole === "primary" && link.assetExternalId === input.vrchatGroupId) ||
      integration.groupVisibility !== "public" || integration.joinPolicy !== "free" ||
      !["active", "degraded"].includes(integration.state) || integration.killSwitchEnabled) return { kind: "hidden" };
    return { kind: "automatic_aggregate", integration,
      historyStartAt: Math.max(integration.telemetryEpochStartedAt ?? integration.createdAt, historyStartAt) };
  }
  if (registry && registry.decision.kind !== "enabled") return { kind: "hidden" };
  return (await readClubVisibility(db, input.profileId)).group_size.audience === "public"
    ? { kind: "member_metadata", integration: null, historyStartAt } : { kind: "hidden" };
}

export async function readLegacyRollupMapping(db: DatabaseReader, communityProfileId?: Id<"profiles">) {
  if (!communityProfileId) return { kind: "missing_mapping" } as const;
  const candidates = await db.query("communityVrchatIntegrations")
    .withIndex("by_communityProfileId", q => q.eq("communityProfileId", communityProfileId)).take(2);
  if (candidates.length > 1) return { kind: "ambiguous_mapping" } as const;
  const integration = candidates[0];
  if (!integration || readCollectionSubject(integration).kind !== "managed") return { kind: "missing_mapping" } as const;
  return { kind: "resolved", integration } as const;
}

export async function readIntegrationRollups(
  db: DatabaseReader,
  integration: Doc<"communityVrchatIntegrations">,
  input: {
    grain: Doc<"communityTelemetryRollups">["grain"];
    startAt: number;
    endAt?: number;
    limit: number;
    before?: { at: number; createdAt: number; id: Id<"communityTelemetryRollups"> } | null;
  },
) {
  const startAt = Math.max(input.startAt, integration.telemetryEpochStartedAt ?? integration.createdAt);
  const endAt = Math.min(input.endAt === undefined ? Infinity : input.endAt - 1, input.before?.at ?? Infinity);
  const queries = [db.query("communityTelemetryRollups")
    .withIndex("by_integrationId_grain_bucketStartAt", q => q.eq("integrationId", integration._id)
      .eq("grain", input.grain).gte("bucketStartAt", startAt).lte("bucketStartAt", endAt))];
  const subject = readCollectionSubject(integration);
  const mapping = subject.kind === "managed" ? await readLegacyRollupMapping(db, subject.communityProfileId) : null;
  if (subject.kind === "managed" && mapping?.kind === "resolved" && mapping.integration._id === integration._id) {
    queries.push(db.query("communityTelemetryRollups")
      .withIndex("by_communityProfileId_integrationId_grain_bucketStartAt", q => q
        .eq("communityProfileId", subject.communityProfileId).eq("integrationId", undefined)
        .eq("grain", input.grain).gte("bucketStartAt", startAt).lte("bucketStartAt", endAt)));
  }
  const boundary = input.before;
  const pages = await Promise.all(queries.map(query => (boundary ? query.filter(q => q.or(
    q.lt(q.field("bucketStartAt"), boundary.at),
    q.and(q.eq(q.field("bucketStartAt"), boundary.at), q.or(
      q.lt(q.field("_creationTime"), boundary.createdAt),
      q.and(q.eq(q.field("_creationTime"), boundary.createdAt), q.lt(q.field("_id"), boundary.id)))),
  )) : query).order("desc").take(input.limit)));
  return pages.flat().sort((a, b) => b.bucketStartAt - a.bucketStartAt || b._creationTime - a._creationTime ||
    (a._id < b._id ? 1 : a._id > b._id ? -1 : 0)).slice(0, input.limit);
}
