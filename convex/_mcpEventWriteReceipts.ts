import { ConvexError, v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import type { DatabaseWriter } from "./_generated/server";
import {
  mcpEventWriteToolNameValidator,
  type McpEventWriteToolName,
} from "./_apiWriteAuditEvents";

export { mcpEventWriteToolNameValidator };

export const mcpEventWriteResultValidator = v.object({
  eventId: v.id("events"),
  slug: v.string(),
  eventPath: v.string(),
  shortLinkCode: v.optional(v.string()),
  shortLinkPath: v.optional(v.string()),
});

export type McpEventWriteResult = {
  eventId: Id<"events">;
  slug: string;
  eventPath: string;
  shortLinkCode?: string;
  shortLinkPath?: string;
};

const sha256HexPattern = /^[a-f0-9]{64}$/;

export function requireSha256Hex(value: string, fieldName: string) {
  if (!sha256HexPattern.test(value)) {
    throw new Error(`${fieldName} must be a lowercase SHA-256 hex digest.`);
  }

  return value;
}

export async function findMcpEventWriteReceipt(
  db: DatabaseWriter,
  args: {
    ownerUserId: Id<"users">;
    oauthClientId: string;
    toolName: McpEventWriteToolName;
    idempotencyKeyHash: string;
    requestFingerprint: string;
  },
): Promise<Doc<"mcpEventWriteReceipts"> | null> {
  requireSha256Hex(args.idempotencyKeyHash, "Idempotency key hash");
  requireSha256Hex(args.requestFingerprint, "Request fingerprint");

  const receipt = await db
    .query("mcpEventWriteReceipts")
    .withIndex("by_owner_client_tool_key", (query) =>
      query
        .eq("ownerUserId", args.ownerUserId)
        .eq("oauthClientId", args.oauthClientId)
        .eq("toolName", args.toolName)
        .eq("idempotencyKeyHash", args.idempotencyKeyHash),
    )
    .unique();

  if (receipt !== null && receipt.requestFingerprint !== args.requestFingerprint) {
    throw new ConvexError({ code: "MCP_EVENT_WRITE_DENIED" });
  }

  return receipt;
}

export async function recordMcpEventWriteReceipt(
  db: DatabaseWriter,
  args: {
    ownerUserId: Id<"users">;
    oauthClientId: string;
    toolName: McpEventWriteToolName;
    idempotencyKeyHash: string;
    requestFingerprint: string;
    result: McpEventWriteResult;
    now: number;
  },
) {
  return await db.insert("mcpEventWriteReceipts", {
    ownerUserId: args.ownerUserId,
    oauthClientId: args.oauthClientId,
    toolName: args.toolName,
    idempotencyKeyHash: args.idempotencyKeyHash,
    requestFingerprint: args.requestFingerprint,
    result: args.result,
    createdAt: args.now,
  });
}
