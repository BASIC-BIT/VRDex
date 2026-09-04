import { v } from "convex/values";

import type { DatabaseWriter } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { apiRouteClassValidator, type ApiRouteClass } from "./_apiTokens";

export const apiWriteAuditActionValidator = v.union(
  v.literal("profile_created"),
  v.literal("profile_updated"),
  v.literal("event_created"),
  v.literal("event_updated"),
  v.literal("profile_asset_upload_intent_created"),
  v.literal("profile_asset_upload_completed"),
  v.literal("profile_asset_managed"),
  v.literal("profile_media_submission_submitted"),
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
  v.literal("profile_media_submission"),
);

export const apiWriteAuditResultValidator = v.literal("accepted");

export type ApiWriteAuditAction =
  | "profile_created"
  | "profile_updated"
  | "event_created"
  | "event_updated"
  | "profile_asset_upload_intent_created"
  | "profile_asset_upload_completed"
  | "profile_asset_managed"
  | "profile_media_submission_submitted";

export type ApiWriteAuditActorKind =
  | "personal_api_token"
  | "user_delegated_oauth"
  | "upload_token";

export type ApiWriteAuditResourceType =
  | "profile"
  | "event"
  | "profile_asset_upload_intent"
  | "profile_asset"
  | "profile_media_submission";

export const mcpWriteToolNameValidator = v.union(
  v.literal("vrdex_event_create"),
  v.literal("vrdex_event_update"),
  v.literal("vrdex_profile_update"),
  v.literal("vrdex_profile_submit"),
  v.literal("vrdex_profile_media_manage"),
  v.literal("vrdex_profile_media_submit"),
);

export type McpWriteToolName =
  | "vrdex_event_create"
  | "vrdex_event_update"
  | "vrdex_profile_update"
  | "vrdex_profile_submit"
  | "vrdex_profile_media_manage"
  | "vrdex_profile_media_submit";

export async function recordApiWriteAuditEvent(
  db: DatabaseWriter,
  args: {
    action: ApiWriteAuditAction;
    actorUserId?: Id<"users">;
    actorKind: ApiWriteAuditActorKind;
    assetIds?: Id<"profileAssets">[];
    idempotencyKeyHash?: string;
    mcpToolName?: McpWriteToolName;
    oauthClientId?: string;
    oauthTokenId?: string;
    ownerUserId?: Id<"users">;
    requestId?: string;
    resourceType: ApiWriteAuditResourceType;
    routeClass: ApiRouteClass;
    targetEventId?: Id<"events">;
    targetIntentId?: Id<"profileAssetUploadIntents">;
    targetSubmissionId?: Id<"profileMediaSubmissions">;
    targetProfileId?: Id<"profiles">;
    now: number;
  },
) {
  return await db.insert("apiWriteAuditEvents", {
    action: args.action,
    actorKind: args.actorKind,
    ...(args.actorUserId === undefined ? {} : { actorUserId: args.actorUserId }),
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
    ...(args.targetSubmissionId === undefined ? {} : { targetSubmissionId: args.targetSubmissionId }),
    ...(args.targetProfileId === undefined ? {} : { targetProfileId: args.targetProfileId }),
    createdAt: args.now,
  });
}
