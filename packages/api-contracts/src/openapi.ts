import { createDocument, type ZodOpenApiObject, type ZodOpenApiResponsesObject } from "zod-openapi";
import { stringify as stringifyYaml } from "yaml";

import { apiScopes } from "./auth";
import {
  ApiSimpleErrorResponseSchema,
  ApiEventCreateRequestSchema,
  ApiEventUpdateRequestSchema,
  ApiEventWriteResponseSchema,
  ApiProblemSchema,
  ApiTokenPathParamsSchema,
  DeveloperCredentialListQueryParamsSchema,
  DeveloperOAuthAppCreateRequestSchema,
  DeveloperOAuthAppCreateResponseSchema,
  DeveloperOAuthAppResponseSchema,
  DeveloperOAuthAppSecretCreateRequestSchema,
  DeveloperOAuthAppSecretCreateResponseSchema,
  DeveloperOAuthAppUpdateRequestSchema,
  DeveloperOAuthAppsResponseSchema,
  DeveloperTokenCreateRequestSchema,
  DeveloperTokenCreateResponseSchema,
  DeveloperTokenResponseSchema,
  DeveloperTokensResponseSchema,
  AssetPathParamsSchema,
  OAuthClientPathParamsSchema,
  ApiMeCommunitiesResponseSchema,
  ApiMeEventsResponseSchema,
  ApiMeInventoryQueryParamsSchema,
  ApiMeProfilesResponseSchema,
  ApiMeResponseSchema,
  ApiProfileAssetUploadErrorResponseSchema,
  ApiProfileAssetUploadIntentCompleteResponseSchema,
  ApiProfileAssetUploadIntentCreateRequestSchema,
  ApiProfileAssetUploadIntentCreateResponseSchema,
  ApiProfileUpdateRequestSchema,
  ApiProfileWriteResponseSchema,
  ApiRateLimitUsageResponseSchema,
  PublicActiveWorldsQueryParamsSchema,
  PublicActiveWorldsResponseSchema,
  PublicClaimStatusResponseSchema,
  PublicEventsResponseSchema,
  PublicEventsListQueryParamsSchema,
  PublicEventSchema,
  PublicProfileAssetsResponseSchema,
  PublicProfileLogosResponseSchema,
  PublicProfileSchema,
  PublicSearchResponseSchema,
  PublicWorldEventsResponseSchema,
  PublicWorldSchema,
  ProfileAssetUploadIntentPathParamsSchema,
  ProfileAssetUploadTokenHeaderSchema,
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

const binaryBodySchema = {
  type: "string",
  format: "binary",
} as const;

const binaryContent = (...mediaTypes: string[]) =>
  Object.fromEntries(mediaTypes.map((mediaType) => [mediaType, { schema: binaryBodySchema }]));

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
const authenticatedPublicReadSecurity: Array<Record<string, string[]>> = [
  { bearerAuth: [] },
  { oauth2: ["public:read"] },
];
const profileReadSecurity: Array<Record<string, string[]>> = [
  { bearerAuth: [] },
  { oauth2: ["profile:read"] },
];
const profileWriteSecurity: Array<Record<string, string[]>> = [
  { bearerAuth: [] },
  { oauth2: ["profile:write"] },
];
const communityReadSecurity: Array<Record<string, string[]>> = [
  { bearerAuth: [] },
  { oauth2: ["community:read"] },
];
const eventsReadSecurity: Array<Record<string, string[]>> = [
  { bearerAuth: [] },
  { oauth2: ["events:read"] },
];
const eventsWriteSecurity: Array<Record<string, string[]>> = [
  { bearerAuth: [] },
  { oauth2: ["events:write"] },
];
const assetsWriteSecurity: Array<Record<string, string[]>> = [
  { bearerAuth: [] },
  { oauth2: ["assets:write"] },
];
const developerReadSecurity: Array<Record<string, string[]>> = [
  { bearerAuth: [] },
  { oauth2: ["developer:read"] },
];
const developerWriteSecurity: Array<Record<string, string[]>> = [
  { bearerAuth: [] },
  { oauth2: ["developer:write"] },
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
    { name: "Assets", description: "Public and owner-managed profile asset surfaces." },
    { name: "Search", description: "Public discovery and search surfaces." },
    { name: "Events", description: "Public event read surfaces." },
    { name: "Worlds", description: "Public world read surfaces." },
    { name: "Claims", description: "Public claim-status read surfaces." },
    { name: "Usage", description: "API usage and rate-limit surfaces." },
    { name: "Me", description: "Authenticated caller introspection surfaces." },
    { name: "Developer", description: "Authenticated developer credential-management surfaces." },
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
    "/api/v0/openapi.yaml": {
      get: {
        operationId: "getOpenApiYamlDocument",
        tags: ["API"],
        summary: "Get the OpenAPI YAML document",
        responses: {
          "200": {
            description: "The current OpenAPI document serialized as YAML.",
            content: {
              "application/yaml": {
                schema: {
                  type: "string",
                },
              },
            },
          },
        },
      },
    },
    "/api/v0/me": {
      get: {
        operationId: "getCurrentApiCaller",
        tags: ["Me"],
        summary: "Get the current API caller",
        description: "Returns metadata for the validated bearer credential used on this request.",
        security: authenticatedPublicReadSecurity,
        responses: {
          "200": {
            description: "Current authenticated API caller.",
            content: jsonContent(ApiMeResponseSchema),
          },
          "401": {
            description: "Bearer authentication is required or invalid.",
            content: jsonContent(ApiProblemSchema),
          },
          "403": {
            description: "The bearer credential does not include the required scope.",
            content: jsonContent(ApiProblemSchema),
          },
          "429": publicReadProblemResponses["429"],
        },
      },
    },
    "/api/v0/me/profiles": {
      get: {
        operationId: "listCurrentApiUserProfiles",
        tags: ["Me"],
        summary: "List the current user's profiles",
        description:
          "Returns compact profile inventory for a bearer credential with user authority and profile:read scope.",
        security: profileReadSecurity,
        requestParams: {
          query: ApiMeInventoryQueryParamsSchema,
        },
        responses: {
          "200": {
            description: "Current user's owned profiles.",
            content: jsonContent(ApiMeProfilesResponseSchema),
          },
          "400": publicReadProblemResponses["400"],
          "401": {
            description: "Bearer authentication is required or invalid.",
            content: jsonContent(ApiProblemSchema),
          },
          "403": {
            description: "The bearer credential lacks profile:read scope or user authority.",
            content: jsonContent(ApiProblemSchema),
          },
          "429": publicReadProblemResponses["429"],
        },
      },
    },
    "/api/v0/me/communities": {
      get: {
        operationId: "listCurrentApiUserCommunities",
        tags: ["Me"],
        summary: "List the current user's communities",
        description:
          "Returns compact community profile inventory for a bearer credential with user authority and community:read scope.",
        security: communityReadSecurity,
        requestParams: {
          query: ApiMeInventoryQueryParamsSchema,
        },
        responses: {
          "200": {
            description: "Current user's owned community profiles.",
            content: jsonContent(ApiMeCommunitiesResponseSchema),
          },
          "400": publicReadProblemResponses["400"],
          "401": {
            description: "Bearer authentication is required or invalid.",
            content: jsonContent(ApiProblemSchema),
          },
          "403": {
            description: "The bearer credential lacks community:read scope or user authority.",
            content: jsonContent(ApiProblemSchema),
          },
          "429": publicReadProblemResponses["429"],
        },
      },
    },
    "/api/v0/me/events": {
      get: {
        operationId: "listCurrentApiUserEvents",
        tags: ["Me", "Events"],
        summary: "List the current user's community-managed events",
        description:
          "Returns compact event inventory for communities owned by a bearer credential with user authority and events:read scope.",
        security: eventsReadSecurity,
        requestParams: {
          query: ApiMeInventoryQueryParamsSchema,
        },
        responses: {
          "200": {
            description: "Current user's community-managed events.",
            content: jsonContent(ApiMeEventsResponseSchema),
          },
          "400": publicReadProblemResponses["400"],
          "401": {
            description: "Bearer authentication is required or invalid.",
            content: jsonContent(ApiProblemSchema),
          },
          "403": {
            description: "The bearer credential lacks events:read scope or user authority.",
            content: jsonContent(ApiProblemSchema),
          },
          "429": publicReadProblemResponses["429"],
        },
      },
    },
    "/api/v0/developer/tokens": {
      get: {
        operationId: "listCurrentDeveloperApiTokens",
        tags: ["Developer"],
        summary: "List current developer API tokens",
        description:
          "Returns user-owned personal API token metadata for a bearer credential with user authority and developer:read scope.",
        security: developerReadSecurity,
        requestParams: {
          query: DeveloperCredentialListQueryParamsSchema,
        },
        responses: {
          "200": {
            description: "Current user's personal API tokens.",
            content: jsonContent(DeveloperTokensResponseSchema),
          },
          "400": publicReadProblemResponses["400"],
          "401": {
            description: "Bearer authentication is required or invalid.",
            content: jsonContent(ApiProblemSchema),
          },
          "403": {
            description: "The bearer credential lacks developer:read scope or user authority.",
            content: jsonContent(ApiProblemSchema),
          },
          "429": publicReadProblemResponses["429"],
        },
      },
      post: {
        operationId: "createCurrentDeveloperApiToken",
        tags: ["Developer"],
        summary: "Create a current developer API token",
        description:
          "Creates a user-owned personal API token for a bearer credential with user authority and developer:write scope. The raw token value is returned once.",
        security: developerWriteSecurity,
        requestBody: {
          required: true,
          content: jsonContent(DeveloperTokenCreateRequestSchema),
        },
        responses: {
          "200": {
            description: "Created personal API token and one-time raw token value.",
            content: jsonContent(DeveloperTokenCreateResponseSchema),
          },
          "400": {
            description: "The token creation request was malformed.",
            content: jsonContent(ApiProblemSchema),
          },
          "401": {
            description: "Bearer authentication is required or invalid.",
            content: jsonContent(ApiProblemSchema),
          },
          "403": {
            description: "The bearer credential lacks developer:write scope or user authority.",
            content: jsonContent(ApiProblemSchema),
          },
          "429": publicReadProblemResponses["429"],
        },
      },
    },
    "/api/v0/developer/tokens/{tokenId}": {
      delete: {
        operationId: "revokeCurrentDeveloperApiToken",
        tags: ["Developer"],
        summary: "Revoke a current developer API token",
        description:
          "Revokes a user-owned personal API token for a bearer credential with user authority and developer:write scope.",
        security: developerWriteSecurity,
        requestParams: {
          path: ApiTokenPathParamsSchema,
        },
        responses: {
          "200": {
            description: "Revoked or already-revoked personal API token metadata.",
            content: jsonContent(DeveloperTokenResponseSchema),
          },
          "400": publicReadProblemResponses["400"],
          "401": {
            description: "Bearer authentication is required or invalid.",
            content: jsonContent(ApiProblemSchema),
          },
          "403": {
            description: "The bearer credential lacks developer:write scope or user authority.",
            content: jsonContent(ApiProblemSchema),
          },
          "404": {
            description: "The token was not found for the current user.",
            content: jsonContent(ApiProblemSchema),
          },
          "429": publicReadProblemResponses["429"],
        },
      },
    },
    "/api/v0/developer/oauth-apps": {
      get: {
        operationId: "listCurrentDeveloperOAuthApps",
        tags: ["Developer"],
        summary: "List current developer OAuth apps",
        description:
          "Returns user-owned and community-owned OAuth application metadata for a bearer credential with user authority and developer:read scope.",
        security: developerReadSecurity,
        requestParams: {
          query: DeveloperCredentialListQueryParamsSchema,
        },
        responses: {
          "200": {
            description: "Current user's OAuth applications, including apps for communities they own.",
            content: jsonContent(DeveloperOAuthAppsResponseSchema),
          },
          "400": publicReadProblemResponses["400"],
          "401": {
            description: "Bearer authentication is required or invalid.",
            content: jsonContent(ApiProblemSchema),
          },
          "403": {
            description: "The bearer credential lacks developer:read scope or user authority.",
            content: jsonContent(ApiProblemSchema),
          },
          "429": publicReadProblemResponses["429"],
        },
      },
      post: {
        operationId: "createCurrentDeveloperOAuthApp",
        tags: ["Developer"],
        summary: "Create a current developer OAuth app",
        description:
          "Creates a user-owned OAuth application, or a community-owned OAuth application when ownerCommunitySlug is supplied, for a bearer credential with user authority and developer:write scope. Confidential clients receive a one-time client secret value.",
        security: developerWriteSecurity,
        requestBody: {
          required: true,
          content: jsonContent(DeveloperOAuthAppCreateRequestSchema),
        },
        responses: {
          "200": {
            description: "Created OAuth application and optional one-time client secret value.",
            content: jsonContent(DeveloperOAuthAppCreateResponseSchema),
          },
          "400": {
            description: "The OAuth app creation request was malformed.",
            content: jsonContent(ApiProblemSchema),
          },
          "401": {
            description: "Bearer authentication is required or invalid.",
            content: jsonContent(ApiProblemSchema),
          },
          "403": {
            description: "The bearer credential lacks developer:write scope or user authority, or the user does not own the requested community.",
            content: jsonContent(ApiProblemSchema),
          },
          "404": {
            description: "The requested owner community profile was not found.",
            content: jsonContent(ApiProblemSchema),
          },
          "429": publicReadProblemResponses["429"],
        },
      },
    },
    "/api/v0/developer/oauth-apps/{clientId}": {
      patch: {
        operationId: "updateCurrentDeveloperOAuthApp",
        tags: ["Developer"],
        summary: "Update a current developer OAuth app",
        description:
          "Updates editable metadata, redirect URIs, allowed grants, and allowed scopes for a user-owned or community-owned OAuth application.",
        security: developerWriteSecurity,
        requestParams: {
          path: OAuthClientPathParamsSchema,
        },
        requestBody: {
          required: true,
          content: jsonContent(DeveloperOAuthAppUpdateRequestSchema),
        },
        responses: {
          "200": {
            description: "Updated OAuth application metadata.",
            content: jsonContent(DeveloperOAuthAppResponseSchema),
          },
          "400": {
            description: "The OAuth app update request was malformed.",
            content: jsonContent(ApiProblemSchema),
          },
          "401": {
            description: "Bearer authentication is required or invalid.",
            content: jsonContent(ApiProblemSchema),
          },
          "403": {
            description: "The bearer credential lacks developer:write scope or user authority.",
            content: jsonContent(ApiProblemSchema),
          },
          "404": {
            description: "The OAuth application was not found for the current user or their owned communities.",
            content: jsonContent(ApiProblemSchema),
          },
          "429": publicReadProblemResponses["429"],
        },
      },
      delete: {
        operationId: "revokeCurrentDeveloperOAuthApp",
        tags: ["Developer"],
        summary: "Revoke a current developer OAuth app",
        description:
          "Revokes a user-owned or community-owned OAuth application and its active secrets for a bearer credential with user authority and developer:write scope.",
        security: developerWriteSecurity,
        requestParams: {
          path: OAuthClientPathParamsSchema,
        },
        responses: {
          "200": {
            description: "Revoked or already-revoked OAuth application metadata.",
            content: jsonContent(DeveloperOAuthAppResponseSchema),
          },
          "400": publicReadProblemResponses["400"],
          "401": {
            description: "Bearer authentication is required or invalid.",
            content: jsonContent(ApiProblemSchema),
          },
          "403": {
            description: "The bearer credential lacks developer:write scope or user authority.",
            content: jsonContent(ApiProblemSchema),
          },
          "404": {
            description: "The OAuth application was not found for the current user or their owned communities.",
            content: jsonContent(ApiProblemSchema),
          },
          "429": publicReadProblemResponses["429"],
        },
      },
    },
    "/api/v0/developer/oauth-apps/{clientId}/secrets": {
      post: {
        operationId: "createCurrentDeveloperOAuthAppSecret",
        tags: ["Developer"],
        summary: "Create a current developer OAuth app secret",
        description:
          "Creates an additional client secret for a user-owned or community-owned confidential OAuth application. The raw client secret value is returned once.",
        security: developerWriteSecurity,
        requestParams: {
          path: OAuthClientPathParamsSchema,
        },
        requestBody: {
          required: true,
          content: jsonContent(DeveloperOAuthAppSecretCreateRequestSchema),
        },
        responses: {
          "200": {
            description: "Updated OAuth application and one-time client secret value.",
            content: jsonContent(DeveloperOAuthAppSecretCreateResponseSchema),
          },
          "400": {
            description: "The OAuth app secret creation request was malformed or the app is public.",
            content: jsonContent(ApiProblemSchema),
          },
          "401": {
            description: "Bearer authentication is required or invalid.",
            content: jsonContent(ApiProblemSchema),
          },
          "403": {
            description: "The bearer credential lacks developer:write scope or user authority.",
            content: jsonContent(ApiProblemSchema),
          },
          "404": {
            description: "The OAuth application was not found for the current user or their owned communities.",
            content: jsonContent(ApiProblemSchema),
          },
          "429": publicReadProblemResponses["429"],
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
      patch: {
        operationId: "updateCurrentUserProfile",
        tags: ["Profiles"],
        summary: "Update a current user's profile",
        description:
          "Updates owner-editable metadata for a claimed profile owned by a bearer credential with user authority and profile:write scope.",
        security: profileWriteSecurity,
        requestParams: {
          path: SlugPathParamsSchema,
        },
        requestBody: {
          required: true,
          content: jsonContent(ApiProfileUpdateRequestSchema),
        },
        responses: {
          "200": {
            description: "Updated profile identifiers and public path.",
            content: jsonContent(ApiProfileWriteResponseSchema),
          },
          "400": {
            description: "The profile update request was malformed.",
            content: jsonContent(ApiProblemSchema),
          },
          "401": {
            description: "Bearer authentication is required or invalid.",
            content: jsonContent(ApiProblemSchema),
          },
          "403": {
            description:
              "The bearer credential lacks profile:write scope, user authority, ownership, or claimed-owner field permission.",
            content: jsonContent(ApiProblemSchema),
          },
          "404": {
            description: "The profile was not found.",
            content: jsonContent(ApiProblemSchema),
          },
          "429": publicReadProblemResponses["429"],
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
    "/api/v0/profiles/{slug}/assets/{assetId}/file": {
      get: {
        operationId: "downloadPublicProfileAssetFile",
        tags: ["Profiles", "Assets"],
        summary: "Download a public profile asset file",
        requestParams: {
          path: AssetPathParamsSchema,
        },
        responses: {
          "200": {
            description: "The stored public profile asset file.",
            content: binaryContent("image/png", "image/jpeg", "image/webp", "image/svg+xml"),
          },
          "404": {
            description: "The profile asset or stored object was not found.",
            content: jsonContent(ApiSimpleErrorResponseSchema),
          },
          "501": {
            description: "Profile asset storage is not configured for this deployment.",
            content: jsonContent(ApiSimpleErrorResponseSchema),
          },
          "400": publicReadProblemResponses["400"],
          "429": publicReadProblemResponses["429"],
        },
      },
    },
    "/api/v0/profiles/{slug}/assets/upload-intent": {
      post: {
        operationId: "createCurrentUserProfileAssetUploadIntent",
        tags: ["Profiles", "Assets"],
        summary: "Create a profile asset upload intent",
        description:
          "Creates a one-time upload intent for a claimed profile owned by a bearer credential with user authority and assets:write scope. Complete the upload by posting the image file or source import to the returned uploadUrl with the returned upload-token header.",
        security: assetsWriteSecurity,
        requestParams: {
          path: SlugPathParamsSchema,
        },
        requestBody: {
          required: true,
          content: jsonContent(ApiProfileAssetUploadIntentCreateRequestSchema),
        },
        responses: {
          "200": {
            description: "One-time upload target for profile media.",
            content: jsonContent(ApiProfileAssetUploadIntentCreateResponseSchema),
          },
          "400": {
            description: "The upload-intent request was malformed.",
            content: jsonContent(ApiProblemSchema),
          },
          "401": {
            description: "Bearer authentication is required or invalid.",
            content: jsonContent(ApiProblemSchema),
          },
          "403": {
            description: "The bearer credential lacks assets:write scope, user authority, ownership, or a claimed profile.",
            content: jsonContent(ApiProblemSchema),
          },
          "404": {
            description: "The profile was not found.",
            content: jsonContent(ApiProblemSchema),
          },
          "429": publicReadProblemResponses["429"],
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
    "/api/v0/profiles/{slug}/logos.zip": {
      get: {
        operationId: "downloadPublicProfileLogosZip",
        tags: ["Profiles", "Assets"],
        summary: "Download public profile logos as a ZIP",
        requestParams: {
          path: SlugPathParamsSchema,
        },
        responses: {
          "200": {
            description: "A ZIP archive containing public profile logos.",
            content: binaryContent("application/zip"),
          },
          "404": {
            description: "The profile, logos, or stored logo objects were not found.",
            content: jsonContent(ApiSimpleErrorResponseSchema),
          },
          "501": {
            description: "Profile asset storage is not configured for this deployment.",
            content: jsonContent(ApiSimpleErrorResponseSchema),
          },
          "400": publicReadProblemResponses["400"],
          "429": publicReadProblemResponses["429"],
        },
      },
    },
    "/api/v0/profile-assets/upload-intents/{intentId}": {
      post: {
        operationId: "completeProfileAssetUploadIntent",
        tags: ["Assets"],
        summary: "Complete a profile asset upload intent",
        description:
          "Uploads the image file for a direct-upload intent, or triggers the server-side source import for a sourceUrl intent. Send the one-time x-vrdex-upload-token value returned by the upload-intent creation endpoint. Do not send bearer credentials on this transport.",
        requestParams: {
          path: ProfileAssetUploadIntentPathParamsSchema,
          header: ProfileAssetUploadTokenHeaderSchema,
        },
        responses: {
          "200": {
            description: "Completed profile media upload result.",
            content: jsonContent(ApiProfileAssetUploadIntentCompleteResponseSchema),
          },
          "400": {
            description: "The upload body or source import was invalid.",
            content: jsonContent(ApiProfileAssetUploadErrorResponseSchema),
          },
          "403": {
            description: "The one-time upload token was missing or invalid.",
            content: jsonContent(ApiProfileAssetUploadErrorResponseSchema),
          },
          "404": {
            description: "The upload intent was not found or has expired.",
            content: jsonContent(ApiProfileAssetUploadErrorResponseSchema),
          },
          "501": {
            description: "Profile asset storage is not configured for this deployment.",
            content: jsonContent(ApiProfileAssetUploadErrorResponseSchema),
          },
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
          query: PublicEventsListQueryParamsSchema,
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
      patch: {
        operationId: "updateCurrentUserCommunityEvent",
        tags: ["Events"],
        summary: "Update a current user's community event",
        description:
          "Updates a public event attached to a community profile owned by a bearer credential with user authority and events:write scope.",
        security: eventsWriteSecurity,
        requestParams: {
          path: SlugPathParamsSchema,
        },
        requestBody: {
          required: true,
          content: jsonContent(ApiEventUpdateRequestSchema),
        },
        responses: {
          "200": {
            description: "Updated event identifiers and paths.",
            content: jsonContent(ApiEventWriteResponseSchema),
          },
          "400": {
            description: "The event update request was malformed.",
            content: jsonContent(ApiProblemSchema),
          },
          "401": {
            description: "Bearer authentication is required or invalid.",
            content: jsonContent(ApiProblemSchema),
          },
          "403": {
            description: "The bearer credential lacks events:write scope, user authority, or ownership of the target event/community.",
            content: jsonContent(ApiProblemSchema),
          },
          "404": {
            description: "The event was not found.",
            content: jsonContent(ApiProblemSchema),
          },
          "429": publicReadProblemResponses["429"],
        },
      },
    },
    "/api/v0/events": {
      post: {
        operationId: "createCurrentUserCommunityEvent",
        tags: ["Events"],
        summary: "Create a current user's community event",
        description:
          "Creates a public event attached to a community profile owned by a bearer credential with user authority and events:write scope.",
        security: eventsWriteSecurity,
        requestBody: {
          required: true,
          content: jsonContent(ApiEventCreateRequestSchema),
        },
        responses: {
          "200": {
            description: "Created event identifiers and paths.",
            content: jsonContent(ApiEventWriteResponseSchema),
          },
          "400": {
            description: "The event creation request was malformed.",
            content: jsonContent(ApiProblemSchema),
          },
          "401": {
            description: "Bearer authentication is required or invalid.",
            content: jsonContent(ApiProblemSchema),
          },
          "403": {
            description: "The bearer credential lacks events:write scope, user authority, or ownership of the target community.",
            content: jsonContent(ApiProblemSchema),
          },
          "429": publicReadProblemResponses["429"],
        },
      },
    },
    "/api/v0/events/upcoming": {
      get: {
        operationId: "listPublicUpcomingEvents",
        tags: ["Events"],
        summary: "List upcoming public events",
        requestParams: {
          query: PublicEventsListQueryParamsSchema,
        },
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
    "/api/v0/worlds/{slug}/events": {
      get: {
        operationId: "getPublicWorldEventsBySlug",
        tags: ["Worlds"],
        summary: "List public events for a world",
        requestParams: {
          path: SlugPathParamsSchema,
        },
        responses: {
          "200": {
            description: "Upcoming and recent public events linked to the world.",
            content: jsonContent(PublicWorldEventsResponseSchema),
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
          query: PublicActiveWorldsQueryParamsSchema,
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

export function stringifyOpenApiYamlDocument() {
  return stringifyYaml(openApiDocument, { lineWidth: 0 });
}
