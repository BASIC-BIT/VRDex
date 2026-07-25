import { v } from "convex/values";

import type { Doc } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { getCurrentUser, requireCurrentUser } from "./accounts";
import {
  apiRouteClassValidator,
  apiScopeValidator,
  hasRequiredApiScopes,
  timingSafeEqualString,
  type ApiRouteClass,
  type ApiScope,
} from "./_apiTokens";
import { userOwnsProfile } from "./_profileOwnership";
import { getProfileBySlug, validateProfileSlug } from "./_profileSlugs";
import {
  normalizeDynamicMcpScopes,
  normalizeOAuthAccessTokenId,
  normalizeOAuthAuthorizationCodeHash,
  normalizeOAuthApplicationDescription,
  normalizeOAuthApplicationName,
  normalizeOAuthCodeChallenge,
  normalizeOAuthCodeChallengeMethod,
  normalizeOAuthClientId,
  normalizeOAuthClientMetadataDocumentUrl,
  normalizeOwnedOAuthClientId,
  normalizeOAuthClientSecretHash,
  normalizeOAuthClientSecretPrefix,
  normalizeOAuthClientType,
  normalizeOAuthContactValues,
  normalizeOAuthGrantTypes,
  normalizeOAuthOptionalUrl,
  normalizeOAuthRedirectUris,
  normalizeOAuthRedirectHost,
  normalizeOAuthResponseTypes,
  normalizeOAuthTokenEndpointAuthMethod,
  normalizeOAuthRevokeReason,
  normalizeOAuthResourceUri,
  normalizeOAuthRefreshTokenHash,
  normalizeOAuthScopes,
  normalizeOAuthSoftwareValue,
  normalizeOAuthTokenExpiry,
  oauthRedirectUriMatches,
  oauthAccessTokenValidationEventMetadata,
  oauthClientSecretHashVersion,
  oauthCodeChallengeMethodValidator,
  oauthGrantTypeValidator,
  oauthResponseTypeValidator,
  oauthTokenEndpointAuthMethodValidator,
  validateOAuthAccessTokenRecord,
  type OAuthGrantType,
  type OAuthResponseType,
  type OAuthTokenEndpointAuthMethod,
  type OAuthAccessTokenValidationResult,
  type OAuthAccessTokenValidationResultLabel,
} from "./_oauth";
import {
  normalizeOAuthConsentTransactionHash,
  oauthConsentTransactionDisposition,
} from "./_oauthConsentTransactions";
import {
  requirePreviewClientCredentialsBridge,
  requirePreviewPersistenceBridge,
} from "./_previewPersistence";

function boundedLimit(value: number | undefined, fallback: number, max: number) {
  if (value === undefined || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(1, Math.min(Math.floor(value), max));
}

function normalizeOAuthClientSecretLabel(value: string | undefined) {
  const label = value?.trim().replace(/\s+/g, " ");

  if (!label) {
    return undefined;
  }

  if (label.length > 80) {
    throw new Error("OAuth client secret label must be 80 characters or fewer.");
  }

  return label;
}

function toApplicationSummary(
  application: Doc<"oauthApplications">,
  activeSecrets: Doc<"oauthApplicationSecrets">[],
) {
  return {
    id: application._id,
    clientId: application.clientId,
    ownerKind: application.ownerKind,
    ownerUserId: application.ownerUserId,
    ownerCommunityProfileId: application.ownerCommunityProfileId,
    clientType: application.clientType,
    displayName: application.displayName,
    description: application.description,
    logoUrl: application.logoUrl,
    docsUrl: application.docsUrl,
    privacyUrl: application.privacyUrl,
    termsUrl: application.termsUrl,
    redirectUris: application.redirectUris,
    allowedGrants: application.allowedGrants,
    allowedScopes: application.allowedScopes,
    status: application.status,
    trustTier: application.trustTier,
    createdAt: application.createdAt,
    updatedAt: application.updatedAt,
    lastUsedAt: application.lastUsedAt,
    reviewedAt: application.reviewedAt,
    revokedAt: application.revokedAt,
    revokeReason: application.revokeReason,
    activeSecretPrefixes: activeSecrets.map((secret) => secret.secretPrefix),
  };
}

function toDynamicMcpClientSummary(dynamicClient: Doc<"oauthDynamicClients">) {
  return {
    id: dynamicClient._id,
    clientId: dynamicClient.clientId,
    clientName: dynamicClient.clientName,
    clientUri: dynamicClient.clientUri,
    logoUri: dynamicClient.logoUri,
    redirectUris: dynamicClient.redirectUris,
    grantTypes: dynamicClient.grantTypes,
    responseTypes: dynamicClient.responseTypes,
    tokenEndpointAuthMethod: dynamicClient.tokenEndpointAuthMethod,
    contacts: dynamicClient.contacts,
    softwareId: dynamicClient.softwareId,
    softwareVersion: dynamicClient.softwareVersion,
    allowedScopes: dynamicClient.allowedScopes,
    resource: dynamicClient.resource,
    status: dynamicClient.status,
    createdAt: dynamicClient.createdAt,
    updatedAt: dynamicClient.updatedAt,
    lastUsedAt: dynamicClient.lastUsedAt,
    promotedApplicationId: dynamicClient.promotedApplicationId,
  };
}

function toAuthorizationClientSummary(
  client:
    | { kind: "application"; record: Doc<"oauthApplications"> }
    | { kind: "dynamic_client"; record: Doc<"oauthDynamicClients"> },
  args: {
    redirectUri: string;
    requestedScopes: ReturnType<typeof normalizeOAuthScopes>;
    resource: string;
  },
) {
  if (client.kind === "application") {
    return {
      ok: true as const,
      clientKind: client.kind,
      applicationId: client.record._id,
      clientId: client.record.clientId,
      displayName: client.record.displayName,
      description: client.record.description,
      docsUrl: client.record.docsUrl,
      privacyUrl: client.record.privacyUrl,
      redirectUri: args.redirectUri,
      resource: args.resource,
      requestedScopes: args.requestedScopes,
    };
  }

  return {
    ok: true as const,
    clientKind: client.kind,
    dynamicClientId: client.record._id,
    clientId: client.record.clientId,
    displayName: client.record.clientName,
    clientUri: client.record.clientUri,
    logoUri: client.record.logoUri,
    redirectUri: args.redirectUri,
    resource: args.resource,
    requestedScopes: args.requestedScopes,
  };
}

async function activeSecretsForApplication(
  ctx: QueryCtx | MutationCtx,
  applicationId: Doc<"oauthApplications">["_id"],
) {
  return await ctx.db
    .query("oauthApplicationSecrets")
    .withIndex("by_applicationId_status_createdAt", (index) =>
      index.eq("applicationId", applicationId).eq("status", "active"),
    )
    .collect();
}

async function applicationSummaries(
  ctx: QueryCtx | MutationCtx,
  applications: Doc<"oauthApplications">[],
) {
  const summaries: ReturnType<typeof toApplicationSummary>[] = [];

  for (const application of applications) {
    const activeSecrets = await activeSecretsForApplication(ctx, application._id);

    summaries.push(toApplicationSummary(application, activeSecrets));
  }

  return summaries;
}

async function validatedActiveApplicationSecret(
  ctx: MutationCtx,
  args: {
    application: Doc<"oauthApplications">;
    clientId: string;
    secretPrefix?: string;
    verifierHash?: string;
  },
) {
  if (args.secretPrefix === undefined || args.verifierHash === undefined) {
    return null;
  }

  const secretPrefix = normalizeOAuthClientSecretPrefix(args.secretPrefix);
  const verifierHash = normalizeOAuthClientSecretHash(args.verifierHash);
  const secret = await ctx.db
    .query("oauthApplicationSecrets")
    .withIndex("by_secretPrefix", (index) => index.eq("secretPrefix", secretPrefix))
    .unique();

  if (
    secret === null ||
    secret.applicationId !== args.application._id ||
    secret.clientId !== args.clientId ||
    secret.status !== "active" ||
    !timingSafeEqualString(secret.verifierHash, verifierHash)
  ) {
    return null;
  }

  return secret;
}

async function communityProfilesOwnedByUser(
  ctx: QueryCtx | MutationCtx,
  ownerUserId: Doc<"users">["_id"],
) {
  const owners = await ctx.db
    .query("profileOwners")
    .withIndex("by_userId_state", (index) => index.eq("userId", ownerUserId).eq("state", "active"))
    .collect();
  const profiles = await Promise.all(owners.map((owner) => ctx.db.get(owner.profileId)));

  return profiles.filter(
    (profile): profile is Doc<"profiles"> =>
      profile !== null &&
      profile.profileType === "community" &&
      profile.claimState !== "unclaimed",
  );
}

async function listDeveloperApplicationSummaries(
  ctx: QueryCtx,
  args: {
    includeRevoked?: boolean;
    limit?: number;
    ownerUserId: Doc<"users">["_id"];
  },
) {
  const limit = boundedLimit(args.limit, 50, 100);
  const visibleDirectApplications =
    args.includeRevoked === true
      ? await ctx.db
          .query("oauthApplications")
          .withIndex("by_ownerKind_ownerUserId_createdAt", (index) =>
            index.eq("ownerKind", "user").eq("ownerUserId", args.ownerUserId),
          )
          .order("desc")
          .take(limit)
      : await ctx.db
          .query("oauthApplications")
          .withIndex("by_ownerKind_ownerUserId_status_createdAt", (index) =>
            index.eq("ownerKind", "user").eq("ownerUserId", args.ownerUserId).eq("status", "active"),
          )
          .order("desc")
          .take(limit);
  const ownedCommunities = await communityProfilesOwnedByUser(ctx, args.ownerUserId);
  const communityApplications: Doc<"oauthApplications">[] = [];

  for (const community of ownedCommunities) {
    const applications =
      args.includeRevoked === true
        ? await ctx.db
            .query("oauthApplications")
            .withIndex("by_ownerCommunityProfileId_createdAt", (index) =>
              index.eq("ownerCommunityProfileId", community._id),
            )
            .order("desc")
            .take(limit)
        : await ctx.db
            .query("oauthApplications")
            .withIndex("by_ownerCommunityProfileId_status_createdAt", (index) =>
              index.eq("ownerCommunityProfileId", community._id).eq("status", "active"),
            )
            .order("desc")
            .take(limit);

    communityApplications.push(...applications);
  }

  const seenApplicationIds = new Set<Doc<"oauthApplications">["_id"]>();
  const visibleApplications = [...visibleDirectApplications, ...communityApplications]
    .filter((application) => {
      if (seenApplicationIds.has(application._id)) {
        return false;
      }

      seenApplicationIds.add(application._id);
      return true;
    })
    .sort((first, second) => second.createdAt - first.createdAt || second.updatedAt - first.updatedAt)
    .slice(0, limit);

  return await applicationSummaries(ctx, visibleApplications);
}

async function requireOwnedCommunityProfileBySlug(
  ctx: QueryCtx | MutationCtx,
  args: {
    ownerCommunitySlug: string;
    ownerUserId: Doc<"users">["_id"];
  },
) {
  const validation = validateProfileSlug(args.ownerCommunitySlug);

  if (!validation.ok) {
    throw new Error("Community slug is invalid.");
  }

  const profile = await getProfileBySlug(ctx.db, validation.slug);

  if (profile === null || profile.profileType !== "community") {
    throw new Error("Community profile was not found.");
  }

  if (profile.claimState === "unclaimed") {
    throw new Error("Only claimed community profiles can own OAuth apps.");
  }

  if (!(await userOwnsProfile(ctx.db, profile._id, args.ownerUserId))) {
    throw new Error("Only the community owner can manage community OAuth apps.");
  }

  return profile;
}

async function canManageApplication(
  ctx: QueryCtx | MutationCtx,
  application: Doc<"oauthApplications">,
  ownerUserId: Doc<"users">["_id"],
) {
  if (application.ownerKind === "user") {
    return application.ownerUserId === ownerUserId;
  }

  if (application.ownerCommunityProfileId === undefined) {
    return false;
  }

  return await userOwnsProfile(ctx.db, application.ownerCommunityProfileId, ownerUserId);
}

async function recordOAuthClientEvent(
  ctx: MutationCtx,
  args: {
    application?: Doc<"oauthApplications">;
    dynamicClient?: Doc<"oauthDynamicClients">;
    clientId?: string;
    accessTokenId?: string;
    secretPrefix?: string;
    eventType: Doc<"oauthClientEvents">["eventType"];
    result: Doc<"oauthClientEvents">["result"];
    routeClass?: Doc<"oauthClientEvents">["routeClass"];
    validationResult?: OAuthAccessTokenValidationResultLabel;
    now: number;
  },
) {
  const clientId = args.application?.clientId ?? args.dynamicClient?.clientId ?? args.clientId;

  await ctx.db.insert("oauthClientEvents", {
    ...(args.application === undefined ? {} : { applicationId: args.application._id }),
    ...(args.dynamicClient === undefined ? {} : { dynamicClientId: args.dynamicClient._id }),
    ...(clientId === undefined ? {} : { clientId }),
    ...(args.accessTokenId === undefined ? {} : { accessTokenId: args.accessTokenId }),
    ...(args.secretPrefix === undefined ? {} : { secretPrefix: args.secretPrefix }),
    ...(args.application === undefined ? {} : { ownerKind: args.application.ownerKind }),
    ...(args.application === undefined ? {} : { ownerUserId: args.application.ownerUserId }),
    ...(args.application?.ownerCommunityProfileId === undefined
      ? {}
      : { ownerCommunityProfileId: args.application.ownerCommunityProfileId }),
    routeClass: args.routeClass ?? "developer_credential_management",
    eventType: args.eventType,
    result: args.result,
    ...(args.validationResult === undefined ? {} : { validationResult: args.validationResult }),
    createdAt: args.now,
  });
}

async function revokeManageableApplication(
  ctx: MutationCtx,
  args: {
    application: Doc<"oauthApplications"> | null;
    ownerUserId: Doc<"users">["_id"];
    reason?: string;
  },
) {
  const application = args.application;

  if (application === null || !(await canManageApplication(ctx, application, args.ownerUserId))) {
    return { ok: false as const, reason: "not_found" as const };
  }

  if (application.status === "revoked") {
    return { ok: true as const, application: toApplicationSummary(application, []) };
  }

  const now = Date.now();
  const revokeReason = normalizeOAuthRevokeReason(args.reason);
  const patch = {
    status: "revoked" as const,
    revokedAt: now,
    revokedByUserId: args.ownerUserId,
    updatedAt: now,
    ...(revokeReason === undefined ? {} : { revokeReason }),
  };
  const activeSecrets = await activeSecretsForApplication(ctx, application._id);

  await ctx.db.patch(application._id, patch);

  for (const secret of activeSecrets) {
    await ctx.db.patch(secret._id, {
      status: "revoked",
      revokedAt: now,
      revokedByUserId: args.ownerUserId,
      updatedAt: now,
    });

    await recordOAuthClientEvent(ctx, {
      application,
      secretPrefix: secret.secretPrefix,
      eventType: "secret_revoked",
      result: "accepted",
      now,
    });
  }

  const updatedApplication = { ...application, ...patch };

  await recordOAuthClientEvent(ctx, {
    application: updatedApplication,
    eventType: "application_revoked",
    result: "accepted",
    now,
  });

  return { ok: true as const, application: toApplicationSummary(updatedApplication, []) };
}

async function resolvePublicAuthorizationClient(
  ctx: QueryCtx | MutationCtx,
  args: {
    clientId: string;
    redirectUri: string;
    requestedScopes?: string[];
    resource: string;
  },
) {
  const clientId = normalizeOAuthClientId(args.clientId);
  const redirectUri = normalizeOAuthRedirectUris([args.redirectUri])[0];
  const requestedScopes = normalizeOAuthScopes(args.requestedScopes);
  const resource = normalizeOAuthResourceUri(args.resource);
  const redirectDiagnostics = (registeredRedirectUris: readonly string[]) => registeredRedirectUris.map(
    (registeredRedirectUri) => {
      const sharedLength = Math.min(registeredRedirectUri.length, redirectUri.length);
      let firstMismatchIndex = sharedLength;

      for (let index = 0; index < sharedLength; index += 1) {
        if (registeredRedirectUri[index] !== redirectUri[index]) {
          firstMismatchIndex = index;
          break;
        }
      }

      return {
        firstMismatchIndex,
        registeredLength: registeredRedirectUri.length,
        requestedLength: redirectUri.length,
      };
    },
  );
  const application = await ctx.db
    .query("oauthApplications")
    .withIndex("by_clientId", (index) => index.eq("clientId", clientId))
    .unique();

  if (application !== null) {
    if (
      application.status !== "active" ||
      !application.allowedGrants.includes("authorization_code")
    ) {
      return { ok: false as const, reason: "invalid_client" as const };
    }

    if (!application.redirectUris.some((registeredRedirectUri) =>
      oauthRedirectUriMatches(registeredRedirectUri, redirectUri))) {
      return {
        ok: false as const,
        reason: "invalid_redirect_uri" as const,
        redirectDiagnostics: redirectDiagnostics(application.redirectUris),
      };
    }

    if (!hasRequiredApiScopes(application.allowedScopes, requestedScopes)) {
      return { ok: false as const, reason: "invalid_scope" as const, redirectUri };
    }

    return toAuthorizationClientSummary(
      { kind: "application", record: application },
      { redirectUri, requestedScopes, resource },
    );
  }

  const dynamicClient = await ctx.db
    .query("oauthDynamicClients")
    .withIndex("by_clientId", (index) => index.eq("clientId", clientId))
    .unique();

  if (dynamicClient === null) {
    return { ok: false as const, reason: "not_found" as const };
  }

  if (dynamicClient.status !== "active" || !dynamicClient.grantTypes.includes("authorization_code")) {
    return { ok: false as const, reason: "invalid_client" as const };
  }

  if (!dynamicClient.redirectUris.some((registeredRedirectUri) =>
    oauthRedirectUriMatches(registeredRedirectUri, redirectUri))) {
    return {
      ok: false as const,
      reason: "invalid_redirect_uri" as const,
      redirectDiagnostics: redirectDiagnostics(dynamicClient.redirectUris),
    };
  }

  if (dynamicClient.resource !== resource) {
    return { ok: false as const, reason: "wrong_resource" as const, redirectUri };
  }

  if (!hasRequiredApiScopes(dynamicClient.allowedScopes, requestedScopes)) {
    return { ok: false as const, reason: "invalid_scope" as const, redirectUri };
  }

  return toAuthorizationClientSummary(
    { kind: "dynamic_client", record: dynamicClient },
    { redirectUri, requestedScopes, resource },
  );
}

export const listPersonalApplications = query({
  args: {
    includeRevoked: v.optional(v.boolean()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);

    if (user === null) {
      return null;
    }

    return await listDeveloperApplicationSummaries(ctx, { ...args, ownerUserId: user._id });
  },
});

export const listPersonalApplicationOwnershipOptions = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);

    if (user === null) {
      return null;
    }

    const communities = await communityProfilesOwnedByUser(ctx, user._id);

    return {
      communities: communities
        .sort((first, second) => first.displayName.localeCompare(second.displayName))
        .map((community) => ({
          id: community._id,
          slug: community.slug,
          displayName: community.displayName,
        })),
    };
  },
});

export const listDeveloperApplicationsForApiOwner = internalQuery({
  args: {
    ownerUserId: v.id("users"),
    includeRevoked: v.optional(v.boolean()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await listDeveloperApplicationSummaries(ctx, args);
  },
});

async function createOwnedApplication(
  ctx: MutationCtx,
  args: {
    allowedGrants?: readonly string[];
    allowedScopes?: readonly string[];
    clientId: string;
    clientSecretPrefix?: string;
    clientType: string;
    description?: string;
    displayName: string;
    docsUrl?: string;
    logoUrl?: string;
    ownerCommunityProfileId?: Doc<"profiles">["_id"];
    ownerUserId: Doc<"users">["_id"];
    privacyUrl?: string;
    redirectUris: readonly string[];
    termsUrl?: string;
    verifierHash?: string;
  },
) {
  const now = Date.now();
  const clientId = normalizeOwnedOAuthClientId(args.clientId);
  const clientType = normalizeOAuthClientType(args.clientType);
  const displayName = normalizeOAuthApplicationName(args.displayName);
  const description = normalizeOAuthApplicationDescription(args.description);
  const logoUrl = normalizeOAuthOptionalUrl(args.logoUrl, "Logo URL");
  const docsUrl = normalizeOAuthOptionalUrl(args.docsUrl, "Docs URL");
  const privacyUrl = normalizeOAuthOptionalUrl(args.privacyUrl, "Privacy URL");
  const termsUrl = normalizeOAuthOptionalUrl(args.termsUrl, "Terms URL");
  const redirectUris = normalizeOAuthRedirectUris(args.redirectUris);
  const allowedScopes = normalizeOAuthScopes(args.allowedScopes);
  const allowedGrants = normalizeOAuthGrantTypes(args.allowedGrants, clientType);
  const existingApplication = await ctx.db
    .query("oauthApplications")
    .withIndex("by_clientId", (index) => index.eq("clientId", clientId))
    .unique();
  const existingDynamicClient = await ctx.db
    .query("oauthDynamicClients")
    .withIndex("by_clientId", (index) => index.eq("clientId", clientId))
    .unique();

  if (existingApplication !== null || existingDynamicClient !== null) {
    throw new Error("OAuth client id collision. Generate a new client id and retry.");
  }

  if (clientType === "confidential" && (args.clientSecretPrefix === undefined || args.verifierHash === undefined)) {
    throw new Error("Confidential OAuth applications require a generated client secret hash.");
  }

  if (clientType === "public" && (args.clientSecretPrefix !== undefined || args.verifierHash !== undefined)) {
    throw new Error("Public OAuth applications must not store client secrets.");
  }

  const applicationId = await ctx.db.insert("oauthApplications", {
    clientId,
    ownerKind: args.ownerCommunityProfileId === undefined ? "user" : "community",
    ownerUserId: args.ownerUserId,
    ...(args.ownerCommunityProfileId === undefined
      ? {}
      : { ownerCommunityProfileId: args.ownerCommunityProfileId }),
    clientType,
    displayName,
    ...(description === undefined ? {} : { description }),
    ...(logoUrl === undefined ? {} : { logoUrl }),
    ...(docsUrl === undefined ? {} : { docsUrl }),
    ...(privacyUrl === undefined ? {} : { privacyUrl }),
    ...(termsUrl === undefined ? {} : { termsUrl }),
    redirectUris,
    allowedGrants,
    allowedScopes,
    status: "active",
    trustTier: "standard",
    createdAt: now,
    updatedAt: now,
  });
  const application = await ctx.db.get(applicationId);

  if (application === null) {
    throw new Error("OAuth application creation failed.");
  }

  await recordOAuthClientEvent(ctx, {
    application,
    eventType: "application_created",
    result: "accepted",
    now,
  });

  let activeSecrets: Doc<"oauthApplicationSecrets">[] = [];

  if (clientType === "confidential") {
    const secretPrefix = normalizeOAuthClientSecretPrefix(args.clientSecretPrefix ?? "");
    const verifierHash = normalizeOAuthClientSecretHash(args.verifierHash ?? "");
    const existingSecret = await ctx.db
      .query("oauthApplicationSecrets")
      .withIndex("by_secretPrefix", (index) => index.eq("secretPrefix", secretPrefix))
      .unique();

    if (existingSecret !== null) {
      throw new Error("OAuth client secret prefix collision. Generate a new secret and retry.");
    }

    const secretId = await ctx.db.insert("oauthApplicationSecrets", {
      applicationId,
      clientId,
      secretPrefix,
      verifierHash,
      hashVersion: oauthClientSecretHashVersion,
      status: "active",
      label: "Initial secret",
      createdAt: now,
      updatedAt: now,
    });
    const secret = await ctx.db.get(secretId);

    if (secret === null) {
      throw new Error("OAuth client secret creation failed.");
    }

    activeSecrets = [secret];

    await recordOAuthClientEvent(ctx, {
      application,
      secretPrefix,
      eventType: "secret_created",
      result: "accepted",
      now,
    });
  }

  return toApplicationSummary(application, activeSecrets);
}

export const createPersonalApplication = mutation({
  args: {
    clientId: v.string(),
    clientType: v.string(),
    displayName: v.string(),
    description: v.optional(v.string()),
    logoUrl: v.optional(v.string()),
    docsUrl: v.optional(v.string()),
    privacyUrl: v.optional(v.string()),
    termsUrl: v.optional(v.string()),
    redirectUris: v.array(v.string()),
    allowedGrants: v.optional(v.array(oauthGrantTypeValidator)),
    allowedScopes: v.optional(v.array(apiScopeValidator)),
    clientSecretPrefix: v.optional(v.string()),
    verifierHash: v.optional(v.string()),
    ownerCommunitySlug: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireCurrentUser(ctx);
    const ownerCommunity =
      args.ownerCommunitySlug === undefined
        ? undefined
        : await requireOwnedCommunityProfileBySlug(ctx, {
            ownerCommunitySlug: args.ownerCommunitySlug,
            ownerUserId: user._id,
          });

    return await createOwnedApplication(ctx, {
      ...args,
      ownerUserId: user._id,
      ...(ownerCommunity === undefined ? {} : { ownerCommunityProfileId: ownerCommunity._id }),
    });
  },
});

export const createDeveloperApplicationForApiOwner = internalMutation({
  args: {
    ownerUserId: v.id("users"),
    clientId: v.string(),
    clientType: v.string(),
    displayName: v.string(),
    description: v.optional(v.string()),
    logoUrl: v.optional(v.string()),
    docsUrl: v.optional(v.string()),
    privacyUrl: v.optional(v.string()),
    termsUrl: v.optional(v.string()),
    redirectUris: v.array(v.string()),
    allowedGrants: v.optional(v.array(oauthGrantTypeValidator)),
    allowedScopes: v.optional(v.array(apiScopeValidator)),
    clientSecretPrefix: v.optional(v.string()),
    verifierHash: v.optional(v.string()),
    ownerCommunitySlug: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const ownerCommunity =
      args.ownerCommunitySlug === undefined
        ? undefined
        : await requireOwnedCommunityProfileBySlug(ctx, {
            ownerCommunitySlug: args.ownerCommunitySlug,
            ownerUserId: args.ownerUserId,
          });

    return await createOwnedApplication(ctx, {
      ...args,
      ...(ownerCommunity === undefined ? {} : { ownerCommunityProfileId: ownerCommunity._id }),
    });
  },
});

export const createDeveloperApplicationSecretForApiOwner = internalMutation({
  args: {
    ownerUserId: v.id("users"),
    clientId: v.string(),
    secretPrefix: v.string(),
    verifierHash: v.string(),
    label: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const clientId = normalizeOAuthClientId(args.clientId);
    const application = await ctx.db
      .query("oauthApplications")
      .withIndex("by_clientId", (index) => index.eq("clientId", clientId))
      .unique();

    if (
      application === null ||
      !(await canManageApplication(ctx, application, args.ownerUserId)) ||
      application.status !== "active"
    ) {
      return { ok: false as const, reason: "not_found" as const };
    }

    if (application.clientType !== "confidential") {
      return { ok: false as const, reason: "not_confidential" as const };
    }

    const secretPrefix = normalizeOAuthClientSecretPrefix(args.secretPrefix);
    const verifierHash = normalizeOAuthClientSecretHash(args.verifierHash);
    const label = normalizeOAuthClientSecretLabel(args.label) ?? "Rotated secret";
    const existingSecret = await ctx.db
      .query("oauthApplicationSecrets")
      .withIndex("by_secretPrefix", (index) => index.eq("secretPrefix", secretPrefix))
      .unique();

    if (existingSecret !== null) {
      throw new Error("OAuth client secret prefix collision. Generate a new secret and retry.");
    }

    const secretId = await ctx.db.insert("oauthApplicationSecrets", {
      applicationId: application._id,
      clientId,
      secretPrefix,
      verifierHash,
      hashVersion: oauthClientSecretHashVersion,
      status: "active",
      label,
      createdAt: now,
      updatedAt: now,
    });
    const secret = await ctx.db.get(secretId);

    if (secret === null) {
      throw new Error("OAuth client secret creation failed.");
    }

    await ctx.db.patch(application._id, { updatedAt: now });

    const updatedApplication = { ...application, updatedAt: now };

    await recordOAuthClientEvent(ctx, {
      application: updatedApplication,
      secretPrefix,
      eventType: "secret_created",
      result: "accepted",
      now,
    });

    const activeSecrets = await activeSecretsForApplication(ctx, application._id);

    return {
      ok: true as const,
      application: toApplicationSummary(updatedApplication, activeSecrets),
    };
  },
});

export const updateDeveloperApplicationForApiOwner = internalMutation({
  args: {
    ownerUserId: v.id("users"),
    clientId: v.string(),
    displayName: v.optional(v.string()),
    description: v.optional(v.union(v.string(), v.null())),
    logoUrl: v.optional(v.union(v.string(), v.null())),
    docsUrl: v.optional(v.union(v.string(), v.null())),
    privacyUrl: v.optional(v.union(v.string(), v.null())),
    termsUrl: v.optional(v.union(v.string(), v.null())),
    redirectUris: v.optional(v.array(v.string())),
    allowedGrants: v.optional(v.array(oauthGrantTypeValidator)),
    allowedScopes: v.optional(v.array(apiScopeValidator)),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const clientId = normalizeOAuthClientId(args.clientId);
    const application = await ctx.db
      .query("oauthApplications")
      .withIndex("by_clientId", (index) => index.eq("clientId", clientId))
      .unique();

    if (
      application === null ||
      !(await canManageApplication(ctx, application, args.ownerUserId)) ||
      application.status !== "active"
    ) {
      return { ok: false as const, reason: "not_found" as const };
    }

    const patch: {
      allowedGrants?: ReturnType<typeof normalizeOAuthGrantTypes>;
      allowedScopes?: ReturnType<typeof normalizeOAuthScopes>;
      description?: string | undefined;
      displayName?: string;
      docsUrl?: string | undefined;
      logoUrl?: string | undefined;
      privacyUrl?: string | undefined;
      redirectUris?: string[];
      termsUrl?: string | undefined;
      updatedAt: number;
    } = { updatedAt: now };
    let hasUpdate = false;

    if (args.displayName !== undefined) {
      patch.displayName = normalizeOAuthApplicationName(args.displayName);
      hasUpdate = true;
    }

    if (args.description !== undefined) {
      patch.description = args.description === null ? undefined : normalizeOAuthApplicationDescription(args.description);
      hasUpdate = true;
    }

    if (args.logoUrl !== undefined) {
      patch.logoUrl = args.logoUrl === null ? undefined : normalizeOAuthOptionalUrl(args.logoUrl, "Logo URL");
      hasUpdate = true;
    }

    if (args.docsUrl !== undefined) {
      patch.docsUrl = args.docsUrl === null ? undefined : normalizeOAuthOptionalUrl(args.docsUrl, "Docs URL");
      hasUpdate = true;
    }

    if (args.privacyUrl !== undefined) {
      patch.privacyUrl = args.privacyUrl === null ? undefined : normalizeOAuthOptionalUrl(args.privacyUrl, "Privacy URL");
      hasUpdate = true;
    }

    if (args.termsUrl !== undefined) {
      patch.termsUrl = args.termsUrl === null ? undefined : normalizeOAuthOptionalUrl(args.termsUrl, "Terms URL");
      hasUpdate = true;
    }

    if (args.redirectUris !== undefined) {
      patch.redirectUris = normalizeOAuthRedirectUris(args.redirectUris);
      hasUpdate = true;
    }

    if (args.allowedScopes !== undefined) {
      if (args.allowedScopes.length === 0) {
        return {
          ok: false as const,
          reason: "invalid_update" as const,
          detail: "OAuth application updates must include at least one scope.",
        };
      }

      patch.allowedScopes = normalizeOAuthScopes(args.allowedScopes);
      hasUpdate = true;
    }

    if (args.allowedGrants !== undefined) {
      if (args.allowedGrants.length === 0) {
        return {
          ok: false as const,
          reason: "invalid_update" as const,
          detail: "OAuth application updates must include at least one grant.",
        };
      }

      try {
        patch.allowedGrants = normalizeOAuthGrantTypes(args.allowedGrants, application.clientType);
      } catch (error) {
        return {
          ok: false as const,
          reason: "invalid_update" as const,
          detail: error instanceof Error ? error.message : "The OAuth application update is invalid.",
        };
      }
      hasUpdate = true;
    }

    if (!hasUpdate) {
      throw new Error("OAuth application update must include at least one field.");
    }

    await ctx.db.patch(application._id, patch);

    const updatedApplication = { ...application, ...patch };

    await recordOAuthClientEvent(ctx, {
      application: updatedApplication,
      eventType: "application_updated",
      result: "accepted",
      now,
    });

    const activeSecrets = await activeSecretsForApplication(ctx, application._id);

    return {
      ok: true as const,
      application: toApplicationSummary(updatedApplication, activeSecrets),
    };
  },
});

export const revokeDeveloperApplicationForApiOwner = internalMutation({
  args: {
    ownerUserId: v.id("users"),
    clientId: v.string(),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const clientId = normalizeOAuthClientId(args.clientId);
    const application = await ctx.db
      .query("oauthApplications")
      .withIndex("by_clientId", (index) => index.eq("clientId", clientId))
      .unique();

    return await revokeManageableApplication(ctx, {
      application,
      ownerUserId: args.ownerUserId,
      reason: args.reason,
    });
  },
});

const dynamicMcpClientPersistenceArgs = {
  clientId: v.string(),
  clientName: v.string(),
  clientUri: v.optional(v.string()),
  logoUri: v.optional(v.string()),
  redirectUris: v.array(v.string()),
  grantTypes: v.optional(v.array(oauthGrantTypeValidator)),
  responseTypes: v.optional(v.array(oauthResponseTypeValidator)),
  tokenEndpointAuthMethod: v.optional(oauthTokenEndpointAuthMethodValidator),
  contacts: v.optional(v.array(v.string())),
  softwareId: v.optional(v.string()),
  softwareVersion: v.optional(v.string()),
  allowedScopes: v.optional(v.array(apiScopeValidator)),
  allowEventWrites: v.optional(v.boolean()),
  resource: v.string(),
};

type DynamicMcpClientPersistenceInput = {
  clientId: string;
  clientName: string;
  clientUri?: string;
  logoUri?: string;
  redirectUris: string[];
  grantTypes?: OAuthGrantType[];
  responseTypes?: OAuthResponseType[];
  tokenEndpointAuthMethod?: OAuthTokenEndpointAuthMethod;
  contacts?: string[];
  softwareId?: string;
  softwareVersion?: string;
  allowedScopes?: ApiScope[];
  allowEventWrites?: boolean;
  resource: string;
};

async function createDynamicMcpClientRecord(
  ctx: MutationCtx,
  args: DynamicMcpClientPersistenceInput,
) {
    const now = Date.now();
    const clientId = normalizeOAuthClientId(args.clientId);
    const clientName = normalizeOAuthApplicationName(args.clientName);
    const clientUri = normalizeOAuthOptionalUrl(args.clientUri, "client_uri");
    const logoUri = normalizeOAuthOptionalUrl(args.logoUri, "logo_uri");
    const redirectUris = normalizeOAuthRedirectUris(args.redirectUris);
    const grantTypes = normalizeOAuthGrantTypes(args.grantTypes, "public");
    const responseTypes = normalizeOAuthResponseTypes(args.responseTypes);
    const tokenEndpointAuthMethod = normalizeOAuthTokenEndpointAuthMethod(args.tokenEndpointAuthMethod);
    const contacts = normalizeOAuthContactValues(args.contacts);
    const softwareId = normalizeOAuthSoftwareValue(args.softwareId, "software_id");
    const softwareVersion = normalizeOAuthSoftwareValue(args.softwareVersion, "software_version");
    const allowedScopes = normalizeDynamicMcpScopes(args.allowedScopes, {
      allowEventWrites: args.allowEventWrites === true,
    });
    const resource = normalizeOAuthResourceUri(args.resource);
    const existingApplication = await ctx.db
      .query("oauthApplications")
      .withIndex("by_clientId", (index) => index.eq("clientId", clientId))
      .unique();
    const existingDynamicClient = await ctx.db
      .query("oauthDynamicClients")
      .withIndex("by_clientId", (index) => index.eq("clientId", clientId))
      .unique();

    if (existingApplication !== null || existingDynamicClient !== null) {
      throw new Error("OAuth client id collision. Generate a new client id and retry.");
    }

    if (!grantTypes.includes("authorization_code")) {
      throw new Error("Dynamic MCP clients must support authorization_code.");
    }

    const dynamicClientId = await ctx.db.insert("oauthDynamicClients", {
      clientId,
      clientName,
      ...(clientUri === undefined ? {} : { clientUri }),
      ...(logoUri === undefined ? {} : { logoUri }),
      redirectUris,
      primaryRedirectHost: normalizeOAuthRedirectHost(redirectUris[0]),
      grantTypes,
      responseTypes,
      tokenEndpointAuthMethod,
      contacts,
      ...(softwareId === undefined ? {} : { softwareId }),
      ...(softwareVersion === undefined ? {} : { softwareVersion }),
      allowedScopes,
      resource,
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    const dynamicClient = await ctx.db.get(dynamicClientId);

    if (dynamicClient === null) {
      throw new Error("Dynamic MCP client creation failed.");
    }

    await recordOAuthClientEvent(ctx, {
      dynamicClient,
      eventType: "dynamic_client_registered",
      result: "accepted",
      routeClass: "oauth_dynamic_client_registration",
      now,
    });

    return toDynamicMcpClientSummary(dynamicClient);
}

export const createDynamicMcpClient = internalMutation({
  args: dynamicMcpClientPersistenceArgs,
  handler: createDynamicMcpClientRecord,
});

async function upsertClientMetadataDocumentMcpClientRecord(
  ctx: MutationCtx,
  args: DynamicMcpClientPersistenceInput,
) {
    const now = Date.now();
    const clientId = normalizeOAuthClientMetadataDocumentUrl(args.clientId);
    const clientName = normalizeOAuthApplicationName(args.clientName);
    const clientUri = normalizeOAuthOptionalUrl(args.clientUri, "client_uri");
    const logoUri = normalizeOAuthOptionalUrl(args.logoUri, "logo_uri");
    const redirectUris = normalizeOAuthRedirectUris(args.redirectUris);
    const grantTypes = normalizeOAuthGrantTypes(args.grantTypes, "public");
    const responseTypes = normalizeOAuthResponseTypes(args.responseTypes);
    const tokenEndpointAuthMethod = normalizeOAuthTokenEndpointAuthMethod(args.tokenEndpointAuthMethod);
    const contacts = normalizeOAuthContactValues(args.contacts);
    const softwareId = normalizeOAuthSoftwareValue(args.softwareId, "software_id");
    const softwareVersion = normalizeOAuthSoftwareValue(args.softwareVersion, "software_version");
    const allowedScopes = normalizeDynamicMcpScopes(args.allowedScopes, {
      allowEventWrites: args.allowEventWrites === true,
    });
    const resource = normalizeOAuthResourceUri(args.resource);
    const existingApplication = await ctx.db
      .query("oauthApplications")
      .withIndex("by_clientId", (index) => index.eq("clientId", clientId))
      .unique();
    const existingDynamicClient = await ctx.db
      .query("oauthDynamicClients")
      .withIndex("by_clientId", (index) => index.eq("clientId", clientId))
      .unique();

    if (existingApplication !== null) {
      throw new Error("OAuth client metadata document URL collides with a registered application.");
    }

    if (!grantTypes.includes("authorization_code")) {
      throw new Error("Client metadata document MCP clients must support authorization_code.");
    }

    if (existingDynamicClient !== null) {
      if (existingDynamicClient.status !== "active") {
        return toDynamicMcpClientSummary(existingDynamicClient);
      }

      await ctx.db.patch(existingDynamicClient._id, {
        clientName,
        ...(clientUri === undefined ? { clientUri: undefined } : { clientUri }),
        ...(logoUri === undefined ? { logoUri: undefined } : { logoUri }),
        redirectUris,
        primaryRedirectHost: normalizeOAuthRedirectHost(redirectUris[0]),
        grantTypes,
        responseTypes,
        tokenEndpointAuthMethod,
        contacts,
        ...(softwareId === undefined ? { softwareId: undefined } : { softwareId }),
        ...(softwareVersion === undefined ? { softwareVersion: undefined } : { softwareVersion }),
        allowedScopes,
        resource,
        updatedAt: now,
      });

      const refreshedDynamicClient = await ctx.db.get(existingDynamicClient._id);

      if (refreshedDynamicClient === null) {
        throw new Error("Client metadata document MCP client refresh failed.");
      }

      await recordOAuthClientEvent(ctx, {
        dynamicClient: refreshedDynamicClient,
        eventType: "dynamic_client_metadata_refreshed",
        result: "accepted",
        routeClass: "oauth_dynamic_client_registration",
        now,
      });

      return toDynamicMcpClientSummary(refreshedDynamicClient);
    }

    const dynamicClientId = await ctx.db.insert("oauthDynamicClients", {
      clientId,
      clientName,
      ...(clientUri === undefined ? {} : { clientUri }),
      ...(logoUri === undefined ? {} : { logoUri }),
      redirectUris,
      primaryRedirectHost: normalizeOAuthRedirectHost(redirectUris[0]),
      grantTypes,
      responseTypes,
      tokenEndpointAuthMethod,
      contacts,
      ...(softwareId === undefined ? {} : { softwareId }),
      ...(softwareVersion === undefined ? {} : { softwareVersion }),
      allowedScopes,
      resource,
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    const dynamicClient = await ctx.db.get(dynamicClientId);

    if (dynamicClient === null) {
      throw new Error("Client metadata document MCP client creation failed.");
    }

    await recordOAuthClientEvent(ctx, {
      dynamicClient,
      eventType: "dynamic_client_registered",
      result: "accepted",
      routeClass: "oauth_dynamic_client_registration",
      now,
    });

    return toDynamicMcpClientSummary(dynamicClient);
}

export const upsertClientMetadataDocumentMcpClient = internalMutation({
  args: dynamicMcpClientPersistenceArgs,
  handler: upsertClientMetadataDocumentMcpClientRecord,
});

export const createPreviewDynamicMcpClient = mutation({
  args: {
    bridgeSecret: v.string(),
    ...dynamicMcpClientPersistenceArgs,
  },
  handler: async (ctx, args) => {
    requirePreviewPersistenceBridge(args.bridgeSecret);
    const { bridgeSecret: _bridgeSecret, ...input } = args;

    return await createDynamicMcpClientRecord(ctx, input);
  },
});

export const upsertPreviewClientMetadataDocumentMcpClient = mutation({
  args: {
    bridgeSecret: v.string(),
    ...dynamicMcpClientPersistenceArgs,
  },
  handler: async (ctx, args) => {
    requirePreviewPersistenceBridge(args.bridgeSecret);
    const { bridgeSecret: _bridgeSecret, ...input } = args;

    return await upsertClientMetadataDocumentMcpClientRecord(ctx, input);
  },
});

export const resolveAuthorizationClient = internalQuery({
  args: {
    clientId: v.string(),
    redirectUri: v.string(),
    requestedScopes: v.optional(v.array(apiScopeValidator)),
    resource: v.string(),
  },
  handler: async (ctx, args) => {
    return await resolvePublicAuthorizationClient(ctx, args);
  },
});

export const completeAuthorizationConsent = internalMutation({
  args: {
    transactionHash: v.string(),
    userId: v.id("users"),
    decision: v.union(v.literal("approve"), v.literal("deny")),
    codeHash: v.optional(v.string()),
    expiresAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const transactionHash = normalizeOAuthConsentTransactionHash(args.transactionHash);
    const transaction = await ctx.db
      .query("oauthConsentTransactions")
      .withIndex("by_transactionHash", (index) => index.eq("transactionHash", transactionHash))
      .unique();
    const disposition = oauthConsentTransactionDisposition(transaction, args.userId, now);

    if (transaction !== null && disposition === "expired") {
      await ctx.db.delete(transaction._id);
    }

    if (disposition !== "accepted" || transaction === null) {
      return { ok: false as const, reason: "invalid_transaction" as const };
    }

    const client = await resolvePublicAuthorizationClient(ctx, {
      clientId: transaction.clientId,
      redirectUri: transaction.redirectUri,
      requestedScopes: transaction.scopes,
      resource: transaction.resource,
    });

    if (!client.ok) {
      return client;
    }

    await ctx.db.delete(transaction._id);

    if (args.decision === "deny") {
      return {
        ok: true as const,
        approved: false as const,
        redirectUri: client.redirectUri,
        ...(transaction.state === undefined ? {} : { state: transaction.state }),
      };
    }

    if (args.codeHash === undefined || args.expiresAt === undefined) {
      throw new Error("Approved OAuth consent requires an authorization code and expiry.");
    }

    const codeHash = normalizeOAuthAuthorizationCodeHash(args.codeHash);
    const codeChallenge = normalizeOAuthCodeChallenge(transaction.codeChallenge);
    const codeChallengeMethod = normalizeOAuthCodeChallengeMethod(transaction.codeChallengeMethod);
    const expiresAt = normalizeOAuthTokenExpiry(args.expiresAt, now);
    const existingCode = await ctx.db
      .query("oauthAuthorizationCodes")
      .withIndex("by_codeHash", (index) => index.eq("codeHash", codeHash))
      .unique();

    if (existingCode !== null) {
      throw new Error("OAuth authorization code collision. Generate a new code and retry.");
    }

    await ctx.db.insert("oauthAuthorizationCodes", {
      codeHash,
      ...(client.clientKind === "application" ? { applicationId: client.applicationId } : {}),
      ...(client.clientKind === "dynamic_client" ? { dynamicClientId: client.dynamicClientId } : {}),
      clientId: client.clientId,
      userId: args.userId,
      redirectUri: client.redirectUri,
      resource: client.resource,
      scopes: client.requestedScopes,
      codeChallenge,
      codeChallengeMethod,
      status: "active",
      createdAt: now,
      expiresAt,
    });

    await recordOAuthClientEvent(ctx, {
      ...(client.clientKind === "application"
        ? { application: await ctx.db.get(client.applicationId) ?? undefined }
        : { dynamicClient: await ctx.db.get(client.dynamicClientId) ?? undefined }),
      clientId: client.clientId,
      eventType: "authorization_code_issued",
      result: "accepted",
      routeClass: "oauth_authorize",
      now,
    });

    return {
      ok: true as const,
      approved: true as const,
      clientId: client.clientId,
      redirectUri: client.redirectUri,
      resource: client.resource,
      scopes: client.requestedScopes,
      expiresAt,
      ...(transaction.state === undefined ? {} : { state: transaction.state }),
    };
  },
});

export const revokePersonalApplication = mutation({
  args: {
    applicationId: v.id("oauthApplications"),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireCurrentUser(ctx);
    const application = await ctx.db.get(args.applicationId);
    const result = await revokeManageableApplication(ctx, {
      application,
      ownerUserId: user._id,
      reason: args.reason,
    });

    if (!result.ok) {
      throw new Error("OAuth application was not found for the current account.");
    }

    return result.application;
  },
});

const clientCredentialsAccessTokenArgs = {
  clientId: v.string(),
  secretPrefix: v.string(),
  verifierHash: v.string(),
  requestedScopes: v.optional(v.array(apiScopeValidator)),
  resource: v.string(),
  tokenId: v.string(),
  expiresAt: v.number(),
};

type ClientCredentialsAccessTokenInput = {
  clientId: string;
  secretPrefix: string;
  verifierHash: string;
  requestedScopes?: ApiScope[];
  resource: string;
  tokenId: string;
  expiresAt: number;
};

async function issueClientCredentialsAccessTokenRecord(
  ctx: MutationCtx,
  args: ClientCredentialsAccessTokenInput,
) {
    const now = Date.now();
    const clientId = normalizeOAuthClientId(args.clientId);
    const secretPrefix = normalizeOAuthClientSecretPrefix(args.secretPrefix);
    const verifierHash = normalizeOAuthClientSecretHash(args.verifierHash);
    const requestedScopes = normalizeOAuthScopes(args.requestedScopes);
    const resource = normalizeOAuthResourceUri(args.resource);
    const tokenId = normalizeOAuthAccessTokenId(args.tokenId);
    const expiresAt = normalizeOAuthTokenExpiry(args.expiresAt, now);
    const application = await ctx.db
      .query("oauthApplications")
      .withIndex("by_clientId", (index) => index.eq("clientId", clientId))
      .unique();

    if (
      application === null ||
      application.status !== "active" ||
      application.clientType !== "confidential" ||
      !application.allowedGrants.includes("client_credentials")
    ) {
      await recordOAuthClientEvent(ctx, {
        clientId,
        secretPrefix,
        eventType: "client_credentials_rejected",
        result: "rejected",
        routeClass: "oauth_token",
        now,
      });

      return { ok: false as const, reason: "invalid_client" as const };
    }

    if (!hasRequiredApiScopes(application.allowedScopes, requestedScopes)) {
      await recordOAuthClientEvent(ctx, {
        application,
        secretPrefix,
        eventType: "client_credentials_rejected",
        result: "rejected",
        routeClass: "oauth_token",
        now,
      });

      return { ok: false as const, reason: "invalid_scope" as const };
    }

    const secret = await ctx.db
      .query("oauthApplicationSecrets")
      .withIndex("by_secretPrefix", (index) => index.eq("secretPrefix", secretPrefix))
      .unique();

    if (
      secret === null ||
      secret.applicationId !== application._id ||
      secret.clientId !== clientId ||
      secret.status !== "active" ||
      !timingSafeEqualString(secret.verifierHash, verifierHash)
    ) {
      await recordOAuthClientEvent(ctx, {
        application,
        secretPrefix,
        eventType: "client_credentials_rejected",
        result: "rejected",
        routeClass: "oauth_token",
        now,
      });

      return { ok: false as const, reason: "invalid_client" as const };
    }

    const existingAccessToken = await ctx.db
      .query("oauthAccessTokens")
      .withIndex("by_tokenId", (index) => index.eq("tokenId", tokenId))
      .unique();

    if (existingAccessToken !== null) {
      throw new Error("OAuth access token id collision. Generate a new token id and retry.");
    }

    await ctx.db.insert("oauthAccessTokens", {
      tokenId,
      applicationId: application._id,
      clientId,
      subjectType: "client",
      resource,
      scopes: requestedScopes,
      status: "active",
      issuedAt: now,
      expiresAt,
    });
    await ctx.db.patch(application._id, { lastUsedAt: now, updatedAt: now });
    await ctx.db.patch(secret._id, { lastUsedAt: now, updatedAt: now });
    await recordOAuthClientEvent(ctx, {
      application,
      secretPrefix,
      eventType: "token_issued",
      result: "accepted",
      routeClass: "oauth_token",
      now,
    });

    return {
      ok: true as const,
      applicationId: application._id,
      clientId,
      ownerUserId: application.ownerUserId,
      resource,
      scopes: requestedScopes,
      tokenId,
      expiresAt,
    };
}

export const issueClientCredentialsAccessToken = internalMutation({
  args: clientCredentialsAccessTokenArgs,
  handler: issueClientCredentialsAccessTokenRecord,
});

export const issuePreviewClientCredentialsAccessToken = mutation({
  args: {
    bridgeSecret: v.string(),
    ...clientCredentialsAccessTokenArgs,
  },
  handler: async (ctx, args) => {
    requirePreviewClientCredentialsBridge(args.bridgeSecret);
    const { bridgeSecret: _bridgeSecret, ...input } = args;

    return await issueClientCredentialsAccessTokenRecord(ctx, input);
  },
});

export const consumeAuthorizationCode = internalMutation({
  args: {
    clientId: v.string(),
    codeHash: v.string(),
    redirectUri: v.string(),
    resource: v.optional(v.string()),
    derivedCodeChallenge: v.string(),
    tokenId: v.string(),
    expiresAt: v.number(),
    refreshTokenHash: v.string(),
    refreshTokenExpiresAt: v.number(),
    secretPrefix: v.optional(v.string()),
    verifierHash: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const clientId = normalizeOAuthClientId(args.clientId);
    const codeHash = normalizeOAuthAuthorizationCodeHash(args.codeHash);
    const redirectUri = normalizeOAuthRedirectUris([args.redirectUri])[0];
    const requestedResource = args.resource === undefined ? undefined : normalizeOAuthResourceUri(args.resource);
    const derivedCodeChallenge = normalizeOAuthCodeChallenge(args.derivedCodeChallenge);
    const tokenId = normalizeOAuthAccessTokenId(args.tokenId);
    const expiresAt = normalizeOAuthTokenExpiry(args.expiresAt, now);
    const refreshTokenHash = normalizeOAuthRefreshTokenHash(args.refreshTokenHash);
    const refreshTokenExpiresAt = normalizeOAuthTokenExpiry(args.refreshTokenExpiresAt, now);
    const code = await ctx.db
      .query("oauthAuthorizationCodes")
      .withIndex("by_codeHash", (index) => index.eq("codeHash", codeHash))
      .unique();

    if (code === null) {
      return {
        ok: false as const,
        reason: "invalid_grant" as const,
        rejectionReason: "code_not_found" as const,
      };
    }

    const rejectionReason =
      code.clientId !== clientId
        ? "client_mismatch" as const
        : code.redirectUri !== redirectUri
          ? "redirect_mismatch" as const
          : requestedResource !== undefined && code.resource !== requestedResource
            ? "resource_mismatch" as const
            : code.status !== "active"
              ? "code_not_active" as const
              : code.expiresAt <= now
                ? "code_expired" as const
                : code.codeChallengeMethod !== "S256"
                  ? "unsupported_challenge_method" as const
                  : code.codeChallenge !== derivedCodeChallenge
                    ? "pkce_mismatch" as const
                    : null;

    if (rejectionReason !== null) {
      const sharedRedirectLength = Math.min(code.redirectUri.length, redirectUri.length);
      let firstRedirectMismatchIndex = sharedRedirectLength;

      if (rejectionReason === "redirect_mismatch") {
        for (let index = 0; index < sharedRedirectLength; index += 1) {
          if (code.redirectUri[index] !== redirectUri[index]) {
            firstRedirectMismatchIndex = index;
            break;
          }
        }
      }

      return {
        ok: false as const,
        reason: "invalid_grant" as const,
        rejectionReason,
        ...(rejectionReason === "redirect_mismatch"
          ? {
              redirectDiagnostics: {
                authorizationLength: code.redirectUri.length,
                firstMismatchIndex: firstRedirectMismatchIndex,
                tokenRequestLength: redirectUri.length,
              },
            }
          : {}),
      };
    }

    // Convex mutations are serializable transactions. A concurrent redemption
    // conflicts on this read/patch and retries against the consumed status.
    const resource = code.resource;
    const application = code.applicationId === undefined ? null : await ctx.db.get(code.applicationId);
    const dynamicClient = code.dynamicClientId === undefined ? null : await ctx.db.get(code.dynamicClientId);
    let authenticatedSecret: Doc<"oauthApplicationSecrets"> | null = null;

    if (
      application === null &&
      dynamicClient === null
    ) {
      return { ok: false as const, reason: "invalid_client" as const };
    }

    if (
      application !== null &&
      (application.clientId !== clientId ||
        application.status !== "active" ||
        !application.allowedGrants.includes("authorization_code"))
    ) {
      return { ok: false as const, reason: "invalid_client" as const };
    }

    if (application !== null && application.clientType === "public") {
      if (args.secretPrefix !== undefined || args.verifierHash !== undefined) {
        await recordOAuthClientEvent(ctx, {
          application,
          ...(args.secretPrefix === undefined ? {} : { secretPrefix: args.secretPrefix }),
          eventType: "authorization_code_redeemed",
          result: "rejected",
          routeClass: "oauth_token",
          now,
        });

        return { ok: false as const, reason: "invalid_client" as const };
      }
    }

    if (application !== null && application.clientType === "confidential") {
      authenticatedSecret = await validatedActiveApplicationSecret(ctx, {
        application,
        clientId,
        secretPrefix: args.secretPrefix,
        verifierHash: args.verifierHash,
      });

      if (authenticatedSecret === null) {
        await recordOAuthClientEvent(ctx, {
          application,
          ...(args.secretPrefix === undefined ? {} : { secretPrefix: args.secretPrefix }),
          eventType: "authorization_code_redeemed",
          result: "rejected",
          routeClass: "oauth_token",
          now,
        });

        return { ok: false as const, reason: "invalid_client" as const };
      }
    }

    if (
      dynamicClient !== null &&
      (dynamicClient.clientId !== clientId ||
        dynamicClient.status !== "active" ||
        !dynamicClient.grantTypes.includes("authorization_code") ||
        dynamicClient.resource !== resource)
    ) {
      return { ok: false as const, reason: "invalid_client" as const };
    }

    if (dynamicClient !== null && (args.secretPrefix !== undefined || args.verifierHash !== undefined)) {
      await recordOAuthClientEvent(ctx, {
        dynamicClient,
        clientId,
        ...(args.secretPrefix === undefined ? {} : { secretPrefix: args.secretPrefix }),
        eventType: "authorization_code_redeemed",
        result: "rejected",
        routeClass: "oauth_token",
        now,
      });

      return { ok: false as const, reason: "invalid_client" as const };
    }

    const refreshTokenIssued =
      application?.allowedGrants.includes("refresh_token") === true ||
      dynamicClient?.grantTypes.includes("refresh_token") === true;

    const existingAccessToken = await ctx.db
      .query("oauthAccessTokens")
      .withIndex("by_tokenId", (index) => index.eq("tokenId", tokenId))
      .unique();

    if (existingAccessToken !== null) {
      throw new Error("OAuth access token id collision. Generate a new token id and retry.");
    }

    if (refreshTokenIssued) {
      const existingRefreshToken = await ctx.db
        .query("oauthRefreshTokens")
        .withIndex("by_tokenHash", (index) => index.eq("tokenHash", refreshTokenHash))
        .unique();

      if (existingRefreshToken !== null) {
        throw new Error("OAuth refresh token collision. Generate a new refresh token and retry.");
      }
    }

    await ctx.db.patch(code._id, {
      status: "consumed",
      consumedAt: now,
    });
    await ctx.db.insert("oauthAccessTokens", {
      tokenId,
      ...(application === null ? {} : { applicationId: application._id }),
      ...(dynamicClient === null ? {} : { dynamicClientId: dynamicClient._id }),
      clientId,
      subjectType: "user",
      userId: code.userId,
      resource,
      scopes: code.scopes,
      status: "active",
      issuedAt: now,
      expiresAt,
    });
    if (refreshTokenIssued) {
      await ctx.db.insert("oauthRefreshTokens", {
        tokenHash: refreshTokenHash,
        ...(application === null ? {} : { applicationId: application._id }),
        ...(dynamicClient === null ? {} : { dynamicClientId: dynamicClient._id }),
        clientId,
        userId: code.userId,
        resource,
        scopes: code.scopes,
        status: "active",
        issuedAt: now,
        expiresAt: refreshTokenExpiresAt,
      });
    }

    if (application !== null) {
      await ctx.db.patch(application._id, { lastUsedAt: now, updatedAt: now });
    }

    if (authenticatedSecret !== null) {
      await ctx.db.patch(authenticatedSecret._id, { lastUsedAt: now, updatedAt: now });
    }

    if (dynamicClient !== null) {
      await ctx.db.patch(dynamicClient._id, { lastUsedAt: now, updatedAt: now });
    }

    await recordOAuthClientEvent(ctx, {
      ...(application === null ? {} : { application }),
      ...(dynamicClient === null ? {} : { dynamicClient }),
      clientId,
      ...(authenticatedSecret === null ? {} : { secretPrefix: authenticatedSecret.secretPrefix }),
      eventType: "authorization_code_redeemed",
      result: "accepted",
      routeClass: "oauth_token",
      now,
    });

    return {
      ok: true as const,
      clientId,
      resource,
      scopes: code.scopes,
      tokenId,
      subjectType: "user" as const,
      userId: code.userId,
      expiresAt,
      refreshTokenIssued,
      refreshTokenExpiresAt,
    };
  },
});

export const rotateRefreshToken = internalMutation({
  args: {
    clientId: v.string(),
    refreshTokenHash: v.string(),
    replacementRefreshTokenHash: v.string(),
    requestedScopes: v.optional(v.array(apiScopeValidator)),
    resource: v.optional(v.string()),
    tokenId: v.string(),
    expiresAt: v.number(),
    refreshTokenExpiresAt: v.number(),
    secretPrefix: v.optional(v.string()),
    verifierHash: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const clientId = normalizeOAuthClientId(args.clientId);
    const refreshTokenHash = normalizeOAuthRefreshTokenHash(args.refreshTokenHash);
    const replacementRefreshTokenHash = normalizeOAuthRefreshTokenHash(args.replacementRefreshTokenHash);
    const requestedResource = args.resource === undefined ? undefined : normalizeOAuthResourceUri(args.resource);
    const tokenId = normalizeOAuthAccessTokenId(args.tokenId);
    const expiresAt = normalizeOAuthTokenExpiry(args.expiresAt, now);
    const refreshTokenExpiresAt = normalizeOAuthTokenExpiry(args.refreshTokenExpiresAt, now);
    const refreshToken = await ctx.db
      .query("oauthRefreshTokens")
      .withIndex("by_tokenHash", (index) => index.eq("tokenHash", refreshTokenHash))
      .unique();

    if (
      refreshToken === null ||
      refreshToken.clientId !== clientId ||
      (requestedResource !== undefined && refreshToken.resource !== requestedResource) ||
      refreshToken.status !== "active" ||
      refreshToken.expiresAt <= now
    ) {
      return { ok: false as const, reason: "invalid_grant" as const };
    }

    // Convex mutations are serializable transactions. A concurrent rotation
    // conflicts on this read/patch and retries against the rotated status.
    const resource = refreshToken.resource;
    const scopes = args.requestedScopes === undefined
      ? refreshToken.scopes
      : normalizeOAuthScopes(args.requestedScopes);

    if (!hasRequiredApiScopes(refreshToken.scopes, scopes)) {
      return { ok: false as const, reason: "invalid_scope" as const };
    }

    const application = refreshToken.applicationId === undefined ? null : await ctx.db.get(refreshToken.applicationId);
    const dynamicClient = refreshToken.dynamicClientId === undefined ? null : await ctx.db.get(refreshToken.dynamicClientId);
    let authenticatedSecret: Doc<"oauthApplicationSecrets"> | null = null;

    if (application === null && dynamicClient === null) {
      return { ok: false as const, reason: "invalid_client" as const };
    }

    if (
      application !== null &&
      (application.clientId !== clientId ||
        application.status !== "active" ||
        !application.allowedGrants.includes("refresh_token"))
    ) {
      return { ok: false as const, reason: "invalid_client" as const };
    }

    if (application !== null && application.clientType === "public") {
      if (args.secretPrefix !== undefined || args.verifierHash !== undefined) {
        await recordOAuthClientEvent(ctx, {
          application,
          ...(args.secretPrefix === undefined ? {} : { secretPrefix: args.secretPrefix }),
          eventType: "refresh_token_rotated",
          result: "rejected",
          routeClass: "oauth_token",
          now,
        });

        return { ok: false as const, reason: "invalid_client" as const };
      }
    }

    if (application !== null && application.clientType === "confidential") {
      authenticatedSecret = await validatedActiveApplicationSecret(ctx, {
        application,
        clientId,
        secretPrefix: args.secretPrefix,
        verifierHash: args.verifierHash,
      });

      if (authenticatedSecret === null) {
        await recordOAuthClientEvent(ctx, {
          application,
          ...(args.secretPrefix === undefined ? {} : { secretPrefix: args.secretPrefix }),
          eventType: "refresh_token_rotated",
          result: "rejected",
          routeClass: "oauth_token",
          now,
        });

        return { ok: false as const, reason: "invalid_client" as const };
      }
    }

    if (
      dynamicClient !== null &&
      (dynamicClient.clientId !== clientId ||
        dynamicClient.status !== "active" ||
        !dynamicClient.grantTypes.includes("refresh_token") ||
        dynamicClient.resource !== resource)
    ) {
      return { ok: false as const, reason: "invalid_client" as const };
    }

    if (dynamicClient !== null && (args.secretPrefix !== undefined || args.verifierHash !== undefined)) {
      await recordOAuthClientEvent(ctx, {
        dynamicClient,
        clientId,
        ...(args.secretPrefix === undefined ? {} : { secretPrefix: args.secretPrefix }),
        eventType: "refresh_token_rotated",
        result: "rejected",
        routeClass: "oauth_token",
        now,
      });

      return { ok: false as const, reason: "invalid_client" as const };
    }

    if (
      (application !== null && !hasRequiredApiScopes(application.allowedScopes, scopes)) ||
      (dynamicClient !== null && !hasRequiredApiScopes(dynamicClient.allowedScopes, scopes))
    ) {
      return { ok: false as const, reason: "invalid_scope" as const };
    }

    const existingAccessToken = await ctx.db
      .query("oauthAccessTokens")
      .withIndex("by_tokenId", (index) => index.eq("tokenId", tokenId))
      .unique();

    if (existingAccessToken !== null) {
      throw new Error("OAuth access token id collision. Generate a new token id and retry.");
    }

    const existingReplacement = await ctx.db
      .query("oauthRefreshTokens")
      .withIndex("by_tokenHash", (index) => index.eq("tokenHash", replacementRefreshTokenHash))
      .unique();

    if (existingReplacement !== null) {
      throw new Error("OAuth refresh token collision. Generate a new refresh token and retry.");
    }

    await ctx.db.patch(refreshToken._id, {
      status: "rotated",
      rotatedAt: now,
      replacedByTokenHash: replacementRefreshTokenHash,
    });
    await ctx.db.insert("oauthAccessTokens", {
      tokenId,
      ...(application === null ? {} : { applicationId: application._id }),
      ...(dynamicClient === null ? {} : { dynamicClientId: dynamicClient._id }),
      clientId,
      subjectType: "user",
      userId: refreshToken.userId,
      resource,
      scopes,
      status: "active",
      issuedAt: now,
      expiresAt,
    });
    await ctx.db.insert("oauthRefreshTokens", {
      tokenHash: replacementRefreshTokenHash,
      ...(application === null ? {} : { applicationId: application._id }),
      ...(dynamicClient === null ? {} : { dynamicClientId: dynamicClient._id }),
      clientId,
      userId: refreshToken.userId,
      resource,
      scopes,
      status: "active",
      issuedAt: now,
      expiresAt: refreshTokenExpiresAt,
    });

    if (application !== null) {
      await ctx.db.patch(application._id, { lastUsedAt: now, updatedAt: now });
    }

    if (authenticatedSecret !== null) {
      await ctx.db.patch(authenticatedSecret._id, { lastUsedAt: now, updatedAt: now });
    }

    if (dynamicClient !== null) {
      await ctx.db.patch(dynamicClient._id, { lastUsedAt: now, updatedAt: now });
    }

    await recordOAuthClientEvent(ctx, {
      ...(application === null ? {} : { application }),
      ...(dynamicClient === null ? {} : { dynamicClient }),
      clientId,
      ...(authenticatedSecret === null ? {} : { secretPrefix: authenticatedSecret.secretPrefix }),
      eventType: "refresh_token_rotated",
      result: "accepted",
      routeClass: "oauth_token",
      now,
    });

    return {
      ok: true as const,
      clientId,
      resource,
      scopes,
      tokenId,
      subjectType: "user" as const,
      userId: refreshToken.userId,
      expiresAt,
      refreshTokenExpiresAt,
    };
  },
});

export const revokeClientAccessToken = internalMutation({
  args: {
    clientId: v.string(),
    tokenId: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const clientId = normalizeOAuthClientId(args.clientId);
    const tokenId = normalizeOAuthAccessTokenId(args.tokenId);
    const token = await ctx.db
      .query("oauthAccessTokens")
      .withIndex("by_tokenId", (index) => index.eq("tokenId", tokenId))
      .unique();

    if (token === null || token.clientId !== clientId || token.status === "revoked") {
      return { ok: true as const };
    }

    await ctx.db.patch(token._id, {
      status: "revoked",
      revokedAt: now,
      revokedByClientId: clientId,
    });

    const application = token.applicationId === undefined ? null : await ctx.db.get(token.applicationId);
    const dynamicClient = token.dynamicClientId === undefined ? null : await ctx.db.get(token.dynamicClientId);

    await recordOAuthClientEvent(ctx, {
      ...(application === null ? {} : { application }),
      ...(dynamicClient === null ? {} : { dynamicClient }),
      clientId,
      eventType: "token_revoked",
      result: "accepted",
      routeClass: "oauth_token",
      now,
    });

    return { ok: true as const };
  },
});

export const revokeClientRefreshToken = internalMutation({
  args: {
    clientId: v.string(),
    refreshTokenHash: v.string(),
    secretPrefix: v.optional(v.string()),
    verifierHash: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const clientId = normalizeOAuthClientId(args.clientId);
    const refreshTokenHash = normalizeOAuthRefreshTokenHash(args.refreshTokenHash);
    const refreshToken = await ctx.db
      .query("oauthRefreshTokens")
      .withIndex("by_tokenHash", (index) => index.eq("tokenHash", refreshTokenHash))
      .unique();

    if (refreshToken === null || refreshToken.clientId !== clientId || refreshToken.status === "revoked") {
      return { ok: true as const };
    }

    const application = refreshToken.applicationId === undefined ? null : await ctx.db.get(refreshToken.applicationId);
    const dynamicClient = refreshToken.dynamicClientId === undefined ? null : await ctx.db.get(refreshToken.dynamicClientId);
    let authenticatedSecret: Doc<"oauthApplicationSecrets"> | null = null;

    if (application === null && dynamicClient === null) {
      return { ok: true as const };
    }

    if (
      application !== null &&
      (application.clientId !== clientId ||
        application.status !== "active" ||
        !application.allowedGrants.includes("refresh_token"))
    ) {
      return { ok: true as const };
    }

    if (application !== null && application.clientType === "public") {
      if (args.secretPrefix !== undefined || args.verifierHash !== undefined) {
        await recordOAuthClientEvent(ctx, {
          application,
          ...(args.secretPrefix === undefined ? {} : { secretPrefix: args.secretPrefix }),
          eventType: "token_revoked",
          result: "rejected",
          routeClass: "oauth_token",
          now,
        });

        return { ok: true as const };
      }
    }

    if (application !== null && application.clientType === "confidential") {
      authenticatedSecret = await validatedActiveApplicationSecret(ctx, {
        application,
        clientId,
        secretPrefix: args.secretPrefix,
        verifierHash: args.verifierHash,
      });

      if (authenticatedSecret === null) {
        await recordOAuthClientEvent(ctx, {
          application,
          ...(args.secretPrefix === undefined ? {} : { secretPrefix: args.secretPrefix }),
          eventType: "token_revoked",
          result: "rejected",
          routeClass: "oauth_token",
          now,
        });

        return { ok: true as const };
      }
    }

    if (
      dynamicClient !== null &&
      (dynamicClient.clientId !== clientId ||
        dynamicClient.status !== "active" ||
        !dynamicClient.grantTypes.includes("refresh_token"))
    ) {
      return { ok: true as const };
    }

    if (dynamicClient !== null && (args.secretPrefix !== undefined || args.verifierHash !== undefined)) {
      await recordOAuthClientEvent(ctx, {
        dynamicClient,
        clientId,
        ...(args.secretPrefix === undefined ? {} : { secretPrefix: args.secretPrefix }),
        eventType: "token_revoked",
        result: "rejected",
        routeClass: "oauth_token",
        now,
      });

      return { ok: true as const };
    }

    await ctx.db.patch(refreshToken._id, {
      status: "revoked",
      revokedAt: now,
    });

    const relatedAccessTokens = await ctx.db
      .query("oauthAccessTokens")
      .withIndex("by_clientId_expiresAt", (index) => index.eq("clientId", clientId).gt("expiresAt", now))
      .collect();
    const accessTokensToRevoke = relatedAccessTokens.filter((token) =>
      token.status === "active" &&
      token.subjectType === "user" &&
      token.userId === refreshToken.userId &&
      token.resource === refreshToken.resource &&
      token.applicationId === refreshToken.applicationId &&
      token.dynamicClientId === refreshToken.dynamicClientId
    );

    await Promise.all(
      accessTokensToRevoke.map((token) =>
        ctx.db.patch(token._id, {
          status: "revoked",
          revokedAt: now,
          revokedByClientId: clientId,
        }),
      ),
    );

    if (authenticatedSecret !== null) {
      await ctx.db.patch(authenticatedSecret._id, { lastUsedAt: now, updatedAt: now });
    }

    if (dynamicClient !== null) {
      await ctx.db.patch(dynamicClient._id, { lastUsedAt: now, updatedAt: now });
    }

    await recordOAuthClientEvent(ctx, {
      ...(application === null ? {} : { application }),
      ...(dynamicClient === null ? {} : { dynamicClient }),
      clientId,
      ...(authenticatedSecret === null ? {} : { secretPrefix: authenticatedSecret.secretPrefix }),
      eventType: "token_revoked",
      result: "accepted",
      routeClass: "oauth_token",
      now,
    });

    return { ok: true as const };
  },
});

const validateAccessTokenArgs = {
  clientId: v.string(),
  tokenId: v.string(),
  resource: v.string(),
  requiredScopes: v.optional(v.array(apiScopeValidator)),
  routeClass: v.optional(apiRouteClassValidator),
};

type ValidateAccessTokenInput = {
  clientId: string;
  tokenId: string;
  resource: string;
  requiredScopes?: ApiScope[];
  routeClass?: ApiRouteClass;
};

async function validateAccessTokenRecord(
  ctx: MutationCtx,
  args: ValidateAccessTokenInput,
) {
    const now = Date.now();
    const clientId = normalizeOAuthClientId(args.clientId);
    const tokenId = normalizeOAuthAccessTokenId(args.tokenId);
    const resource = normalizeOAuthResourceUri(args.resource);
    const requiredScopes = normalizeOAuthScopes(args.requiredScopes);
    const routeClass = args.routeClass ?? "authenticated_public_read";
    const token = await ctx.db
      .query("oauthAccessTokens")
      .withIndex("by_tokenId", (index) => index.eq("tokenId", tokenId))
      .unique();
    const eventApplication =
      token !== null && token.clientId === clientId && token.applicationId !== undefined
        ? await ctx.db.get(token.applicationId)
        : null;
    const eventDynamicClient =
      token !== null && token.clientId === clientId && token.dynamicClientId !== undefined
        ? await ctx.db.get(token.dynamicClientId)
        : null;
    const recordValidationEvent = async (validation: OAuthAccessTokenValidationResult) => {
      const metadata = oauthAccessTokenValidationEventMetadata(validation);

      await recordOAuthClientEvent(ctx, {
        ...(eventApplication === null ? {} : { application: eventApplication }),
        ...(eventDynamicClient === null ? {} : { dynamicClient: eventDynamicClient }),
        clientId,
        accessTokenId: tokenId,
        eventType: metadata.eventType,
        result: metadata.statusCodeClass === "2xx" ? "accepted" : "rejected",
        validationResult: metadata.result,
        routeClass,
        now,
      });
    };
    const result = validateOAuthAccessTokenRecord(token, {
      clientId,
      tokenId,
      resource,
      requiredScopes,
      now,
    });

    if (!result.ok) {
      await recordValidationEvent(result);

      return result;
    }

    const application = result.applicationId === undefined ? null : await ctx.db.get(result.applicationId);
    const dynamicClient = result.dynamicClientId === undefined ? null : await ctx.db.get(result.dynamicClientId);

    if (application === null && dynamicClient === null) {
      const validation = { ok: false as const, reason: "not_found" as const };

      await recordValidationEvent(validation);

      return validation;
    }

    if (application !== null && application.clientId !== clientId) {
      const validation = { ok: false as const, reason: "not_found" as const };

      await recordValidationEvent(validation);

      return validation;
    }

    if (dynamicClient !== null && dynamicClient.clientId !== clientId) {
      const validation = { ok: false as const, reason: "not_found" as const };

      await recordValidationEvent(validation);

      return validation;
    }

    if (application !== null && application.status !== "active") {
      const validation = { ok: false as const, reason: "revoked" as const };

      await recordValidationEvent(validation);

      return validation;
    }

    if (dynamicClient !== null && dynamicClient.status !== "active") {
      const validation = { ok: false as const, reason: "revoked" as const };

      await recordValidationEvent(validation);

      return validation;
    }

    if (dynamicClient !== null) {
      const validation = {
        ...result,
        dynamicClientId: dynamicClient._id,
        trustTier: "standard" as const,
      };

      await recordValidationEvent(validation);

      return validation;
    }

    if (application === null) {
      const validation = { ok: false as const, reason: "not_found" as const };

      await recordValidationEvent(validation);

      return validation;
    }

    const validation = {
      ...result,
      ownerKind: application.ownerKind,
      ownerUserId: application.ownerUserId,
      ownerCommunityProfileId: application.ownerCommunityProfileId,
      trustTier: application.trustTier,
    };

    await recordValidationEvent(validation);

    return validation;
}

export const validateAccessToken = internalMutation({
  args: validateAccessTokenArgs,
  handler: validateAccessTokenRecord,
});

export const validatePreviewAccessToken = mutation({
  args: {
    bridgeSecret: v.string(),
    ...validateAccessTokenArgs,
  },
  handler: async (ctx, args) => {
    requirePreviewClientCredentialsBridge(args.bridgeSecret);
    const { bridgeSecret: _bridgeSecret, ...input } = args;

    return await validateAccessTokenRecord(ctx, input);
  },
});
