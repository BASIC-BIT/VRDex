import type { DatabaseReader } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";

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
