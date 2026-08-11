import { ConvexError, v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import type { DatabaseWriter } from "./_generated/server";
import {
  mcpWriteToolNameValidator,
  type McpWriteToolName,
} from "./_apiWriteAuditEvents";

export { mcpWriteToolNameValidator };

const mcpEventWriteResultValidator = v.object({
  eventId: v.id("events"),
  slug: v.string(),
  eventPath: v.string(),
  shortLinkCode: v.optional(v.string()),
  shortLinkPath: v.optional(v.string()),
});

const mcpProfileWriteResultValidator = v.object({
  profileId: v.id("profiles"),
  slug: v.string(),
  profileType: v.union(v.literal("person"), v.literal("community")),
  profilePath: v.string(),
  /**
   * Whether the saved profile is readable on a public surface.
   *
   * Carried because the tool reads the profile back before reporting success,
   * and a draft or opted-out profile its owner is perfectly entitled to edit
   * reads back as nothing. Without this the tool cannot tell that apart from a
   * readback that genuinely failed, and answers a successful write with an
   * error.
   */
  publiclyViewable: v.boolean(),
});

/**
 * A union rather than a second table, so one idempotency key can never be
 * replayed against a different tool and land a different kind of write. Widening
 * the union leaves every stored event receipt valid, which is why the table is
 * still called `mcpEventWriteReceipts` -- renaming it would be a data migration
 * to fix a name.
 */
export const mcpWriteResultValidator = v.union(
  mcpEventWriteResultValidator,
  mcpProfileWriteResultValidator,
);

export type McpEventWriteResult = {
  eventId: Id<"events">;
  slug: string;
  eventPath: string;
  shortLinkCode?: string;
  shortLinkPath?: string;
};

export type McpProfileWriteResult = {
  profileId: Id<"profiles">;
  slug: string;
  profileType: "person" | "community";
  profilePath: string;
  publiclyViewable: boolean;
};

export type McpWriteResult = McpEventWriteResult | McpProfileWriteResult;

/**
 * Who the hosted MCP session was acting as, carried on every write mutation so
 * the audit row can name the OAuth client and token rather than only the user.
 */
export const mcpWriteAttributionArgs = {
  ownerUserId: v.id("users"),
  oauthClientId: v.string(),
  oauthTokenId: v.string(),
  requestId: v.string(),
  idempotencyKeyHash: v.string(),
  requestFingerprint: v.string(),
};

export function requireMcpAttributionText(input: string, fieldName: string, maxLength: number) {
  const value = input.trim();

  if (value.length === 0 || value.length > maxLength) {
    throw new Error(`${fieldName} must be between 1 and ${maxLength} characters.`);
  }

  return value;
}

const sha256HexPattern = /^[a-f0-9]{64}$/;

export function requireSha256Hex(value: string, fieldName: string) {
  if (!sha256HexPattern.test(value)) {
    throw new Error(`${fieldName} must be a lowercase SHA-256 hex digest.`);
  }

  return value;
}

export async function findMcpWriteReceipt(
  db: DatabaseWriter,
  args: {
    ownerUserId: Id<"users">;
    oauthClientId: string;
    toolName: McpWriteToolName;
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
    throw new ConvexError({ code: "MCP_WRITE_DENIED" });
  }

  return receipt;
}

export async function recordMcpWriteReceipt(
  db: DatabaseWriter,
  args: {
    ownerUserId: Id<"users">;
    oauthClientId: string;
    toolName: McpWriteToolName;
    idempotencyKeyHash: string;
    requestFingerprint: string;
    result: McpWriteResult;
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
