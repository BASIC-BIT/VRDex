import { v } from "convex/values";

import {
  activeBrowserSessionOrNull,
  requireActiveBrowserSessionSubject,
} from "./_browserSessionAuthority";
import { mutation, query } from "./_generated/server";
import {
  applyProfileFieldVisibilityUpdate,
  listOwnedPrivacyProfiles,
} from "./_profilePrivacy";
import {
  createProfileSearchDocument,
  upsertSearchDocument,
  vocabularyForProfile,
} from "./_searchDocuments";
import { recordVocabularyTerms } from "./_vocabulary";

const profileFieldVisibilityState = v.union(
  v.literal("public"),
  v.literal("unlisted"),
  v.literal("private"),
);

const profileFieldVisibilityInput = v.record(v.string(), profileFieldVisibilityState);

export const listOwnedPrivacyProfilesForAccount = query({
  args: {},
  handler: async (ctx) => {
    const activeSession = await activeBrowserSessionOrNull(ctx);

    if (activeSession === null) {
      return null;
    }

    return await listOwnedPrivacyProfiles(ctx.db, activeSession.userId);
  },
});

export const updateFieldVisibility = mutation({
  args: {
    profileId: v.id("profiles"),
    fieldVisibility: profileFieldVisibilityInput,
  },
  handler: async (ctx, args) => {
    const { subject, userId } = await requireActiveBrowserSessionSubject(ctx);
    const profile = await ctx.db.get(args.profileId);

    if (profile === null) {
      throw new Error("Profile not found.");
    }

    const now = Date.now();
    const result = await applyProfileFieldVisibilityUpdate(ctx.db, {
      profile,
      userId,
      fieldVisibility: args.fieldVisibility,
      now,
    });
    const updatedProfile = await ctx.db.get(profile._id);

    if (updatedProfile !== null) {
      await Promise.all([
        upsertSearchDocument(ctx.db, createProfileSearchDocument(updatedProfile)),
        recordVocabularyTerms(ctx.db, vocabularyForProfile(updatedProfile), now),
        ctx.db.insert("profileAuditEvents", {
          profileId: profile._id,
          action: "profile_field_visibility_updated",
          actor: subject,
          sourceType: "owner",
          note: "Claimed owner updated profile field visibility.",
          createdAt: now,
        }),
      ]);
    }

    return result;
  },
});
