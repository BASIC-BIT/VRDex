import { fromJsonSchema, McpServer } from "@modelcontextprotocol/server";
import {
  ApiEventCreateRequestSchema,
  ApiEventUpdateRequestSchema,
  ApiEventWriteResponseSchema,
  mcpOutputJsonSchemaForZodSchema,
  PublicActiveWorldsResponseSchema,
  PublicEventSchema,
  PublicEventsResponseSchema,
  PublicProfileSchema,
  PublicSearchResponseSchema,
  PublicWorldSchema,
  z,
} from "@vrdex/api-contracts";

import { createVrdexApiClient, type VrdexApiClient, type VrdexApiFailure } from "./api-client";
import type { VrdexMcpConfig, VrdexMcpOutputMode } from "./config";
import { loadVrdexMcpConfig } from "./config";

type ResponseSchema<T> = z.ZodType<T>;

export type VrdexMcpServerOptions = {
  apiClient?: VrdexApiClient;
  config?: VrdexMcpConfig;
};

const mcpSearchTypes = ["all", "person", "community", "profile", "world", "event"] as const;
const mcpSlugSchema = z.string().min(1).max(160);
const mcpLimitSchema = z.number().int().min(1);
const mcpEventUpdateInputSchema = z.object({
  slug: mcpSlugSchema.describe("Current public event slug."),
  update: ApiEventUpdateRequestSchema,
});
const mcpEventWriteResultSchema = ApiEventWriteResponseSchema.extend({
  canonicalUrl: z.string().url(),
  event: PublicEventSchema,
}).meta({
  description: "Accepted event write plus the normalized public event read back from VRDex.",
  id: "McpEventWriteResult",
});

function boundedLimit(value: number | undefined, fallback: number, max: number) {
  return Math.max(1, Math.min(value ?? fallback, max));
}

function formatJson(value: unknown, outputMode: VrdexMcpOutputMode) {
  return outputMode === "detail" ? JSON.stringify(value, null, 2) : JSON.stringify(value);
}

function mcpJsonResult<T>(schema: ResponseSchema<T>, value: unknown, outputMode: VrdexMcpOutputMode) {
  const structuredContent = schema.parse(value);

  return {
    content: [{ type: "text" as const, text: formatJson(structuredContent, outputMode) }],
    structuredContent,
  };
}

function mcpOutputSchema<T>(schema: ResponseSchema<T>) {
  return fromJsonSchema<T>(mcpOutputJsonSchemaForZodSchema(schema));
}

function mcpNotFound(resourceName: string, slug: string) {
  return {
    content: [{ type: "text" as const, text: `${resourceName} was not found for slug "${slug}".` }],
    isError: true as const,
  };
}

function mcpApiError(error: VrdexApiFailure) {
  const parts = [`VRDex API request failed with ${error.status}: ${error.title}.`];

  if (error.detail !== undefined) {
    parts.push(error.detail);
  }

  if (error.retryAfter !== undefined) {
    parts.push(`Retry after ${error.retryAfter} seconds.`);
  }

  return {
    content: [{ type: "text" as const, text: parts.join(" ") }],
    isError: true as const,
  };
}

function canonicalEventUrl(apiBaseUrl: string, eventPath: string) {
  const url = new URL(apiBaseUrl);

  url.pathname = eventPath;
  url.search = "";
  url.hash = "";

  return url.toString();
}

function mcpEventReadbackError(
  write: z.infer<typeof ApiEventWriteResponseSchema>,
  error: VrdexApiFailure,
) {
  const parts = [
    `VRDex accepted the event write for slug "${write.slug}", but the required readback failed with ${error.status}: ${error.title}.`,
    "Do not retry the mutation automatically; inspect the saved event first.",
  ];

  if (error.detail !== undefined) {
    parts.push(error.detail);
  }

  return {
    content: [{ type: "text" as const, text: parts.join(" ") }],
    isError: true as const,
  };
}

export function buildVrdexMcpServer(options: VrdexMcpServerOptions = {}) {
  const config = options.config ?? loadVrdexMcpConfig();
  const apiClient = options.apiClient ?? createVrdexApiClient(config);
  const server = new McpServer({
    name: "vrdex",
    version: "0.5.0",
  });

  server.registerTool(
    "vrdex_search",
    {
      title: "Search VRDex",
      description: "Search public VRDex profiles, worlds, and events.",
      inputSchema: z.object({
        limit: mcpLimitSchema.max(50).optional(),
        query: z.string().trim().max(160),
        type: z.enum(mcpSearchTypes).optional(),
      }),
      outputSchema: mcpOutputSchema(PublicSearchResponseSchema),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ limit, query, type }) => {
      const normalizedType = type ?? "all";
      const cappedLimit = boundedLimit(limit, 24, 50);
      const searchText = query.trim();

      if (!searchText) {
        return mcpJsonResult(
          PublicSearchResponseSchema,
          {
            query: searchText,
            type: normalizedType,
            results: [],
          },
          config.outputMode,
        );
      }

      const result = await apiClient.search({ query: searchText, type: normalizedType, limit: cappedLimit });

      return result.ok ? mcpJsonResult(PublicSearchResponseSchema, result.data, config.outputMode) : mcpApiError(result);
    },
  );

  server.registerTool(
    "vrdex_get_profile",
    {
      title: "Get VRDex Profile",
      description: "Read one public VRDex person or community profile by slug.",
      inputSchema: z.object({
        profileType: z.enum(["person", "community"]).optional(),
        slug: mcpSlugSchema,
      }),
      outputSchema: mcpOutputSchema(PublicProfileSchema),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ profileType, slug }) => {
      const result = await apiClient.getProfile({ slug, profileType });

      if (!result.ok) {
        return result.status === 404 ? mcpNotFound("Profile", slug) : mcpApiError(result);
      }

      return mcpJsonResult(PublicProfileSchema, result.data, config.outputMode);
    },
  );

  server.registerTool(
    "vrdex_get_event",
    {
      title: "Get VRDex Event",
      description: "Read one public VRDex event by slug.",
      inputSchema: z.object({
        slug: mcpSlugSchema,
      }),
      outputSchema: mcpOutputSchema(PublicEventSchema),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ slug }) => {
      const result = await apiClient.getEvent(slug);

      if (!result.ok) {
        return result.status === 404 ? mcpNotFound("Event", slug) : mcpApiError(result);
      }

      return mcpJsonResult(PublicEventSchema, result.data, config.outputMode);
    },
  );

  server.registerTool(
    "vrdex_list_upcoming_events",
    {
      title: "List VRDex Upcoming Events",
      description: "List upcoming public VRDex event cards.",
      inputSchema: z.object({
        limit: mcpLimitSchema.max(24).optional(),
      }),
      outputSchema: mcpOutputSchema(PublicEventsResponseSchema),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ limit }) => {
      const result = await apiClient.listUpcomingEvents({ limit: boundedLimit(limit, 8, 24) });

      return result.ok ? mcpJsonResult(PublicEventsResponseSchema, result.data, config.outputMode) : mcpApiError(result);
    },
  );

  server.registerTool(
    "vrdex_get_world",
    {
      title: "Get VRDex World",
      description: "Read one public VRDex world by slug.",
      inputSchema: z.object({
        slug: mcpSlugSchema,
      }),
      outputSchema: mcpOutputSchema(PublicWorldSchema),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ slug }) => {
      const result = await apiClient.getWorld(slug);

      if (!result.ok) {
        return result.status === 404 ? mcpNotFound("World", slug) : mcpApiError(result);
      }

      return mcpJsonResult(PublicWorldSchema, result.data, config.outputMode);
    },
  );

  server.registerTool(
    "vrdex_list_active_worlds",
    {
      title: "List VRDex Active Worlds",
      description: "List public VRDex worlds with upcoming or live events.",
      inputSchema: z.object({
        limit: mcpLimitSchema.max(6).optional(),
      }),
      outputSchema: mcpOutputSchema(PublicActiveWorldsResponseSchema),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ limit }) => {
      const result = await apiClient.listActiveWorlds({ limit: boundedLimit(limit, 3, 6) });

      return result.ok
        ? mcpJsonResult(PublicActiveWorldsResponseSchema, result.data, config.outputMode)
        : mcpApiError(result);
    },
  );

  if (config.bearerToken !== undefined) {
    server.registerTool(
      "vrdex_event_create",
      {
        title: "Create VRDex Event",
        description:
          "Create and publish a community event through the authenticated VRDex API. This changes public VRDex data and requires explicit operator approval.",
        inputSchema: ApiEventCreateRequestSchema,
        outputSchema: mcpOutputSchema(mcpEventWriteResultSchema),
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: true,
        },
      },
      async (input) => {
        const write = await apiClient.createEvent(input);

        if (!write.ok) {
          return mcpApiError(write);
        }

        const readback = await apiClient.getEvent(write.data.slug);

        if (!readback.ok) {
          return mcpEventReadbackError(write.data, readback);
        }

        return mcpJsonResult(
          mcpEventWriteResultSchema,
          {
            ...write.data,
            canonicalUrl: canonicalEventUrl(apiClient.apiBaseUrl, write.data.eventPath),
            event: readback.data,
          },
          config.outputMode,
        );
      },
    );

    server.registerTool(
      "vrdex_event_update",
      {
        title: "Update VRDex Event",
        description:
          "Update a community event through the authenticated VRDex API. Omitted fields are preserved; explicit nulls and empty arrays can clear data. This changes public VRDex data and requires explicit operator approval.",
        inputSchema: mcpEventUpdateInputSchema,
        outputSchema: mcpOutputSchema(mcpEventWriteResultSchema),
        annotations: {
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: false,
          openWorldHint: true,
        },
      },
      async ({ slug, update }) => {
        const write = await apiClient.updateEvent(slug, update);

        if (!write.ok) {
          return mcpApiError(write);
        }

        const readback = await apiClient.getEvent(write.data.slug);

        if (!readback.ok) {
          return mcpEventReadbackError(write.data, readback);
        }

        return mcpJsonResult(
          mcpEventWriteResultSchema,
          {
            ...write.data,
            canonicalUrl: canonicalEventUrl(apiClient.apiBaseUrl, write.data.eventPath),
            event: readback.data,
          },
          config.outputMode,
        );
      },
    );
  }

  return server;
}
