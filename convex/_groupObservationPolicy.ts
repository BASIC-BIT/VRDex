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
