import { composeSinks, createLangfuseSink, createPostHogSink, extractEventIntake, type EventIntakeAgentInput, type EventIntakeSink } from "@vrdex/event-intake-agent";

/** One authenticated adapter for website and MCP. Transport-specific auth stays at the caller. */
export function createEventIntakeExtractor(deps: {
  authority: () => Promise<{ actorUserId: import("../../../../../convex/_generated/dataModel").Id<"users"> }>;
  admin: Pick<ReturnType<typeof import("./convex-http").convexAdminHttpClient>, "mutation" | "query">;
  readPoster: (id: string) => Promise<string>;
  trigger: "web" | "mcp";
}) {
  return async (input: EventIntakeAgentInput) => {
    const { api, internal } = await import("../../../../../convex/_generated/api");
    const lookup = async (query: string, limit: number, profileType: "person" | "community") => {
      const rows = await deps.admin.query(api.search.searchUniversal, { query, limit, entityType: "profile", profileType });
      return rows.map(row => ({ slug: row.slug, displayName: row.title }));
    };
    const { LANGFUSE_PUBLIC_KEY: publicKey, LANGFUSE_SECRET_KEY: secretKey } = process.env;
    const sinks: EventIntakeSink[] = [createPostHogSink(event => deps.admin.mutation(internal.productAnalytics.enqueue, event).then(() => undefined))];
    if (publicKey && secretKey) sinks.push(createLangfuseSink({ publicKey, secretKey, baseUrl: process.env.LANGFUSE_BASE_URL || undefined }));
    const composed = composeSinks(...sinks);
    return extractEventIntake(input, {
      authorize: async (value, reserveQuota) => deps.admin.mutation(internal.eventIntakeSources.authorizeExtraction, {
        ...await deps.authority(), draftId: value.draftId as import("../../../../../convex/_generated/dataModel").Id<"eventIntakeDrafts">,
        posterAssetId: value.posterAssetId as import("../../../../../convex/_generated/dataModel").Id<"eventPosterSources"> | undefined,
        reserveQuota,
      }),
      readPoster: deps.readPoster,
      search_people: (query, limit) => lookup(query, limit, "person"),
      search_communities: (query, limit) => lookup(query, limit, "community"),
      // Tags the trigger without passing run context, so web and MCP keep today's tools and instructions.
      sink: { start: meta => composed.start({ ...meta, trigger: deps.trigger }) },
    });
  };
}
