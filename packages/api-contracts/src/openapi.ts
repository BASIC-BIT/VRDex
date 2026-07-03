import { createDocument, type ZodOpenApiObject, type ZodOpenApiResponsesObject } from "zod-openapi";

import { apiScopes } from "./auth";
import {
  ApiProblemSchema,
  PublicProfileAssetsResponseSchema,
  PublicProfileLogosResponseSchema,
  PublicProfileSchema,
  SlugPathParamsSchema,
  type z,
} from "./schemas";

type JsonSchema = z.ZodType;

const jsonContent = (schema: JsonSchema) => ({
  "application/json": {
    schema,
  },
});

const problemResponses = {
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
    { name: "Profiles", description: "Public profile read surfaces." },
    { name: "API", description: "API contract and metadata surfaces." },
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
          ...problemResponses,
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
          ...problemResponses,
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
          ...problemResponses,
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
            authorizationUrl: "/api/v0/oauth/authorize",
            tokenUrl: "/api/v0/oauth/token",
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
