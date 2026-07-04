import { v } from "convex/values";

import type { Doc } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import { getCurrentUser, requireCurrentUser } from "./accounts";
import { apiScopeValidator } from "./_apiTokens";
import {
  normalizeOAuthApplicationDescription,
  normalizeOAuthApplicationName,
  normalizeOAuthClientId,
  normalizeOAuthClientSecretHash,
  normalizeOAuthClientSecretPrefix,
  normalizeOAuthClientType,
  normalizeOAuthGrantTypes,
  normalizeOAuthOptionalUrl,
  normalizeOAuthRedirectUris,
  normalizeOAuthRevokeReason,
  normalizeOAuthScopes,
  oauthClientSecretHashVersion,
  oauthGrantTypeValidator,
} from "./_oauth";

function boundedLimit(value: number | undefined, fallback: number, max: number) {
  if (value === undefined || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(1, Math.min(Math.floor(value), max));
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

async function activeSecretsForApplication(ctx: MutationCtx, applicationId: Doc<"oauthApplications">["_id"]) {
  return await ctx.db
    .query("oauthApplicationSecrets")
    .withIndex("by_applicationId_status_createdAt", (index) =>
      index.eq("applicationId", applicationId).eq("status", "active"),
    )
    .collect();
}

async function recordOAuthClientEvent(
  ctx: MutationCtx,
  args: {
    application?: Doc<"oauthApplications">;
    clientId?: string;
    secretPrefix?: string;
    eventType: Doc<"oauthClientEvents">["eventType"];
    result: Doc<"oauthClientEvents">["result"];
    now: number;
  },
) {
  const clientId = args.application?.clientId ?? args.clientId;

  await ctx.db.insert("oauthClientEvents", {
    ...(args.application === undefined ? {} : { applicationId: args.application._id }),
    ...(clientId === undefined ? {} : { clientId }),
    ...(args.secretPrefix === undefined ? {} : { secretPrefix: args.secretPrefix }),
    ...(args.application === undefined ? {} : { ownerKind: args.application.ownerKind }),
    ...(args.application === undefined ? {} : { ownerUserId: args.application.ownerUserId }),
    ...(args.application?.ownerCommunityProfileId === undefined
      ? {}
      : { ownerCommunityProfileId: args.application.ownerCommunityProfileId }),
    routeClass: "developer_credential_management",
    eventType: args.eventType,
    result: args.result,
    createdAt: args.now,
  });
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

    const limit = boundedLimit(args.limit, 50, 100);
    const applications = await ctx.db
      .query("oauthApplications")
      .withIndex("by_ownerUserId_createdAt", (index) => index.eq("ownerUserId", user._id))
      .order("desc")
      .take(limit * 2);
    const visibleApplications = applications
      .filter((application) => application.ownerKind === "user")
      .filter((application) => args.includeRevoked === true || application.status === "active")
      .slice(0, limit);
    const summaries = [];

    for (const application of visibleApplications) {
      const activeSecrets = await ctx.db
        .query("oauthApplicationSecrets")
        .withIndex("by_applicationId_status_createdAt", (index) =>
          index.eq("applicationId", application._id).eq("status", "active"),
        )
        .collect();

      summaries.push(toApplicationSummary(application, activeSecrets));
    }

    return summaries;
  },
});

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
  },
  handler: async (ctx, args) => {
    const user = await requireCurrentUser(ctx);
    const now = Date.now();
    const clientId = normalizeOAuthClientId(args.clientId);
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

    if (existingApplication !== null) {
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
      ownerKind: "user",
      ownerUserId: user._id,
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

    if (
      application === null ||
      application.ownerKind !== "user" ||
      application.ownerUserId !== user._id
    ) {
      throw new Error("OAuth application was not found for the current account.");
    }

    if (application.status === "revoked") {
      return toApplicationSummary(application, []);
    }

    const now = Date.now();
    const revokeReason = normalizeOAuthRevokeReason(args.reason);
    const patch = {
      status: "revoked" as const,
      revokedAt: now,
      revokedByUserId: user._id,
      updatedAt: now,
      ...(revokeReason === undefined ? {} : { revokeReason }),
    };
    const activeSecrets = await activeSecretsForApplication(ctx, application._id);

    await ctx.db.patch(application._id, patch);

    for (const secret of activeSecrets) {
      await ctx.db.patch(secret._id, {
        status: "revoked",
        revokedAt: now,
        revokedByUserId: user._id,
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

    return toApplicationSummary(updatedApplication, []);
  },
});
