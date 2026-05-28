import { v } from "convex/values";

import { mutation } from "./_generated/server";
import { toAuthSubject } from "./_communityAuthority";
import { getProfileBySlug, validateProfileSlug } from "./_profileSlugs";
import { normalizeProfileInlineText } from "./_profileSubmissions";

const profileType = v.union(v.literal("person"), v.literal("community"));
const suppressionRequestType = v.union(
  v.literal("owner_opt_out"),
  v.literal("pre_claim_safety"),
);

function optionalValue<T>(key: string, value: T | undefined): Record<string, T> {
  return value === undefined ? {} : { [key]: value };
}

function optionalText(value: string | undefined, maxLength: number): string | undefined {
  const normalized = normalizeProfileInlineText(value ?? "");

  if (!normalized) {
    return undefined;
  }

  return normalized.slice(0, maxLength);
}

export const requestProfileSuppression = mutation({
  args: {
    requestType: suppressionRequestType,
    profileSlug: v.optional(v.string()),
    profileType: v.optional(profileType),
    displayName: v.optional(v.string()),
    requesterContact: v.optional(v.string()),
    requesterNote: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const identity = await ctx.auth.getUserIdentity();
    const requester = identity
      ? toAuthSubject({
          tokenIdentifier: identity.tokenIdentifier,
          issuer: identity.issuer,
          subject: identity.subject,
          name: identity.name,
        })
      : undefined;
    const slugValidation = args.profileSlug ? validateProfileSlug(args.profileSlug) : undefined;

    if (slugValidation && !slugValidation.ok) {
      throw new Error("Profile slug is invalid.");
    }

    const profile = slugValidation ? await getProfileBySlug(ctx.db, slugValidation.slug) : null;
    const displayName = optionalText(args.displayName ?? profile?.displayName, 120);

    if (profile === null && displayName === undefined) {
      throw new Error("Suppression requests need a profile slug or display name.");
    }

    const requestId = await ctx.db.insert("profileSuppressionRequests", {
      ...optionalValue("profileId", profile?._id),
      ...optionalValue("profileSlug", profile?.slug ?? slugValidation?.slug),
      ...optionalValue("profileType", profile?.profileType ?? args.profileType),
      ...optionalValue("displayName", displayName),
      requestType: args.requestType,
      state: "submitted",
      ...optionalValue("requester", requester),
      ...optionalValue("requesterContact", optionalText(args.requesterContact, 160)),
      ...optionalValue("requesterNote", optionalText(args.requesterNote, 1_000)),
      createdAt: now,
      updatedAt: now,
    });

    if (profile) {
      await ctx.db.insert("profileAuditEvents", {
        profileId: profile._id,
        action: "suppression_requested",
        ...optionalValue("actor", requester),
        sourceType: "community",
        note:
          args.requestType === "owner_opt_out"
            ? "Owner opt-out request submitted."
            : "Pre-claim safety suppression request submitted.",
        createdAt: now,
      });
    }

    return { requestId };
  },
});
