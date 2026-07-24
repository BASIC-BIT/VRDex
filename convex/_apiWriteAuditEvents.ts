import { v } from "convex/values";

import type { DatabaseWriter } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { apiRouteClassValidator, type ApiRouteClass } from "./_apiTokens";

export const apiWriteAuditActionValidator = v.union(
  v.literal("profile_updated"),
  v.literal("event_created"),
  v.literal("event_updated"),
  v.literal("profile_asset_upload_intent_created"),
  v.literal("profile_asset_upload_completed"),
);

export const apiWriteAuditActorKindValidator = v.union(
  v.literal("personal_api_token"),
  v.literal("user_delegated_oauth"),
  v.literal("upload_token"),
);

export const apiWriteAuditResourceTypeValidator = v.union(
  v.literal("profile"),
  v.literal("event"),
  v.literal("profile_asset_upload_intent"),
  v.literal("profile_asset"),
);

export const apiWriteAuditResultValidator = v.literal("accepted");

export type ApiWriteAuditAction =
  | "profile_updated"
  | "event_created"
  | "event_updated"
  | "profile_asset_upload_intent_created"
  | "profile_asset_upload_completed";

export type ApiWriteAuditActorKind =
  | "personal_api_token"
  | "user_delegated_oauth"
  | "upload_token";

export type ApiWriteAuditResourceType =
  | "profile"
  | "event"
  | "profile_asset_upload_intent"
  | "profile_asset";

export const mcpEventWriteToolNameValidator = v.union(
  v.literal("vrdex_event_create"),
  v.literal("vrdex_event_update"),
);

export type McpEventWriteToolName =
  | "vrdex_event_create"
  | "vrdex_event_update";

export async function recordApiWriteAuditEvent(
  db: DatabaseWriter,
  args: {
    action: ApiWriteAuditAction;
    actorKind: ApiWriteAuditActorKind;
    assetIds?: Id<"profileAssets">[];
    idempotencyKeyHash?: string;
    mcpToolName?: McpEventWriteToolName;
    oauthClientId?: string;
    oauthTokenId?: string;
    ownerUserId?: Id<"users">;
    requestId?: string;
    resourceType: ApiWriteAuditResourceType;
    routeClass: ApiRouteClass;
    targetEventId?: Id<"events">;
    targetIntentId?: Id<"profileAssetUploadIntents">;
    targetProfileId?: Id<"profiles">;
    now: number;
  },
) {
  return await db.insert("apiWriteAuditEvents", {
    action: args.action,
    actorKind: args.actorKind,
    ...(args.assetIds === undefined ? {} : { assetIds: args.assetIds }),
    ...(args.idempotencyKeyHash === undefined ? {} : { idempotencyKeyHash: args.idempotencyKeyHash }),
    ...(args.mcpToolName === undefined ? {} : { mcpToolName: args.mcpToolName }),
    ...(args.oauthClientId === undefined ? {} : { oauthClientId: args.oauthClientId }),
    ...(args.oauthTokenId === undefined ? {} : { oauthTokenId: args.oauthTokenId }),
    ...(args.ownerUserId === undefined ? {} : { ownerUserId: args.ownerUserId }),
    ...(args.requestId === undefined ? {} : { requestId: args.requestId }),
    resourceType: args.resourceType,
    result: "accepted",
    routeClass: args.routeClass,
    ...(args.targetEventId === undefined ? {} : { targetEventId: args.targetEventId }),
    ...(args.targetIntentId === undefined ? {} : { targetIntentId: args.targetIntentId }),
    ...(args.targetProfileId === undefined ? {} : { targetProfileId: args.targetProfileId }),
    createdAt: args.now,
  });
}
