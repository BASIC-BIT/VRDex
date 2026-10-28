import { defineTable } from "convex/server";
import { v } from "convex/values";

// Storage validators only. External payloads are parsed by packages/media-relay.
export const relayContextValidator = v.union(
  v.object({
    kind: v.literal("profile"),
    profileId: v.string(),
    linkId: v.string(),
  }),
  v.object({
    kind: v.literal("event"),
    eventId: v.string(),
    selectedSourceId: v.string(),
  }),
);
export const mediaRelayTables = {
  mediaRelaySources: defineTable({
    streamKey: v.string(),
    streamId: v.string(),
    inputFormat: v.literal("vrcdn_fmp4"),
    packagingVersion: v.literal(1),
    state: v.union(
      v.literal("queued"),
      v.literal("starting"),
      v.literal("ready"),
      v.literal("recovering"),
      v.literal("draining"),
      v.literal("stopped"),
      v.literal("unavailable"),
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_streamKey", ["streamKey"])
    .index("by_state", ["state"]),
  mediaRelayGrants: defineTable({
    grantId: v.string(),
    streamKey: v.string(),
    context: relayContextValidator,
    contextRevision: v.number(),
    issuedAt: v.number(),
    expiresAt: v.number(),
    releasedAt: v.optional(v.number()),
  })
    .index("by_grantId", ["grantId"])
    .index("by_expiresAt", ["expiresAt"])
    .index("by_releasedAt_expiresAt", ["releasedAt", "expiresAt"])
    .index("by_issuedAt", ["issuedAt"]),
};
