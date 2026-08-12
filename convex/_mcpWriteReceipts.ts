import { ConvexError, v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import type { DatabaseReader, DatabaseWriter } from "./_generated/server";
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
 * A stored receipt's result, with its paths brought up to the current routing.
 *
 * Receipts are durable and have no expiry, and `eventPath` was `/e/<slug>` and
 * `profilePath` was `/p/<slug>` or `/c/<slug>` when they were written. Both
 * render from the site root now, so replaying one verbatim would hand a client
 * retrying an already-acknowledged idempotency key a permanently dead link. The
 * slug is stored alongside, so the path is derived rather than migrated.
 *
 * Covers both result shapes deliberately: the event version arrived with the
 * routing change, and a profile receipt replayed through the untouched path
 * would have been the same bug one union member over.
 */
export function withCurrentWritePaths<T extends McpWriteResult>(result: T): T {
  return "eventPath" in result
    ? { ...result, eventPath: `/${result.slug}` }
    : { ...result, profilePath: `/${result.slug}` };
}

/**
 * A stored profile receipt, re-resolved through the record it points at.
 *
 * Deriving the path from the receipt's own slug is not enough for profiles: an
 * operator rename moves the profile and `scripts/rename-profile.mjs` says
 * plainly that links to the previous slug stop resolving. A replay would then
 * hand back a path that is dead for a second reason, having just been fixed for
 * the first. The id is stable, so the current slug, path and visibility are read
 * off the record instead of reconstructed from what was true at write time.
 */
export async function withCurrentProfileWritePaths(
  db: DatabaseReader,
  result: McpProfileWriteResult,
  isPubliclyReadable: (profile: Doc<"profiles">) => boolean,
  /**
   * Whether the caller replaying this receipt still owns the profile.
   *
   * A different question from public readability, and it became a different
   * answer once `vrdex_list_my_profiles` existed: an owner reads their own
   * drafts and opted-out profiles there, so withholding the current slug from
   * them protects nothing. It just replays an address that no longer resolves
   * and points their next update at a slug that is gone.
   */
  isCurrentOwner?: (profile: Doc<"profiles">) => Promise<boolean>,
): Promise<McpProfileWriteResult> {
  const profile = await db.get(result.profileId);

  // Deleted since. Nothing to resolve through, for anybody.
  if (profile === null) {
    return { ...result, profilePath: `/${result.slug}`, publiclyViewable: false };
  }

  const publiclyViewable = isPubliclyReadable(profile);

  if (publiclyViewable || (isCurrentOwner !== undefined && await isCurrentOwner(profile))) {
    return {
      ...result,
      slug: profile.slug,
      profileType: profile.profileType,
      profilePath: `/${profile.slug}`,
      // Still keyed on public visibility rather than on who is asking, so an
      // owner replaying a draft is told where it lives and that it has no
      // public page.
      publiclyViewable,
    };
  }

  // Not public, and not theirs any more. Resolving through the record would hand
  // a former owner or a prior submitter the profile's new slug, which is exactly
  // the routing a rename plus an opt-out is meant to take away from them. The
  // receipt's own identifiers are what they already hold, so replaying those
  // discloses nothing new.
  return { ...result, profilePath: `/${result.slug}`, publiclyViewable: false };
}

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
