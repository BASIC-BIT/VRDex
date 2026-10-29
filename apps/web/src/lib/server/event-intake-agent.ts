import { extractEventIntake, type EventIntakeAgentInput } from "@vrdex/event-intake-agent";

/** One authenticated adapter for website and MCP. Transport-specific auth stays at the caller. */
export function createEventIntakeExtractor(deps: {
  authority: () => Promise<{ actorUserId: import("../../../../../convex/_generated/dataModel").Id<"users"> }>;
  admin: Pick<ReturnType<typeof import("./convex-http").convexAdminHttpClient>, "mutation" | "query">;
  readPoster: (id: string) => Promise<string>;
}) {
  return async (input: EventIntakeAgentInput) => {
    const { api, internal } = await import("../../../../../convex/_generated/api");
    const lookup = async (query: string, limit: number, profileType: "person" | "community") => {
      const rows = await deps.admin.query(api.search.searchUniversal, { query, limit, entityType: "profile", profileType });
      return rows.map(row => ({ slug: row.slug, displayName: row.title }));
    };
    return extractEventIntake(input, {
      authorize: async (value, reserveQuota) => deps.admin.mutation(internal.eventIntakeSources.authorizeExtraction, {
        ...await deps.authority(), draftId: value.draftId as import("../../../../../convex/_generated/dataModel").Id<"eventIntakeDrafts">,
        posterAssetId: value.posterAssetId as import("../../../../../convex/_generated/dataModel").Id<"eventPosterSources"> | undefined,
        reserveQuota,
      }),
      readPoster: deps.readPoster,
      search_people: (query, limit) => lookup(query, limit, "person"),
      search_communities: (query, limit) => lookup(query, limit, "community"),
      record: metric => console.info("event-intake-extraction", metric),
    });
  };
}
