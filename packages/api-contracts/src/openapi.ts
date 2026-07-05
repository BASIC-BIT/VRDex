import { createDocument, type ZodOpenApiObject, type ZodOpenApiResponsesObject } from "zod-openapi";

import { apiScopes } from "./auth";
import {
  ApiProblemSchema,
  ApiRateLimitUsageResponseSchema,
  LimitQueryParamsSchema,
  PublicActiveWorldsResponseSchema,
  PublicClaimStatusResponseSchema,
  PublicEventsResponseSchema,
  PublicEventSchema,
  PublicProfileAssetsResponseSchema,
  PublicProfileLogosResponseSchema,
  PublicProfileSchema,
  PublicSearchResponseSchema,
  PublicWorldSchema,
  SearchQueryParamsSchema,
  SlugPathParamsSchema,
  type z,
} from "./schemas";

type JsonSchema = z.ZodType;

const jsonContent = (schema: JsonSchema) => ({
  "application/json": {
    schema,
  },
});

const publicReadProblemResponses = {
  "400": {
    description: "The request was malformed or used an unsupported bearer-token location.",
    content: jsonContent(ApiProblemSchema),
  },
  "404": {
    description: "The requested public resource was not found.",
    content: jsonContent(ApiProblemSchema),
  },
  "429": {
    description: "The request exceeded a rate limit.",
    headers: {
      "Retry-After": {
        description: "Delay in seconds before retrying.",
        schema: {
          type: "integer",
          minimum: 1,
        },
      },
    },
    content: jsonContent(ApiProblemSchema),
  },
} satisfies ZodOpenApiResponsesObject;

const scopeDescriptions = Object.fromEntries(apiScopes.map((scope) => [scope, scope])) as Record<
  (typeof apiScopes)[number],
  string
>;
const optionalPublicReadSecurity: Array<Record<string, string[]>> = [
  { bearerAuth: [] },
  { oauth2: ["public:read"] },
  {},
];

export const openApiSource = {
  openapi: "3.1.0",
  info: {
    title: "VRDex Public API",
    version: "0.1.0",
    description:
      "Public API contract for VRDex profile, event, asset, developer, OAuth, and MCP integrations.",
  },
  servers: [
    {
      url: "https://vrdex.app",
      description: "Production",
    },
    {
      url: "http://localhost:3000",
      description: "Local web app",
    },
  ],
  tags: [
    { name: "API", description: "API contract and metadata surfaces." },
    { name: "Profiles", description: "Public profile read surfaces." },
    { name: "Search", description: "Public discovery and search surfaces." },
    { name: "Events", description: "Public event read surfaces." },
    { name: "Worlds", description: "Public world read surfaces." },
    { name: "Claims", description: "Public claim-status read surfaces." },
    { name: "Usage", description: "API usage and rate-limit surfaces." },
  ],
  paths: {
    "/api/v0/openapi.json": {
      get: {
        operationId: "getOpenApiDocument",
        tags: ["API"],
        summary: "Get the OpenAPI document",
        responses: {
          "200": {
            description: "The current OpenAPI document.",
          },
        },
      },
    },
    "/api/v0/search": {
      get: {
        operationId: "searchPublicCatalog",
        tags: ["Search"],
        summary: "Search public profiles, events, and worlds",
        requestParams: {
          query: SearchQueryParamsSchema,
        },
        responses: {
          "200": {
            description: "Public search results.",
            content: jsonContent(PublicSearchResponseSchema),
          },
          ...publicReadProblemResponses,
        },
      },
    },
    "/api/v0/profiles/{slug}": {
      get: {
        operationId: "getPublicProfileBySlug",
        tags: ["Profiles"],
        summary: "Get a public profile",
        requestParams: {
          path: SlugPathParamsSchema,
        },
        responses: {
          "200": {
            description: "The public profile.",
            content: jsonContent(PublicProfileSchema),
          },
          ...publicReadProblemResponses,
        },
      },
    },
    "/api/v0/profiles/{slug}/assets": {
      get: {
        operationId: "getPublicProfileAssets",
        tags: ["Profiles"],
        summary: "Get public profile assets",
        requestParams: {
          path: SlugPathParamsSchema,
        },
        responses: {
          "200": {
            description: "Public profile assets.",
            content: jsonContent(PublicProfileAssetsResponseSchema),
          },
          ...publicReadProblemResponses,
        },
      },
    },
    "/api/v0/profiles/{slug}/logos": {
      get: {
        operationId: "getPublicProfileLogos",
        tags: ["Profiles"],
        summary: "Get public profile logos",
        requestParams: {
          path: SlugPathParamsSchema,
        },
        responses: {
          "200": {
            description: "Public profile logos.",
            content: jsonContent(PublicProfileLogosResponseSchema),
          },
          ...publicReadProblemResponses,
        },
      },
    },
    "/api/v0/people/{slug}": {
      get: {
        operationId: "getPublicPersonProfileBySlug",
        tags: ["Profiles"],
        summary: "Get a public person profile",
        requestParams: {
          path: SlugPathParamsSchema,
        },
        responses: {
          "200": {
            description: "The public person profile.",
            content: jsonContent(PublicProfileSchema),
          },
          ...publicReadProblemResponses,
        },
      },
    },
    "/api/v0/people/{slug}/events": {
      get: {
        operationId: "listPublicPersonEvents",
        tags: ["Profiles", "Events"],
        summary: "List public upcoming events for a person profile",
        requestParams: {
          path: SlugPathParamsSchema,
        },
        responses: {
          "200": {
            description: "Public upcoming events for the person profile.",
            content: jsonContent(PublicEventsResponseSchema),
          },
          ...publicReadProblemResponses,
        },
      },
    },
    "/api/v0/communities/{slug}": {
      get: {
        operationId: "getPublicCommunityProfileBySlug",
        tags: ["Profiles"],
        summary: "Get a public community profile",
        requestParams: {
          path: SlugPathParamsSchema,
        },
        responses: {
          "200": {
            description: "The public community profile.",
            content: jsonContent(PublicProfileSchema),
          },
          ...publicReadProblemResponses,
        },
      },
    },
    "/api/v0/communities/{slug}/events": {
      get: {
        operationId: "listPublicCommunityEvents",
        tags: ["Profiles", "Events"],
        summary: "List public upcoming events hosted by a community profile",
        requestParams: {
          path: SlugPathParamsSchema,
          query: LimitQueryParamsSchema,
        },
        responses: {
          "200": {
            description: "Public upcoming events for the community profile.",
            content: jsonContent(PublicEventsResponseSchema),
          },
          ...publicReadProblemResponses,
        },
      },
    },
    "/api/v0/events/{slug}": {
      get: {
        operationId: "getPublicEventBySlug",
        tags: ["Events"],
        summary: "Get a public event",
        requestParams: {
          path: SlugPathParamsSchema,
        },
        responses: {
          "200": {
            description: "The public event.",
            content: jsonContent(PublicEventSchema),
          },
          ...publicReadProblemResponses,
        },
      },
    },
    "/api/v0/events/upcoming": {
      get: {
        operationId: "listPublicUpcomingEvents",
        tags: ["Events"],
        summary: "List upcoming public events",
        responses: {
          "200": {
            description: "Upcoming public events.",
            content: jsonContent(PublicEventsResponseSchema),
          },
          ...publicReadProblemResponses,
        },
      },
    },
    "/api/v0/worlds/{slug}": {
      get: {
        operationId: "getPublicWorldBySlug",
        tags: ["Worlds"],
        summary: "Get a public world",
        requestParams: {
          path: SlugPathParamsSchema,
        },
        responses: {
          "200": {
            description: "The public world.",
            content: jsonContent(PublicWorldSchema),
          },
          ...publicReadProblemResponses,
        },
      },
    },
    "/api/v0/worlds/active": {
      get: {
        operationId: "listPublicActiveWorlds",
        tags: ["Worlds"],
        summary: "List public worlds hosting upcoming or live events",
        requestParams: {
          query: LimitQueryParamsSchema,
        },
        responses: {
          "200": {
            description: "Active public worlds.",
            content: jsonContent(PublicActiveWorldsResponseSchema),
          },
          ...publicReadProblemResponses,
        },
      },
    },
    "/api/v0/claims/{slug}/status": {
      get: {
        operationId: "getPublicClaimStatus",
        tags: ["Claims"],
        summary: "Get public claim and trust status for a profile",
        requestParams: {
          path: SlugPathParamsSchema,
        },
        responses: {
          "200": {
            description: "Public claim and trust status.",
            content: jsonContent(PublicClaimStatusResponseSchema),
          },
          ...publicReadProblemResponses,
        },
      },
    },
    "/api/v0/usage/rate-limit": {
      get: {
        operationId: "getApiRateLimitUsage",
        tags: ["Usage"],
        summary: "Get API and MCP rate-limit policy information",
        description:
          "Returns the default route-class policy table and the current request's effective API rate-limit window.",
        security: optionalPublicReadSecurity,
        responses: {
          "200": {
            description: "Rate-limit policy and current caller window.",
            content: jsonContent(ApiRateLimitUsageResponseSchema),
          },
          ...publicReadProblemResponses,
        },
      },
    },
  },
  components: {
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT or opaque personal API token",
        description: "Use OAuth access tokens or personal API tokens in the Authorization header.",
      },
      oauth2: {
        type: "oauth2",
        flows: {
          authorizationCode: {
            authorizationUrl: "/oauth/authorize",
            tokenUrl: "/oauth/token",
            scopes: scopeDescriptions,
          },
        },
      },
    },
  },
} satisfies ZodOpenApiObject;

export const openApiDocument = createDocument(openApiSource);

export function getOpenApiDocument() {
  return openApiDocument;
}

export function stringifyOpenApiDocument() {
  return `${JSON.stringify(openApiDocument, null, 2)}\n`;
}
