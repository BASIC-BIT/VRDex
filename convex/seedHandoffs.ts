import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import {
  internalMutation,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { getActiveProfileOwner, approveProfileClaimForUser } from "./_profileOwnership";
import { findAvailableProfileSlug } from "./_profileSlugs";
import { createProfileSortName } from "./_profileSubmissions";
import { projectSafePrivateSeedField } from "./_seedAccess";
import {
  buildConciergeProfileFieldPatch,
  canRevealAcceptedHandoffDestination,
  hashHandoffToken,
  isHandoffBatchAvailable,
  isClaimablePrivatePersonSeedCandidate,
  isLiveHandoffInvitation,
  isReusablePrivateConciergeProfile,
  projectHandoffPreviewField,
  selectHandoffFields,
} from "./_seedHandoffs";
import { seedImportAuthSubjectValidator } from "./_seedImportValidators";
import {
  activeBrowserSessionOrNull,
  requireActiveBrowserSessionSubject,
} from "./_browserSessionAuthority";
import { identityEmailVerified } from "./_identity";

type PersonProfile = Extract<Doc<"profiles">, { profileType: "person" }>;

function ownerDestination(profileId: Id<"profiles">) {
  return `/account/privacy?profileId=${encodeURIComponent(profileId)}`;
}

function optionalAuditText(value: string | undefined): string | undefined {
  const normalized = value?.trim().replace(/\s+/g, " ");
  return normalized ? normalized.slice(0, 500) : undefined;
}

function assertPrivatePersonCandidate(candidate: Doc<"seedImportCandidateProfiles">) {
  if (!isClaimablePrivatePersonSeedCandidate(candidate)) {
    throw new Error("Handoff invitations require an unclaimed private person seed candidate.");
  }
}

function assertReusableConciergeProfile(profile: Doc<"profiles">): asserts profile is PersonProfile {
  if (profile.profileType !== "person" || !isReusablePrivateConciergeProfile(profile)) {
    throw new Error("Handoff invitations can reuse only unclaimed private person profiles.");
  }
}

async function getInvitationByToken(
  ctx: QueryCtx | MutationCtx,
  token: string,
) {
  const tokenHash = await hashHandoffToken(token);
  return await ctx.db
    .query("seedHandoffInvitations")
    .withIndex("by_tokenHash", (query) => query.eq("tokenHash", tokenHash))
    .unique();
}

async function getOfferedFields(
  ctx: QueryCtx | MutationCtx,
  invitation: Doc<"seedHandoffInvitations">,
) {
  const fields = await Promise.all(
    invitation.offeredFieldIds.map((fieldId) => ctx.db.get(fieldId)),
  );

  if (fields.some((field) => field === null)) {
    throw new Error("A prepared handoff field no longer exists.");
  }

  return fields.filter(
    (field): field is Doc<"seedImportCandidateFields"> => field !== null,
  );
}

export const createInvitation = internalMutation({
  args: {
    token: v.string(),
    candidateId: v.id("seedImportCandidateProfiles"),
    offeredFieldIds: v.array(v.id("seedImportCandidateFields")),
    profileId: v.optional(v.id("profiles")),
    expiresAt: v.number(),
    createdBy: seedImportAuthSubjectValidator,
    now: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = args.now ?? Date.now();
    if (args.expiresAt <= now || args.expiresAt > now + 90 * 24 * 60 * 60 * 1_000) {
      throw new Error("Handoff invitation expiry must be within the next 90 days.");
    }

    if (new Set(args.offeredFieldIds).size !== args.offeredFieldIds.length) {
      throw new Error("Offered handoff field ids must be unique.");
    }

    const candidate = await ctx.db.get(args.candidateId);
    if (candidate === null) {
      throw new Error("Seed candidate not found.");
    }
    assertPrivatePersonCandidate(candidate);
    const batch = await ctx.db.get(candidate.batchId);
    if (!isHandoffBatchAvailable(batch)) {
      throw new Error("Handoff invitations require an active seed import batch.");
    }

    const activeInvitations = await ctx.db
      .query("seedHandoffInvitations")
      .withIndex("by_candidateId_state", (query) =>
        query.eq("candidateId", candidate._id).eq("state", "active"),
      )
      .collect();
    if (activeInvitations.some((invitation) => isLiveHandoffInvitation(invitation, now))) {
      throw new Error("This seed candidate already has an active handoff invitation.");
    }
    await Promise.all(
      activeInvitations.map((invitation) =>
        ctx.db.patch(invitation._id, {
          state: "revoked",
          revokedBy: args.createdBy,
          revokedAt: now,
          revokeReason: "Expired invitation replaced by the operator.",
          updatedAt: now,
        }),
      ),
    );

    const fields = await Promise.all(
      args.offeredFieldIds.map((fieldId) => ctx.db.get(fieldId)),
    );
    for (const field of fields) {
      if (field === null || field.candidateId !== candidate._id) {
        throw new Error("Every offered field must belong to the handoff candidate.");
      }
      if (projectSafePrivateSeedField(field) === null) {
        throw new Error("Handoff invitations may offer only safe profile fields.");
      }
    }

    const preparedProfileId = args.profileId ?? candidate.matchedProfileId;
    if (args.profileId !== undefined) {
      if (candidate.matchedProfileId !== args.profileId) {
        throw new Error("The concierge profile is not matched to this seed candidate.");
      }
    }
    if (preparedProfileId !== undefined) {
      const profile = await ctx.db.get(preparedProfileId);
      if (profile === null) {
        throw new Error("Concierge profile not found.");
      }
      assertReusableConciergeProfile(profile);
      if (await getActiveProfileOwner(ctx.db, profile._id)) {
        throw new Error("The concierge profile already has an active owner.");
      }
    }

    const tokenHash = await hashHandoffToken(args.token);
    const existing = await ctx.db
      .query("seedHandoffInvitations")
      .withIndex("by_tokenHash", (query) => query.eq("tokenHash", tokenHash))
      .unique();

    if (existing !== null) {
      throw new Error("Handoff invitation token is already in use.");
    }

    const invitationId = await ctx.db.insert("seedHandoffInvitations", {
      tokenHash,
      candidateId: candidate._id,
      ...(preparedProfileId !== undefined ? { profileId: preparedProfileId } : {}),
      offeredFieldIds: args.offeredFieldIds,
      state: "active",
      createdBy: args.createdBy,
      createdAt: now,
      expiresAt: args.expiresAt,
      updatedAt: now,
    });

    return { invitationId, expiresAt: args.expiresAt };
  },
});

export const revokeInvitation = internalMutation({
  args: {
    invitationId: v.id("seedHandoffInvitations"),
    revokedBy: seedImportAuthSubjectValidator,
    reason: v.optional(v.string()),
    now: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const invitation = await ctx.db.get(args.invitationId);
    if (invitation === null) {
      throw new Error("Handoff invitation not found.");
    }

    if (invitation.state !== "active") {
      return { revoked: false as const, state: invitation.state };
    }

    const now = args.now ?? Date.now();
    const revokeReason = optionalAuditText(args.reason);
    await ctx.db.patch(invitation._id, {
      state: "revoked",
      revokedBy: args.revokedBy,
      revokedAt: now,
      ...(revokeReason !== undefined ? { revokeReason } : {}),
      updatedAt: now,
    });

    return { revoked: true as const, state: "revoked" as const };
  },
});

export const previewInvitation = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    let invitation: Doc<"seedHandoffInvitations"> | null;
    try {
      invitation = await getInvitationByToken(ctx, args.token);
    } catch {
      return { state: "invalid" as const };
    }
    const now = Date.now();

    if (invitation === null) {
      return { state: "invalid" as const };
    }

    if (invitation.state === "accepted") {
      const viewer = (await activeBrowserSessionOrNull(ctx))?.user ?? null;
      if (!canRevealAcceptedHandoffDestination(invitation.acceptedByUserId, viewer?._id)) {
        return { state: "accepted" as const };
      }
      if (invitation.profileId === undefined) {
        return { state: "invalid" as const };
      }
      const profile = await ctx.db.get(invitation.profileId);
      return profile !== null && profile.profileType === "person"
          ? {
            state: "accepted" as const,
            ownerDestination: ownerDestination(profile._id),
          }
        : { state: "invalid" as const };
    }

    if (invitation.state === "revoked") {
      return { state: "revoked" as const };
    }

    if (invitation.expiresAt <= now) {
      return { state: "expired" as const };
    }

    const [candidate, fields] = await Promise.all([
      ctx.db.get(invitation.candidateId),
      getOfferedFields(ctx, invitation),
    ]);

    if (candidate === null) {
      return { state: "invalid" as const };
    }

    try {
      assertPrivatePersonCandidate(candidate);
    } catch {
      return { state: "invalid" as const };
    }
    const batch = await ctx.db.get(candidate.batchId);
    if (!isHandoffBatchAvailable(batch)) {
      return { state: "invalid" as const };
    }

    // The same gate acceptance applies, asked here too. Without it a recipient
    // was shown a ready handoff with every offered field, on a profile that
    // `assertReusableConciergeProfile` would then refuse -- an invitation that
    // reads as usable and cannot be accepted is worse than one that says so.
    const preparedProfileId = invitation.profileId ?? candidate.matchedProfileId;

    if (preparedProfileId !== undefined) {
      const preparedProfile = await ctx.db.get(preparedProfileId);

      if (preparedProfile === null) {
        return { state: "invalid" as const };
      }

      // `assertReusableConciergeProfile` rather than a second spelling of the
      // same rule, in the try/catch shape this preview already uses for the
      // candidate: acceptance runs exactly this assertion, so the two cannot
      // drift into disagreeing about what is offerable.
      try {
        assertReusableConciergeProfile(preparedProfile);
      } catch {
        return { state: "invalid" as const };
      }
    }

    return {
      state: "ready" as const,
      displayName: candidate.proposedDisplayName,
      profileType: "person" as const,
      sourceName: batch?.sourceName,
      expiresAt: invitation.expiresAt,
      fields: fields
        .map(projectHandoffPreviewField)
        .filter((field) => field !== null),
    };
  },
});

async function createOrReuseConciergeProfile(
  ctx: MutationCtx,
  invitation: Doc<"seedHandoffInvitations">,
  candidate: Doc<"seedImportCandidateProfiles">,
  selectedFields: Doc<"seedImportCandidateFields">[],
  now: number,
) {
  const reusableProfileId = invitation.profileId ?? candidate.matchedProfileId;

  if (reusableProfileId !== undefined) {
    const profile = await ctx.db.get(reusableProfileId);
    if (profile === null) {
      throw new Error("Prepared concierge profile not found.");
    }
    assertReusableConciergeProfile(profile);
    const owner = await getActiveProfileOwner(ctx.db, profile._id);
    if (owner !== null) {
      throw new Error("Prepared concierge profile already has an active owner.");
    }

    await ctx.db.patch(profile._id, {
      ...buildConciergeProfileFieldPatch(selectedFields, profile),
      publicSurfacingState: "opted_out",
      publicSurfacingUpdatedAt: now,
      publicSurfacingReason: "Private concierge handoff accepted.",
      updatedAt: now,
    });
    const updated = await ctx.db.get(profile._id);
    if (updated === null || updated.profileType !== "person") {
      throw new Error("Unable to update concierge profile.");
    }
    return updated;
  }

  const slug = await findAvailableProfileSlug(
    ctx.db,
    candidate.proposedSlug ?? candidate.proposedDisplayName,
  );
  const fieldPatch = buildConciergeProfileFieldPatch(selectedFields);
  const profileId = await ctx.db.insert("profiles", {
    ...fieldPatch,
    slug,
    displayName: candidate.proposedDisplayName,
    sortName: createProfileSortName(candidate.proposedDisplayName),
    aliases: fieldPatch.aliases ?? [],
    tags: fieldPatch.tags ?? [],
    outboundLinks: fieldPatch.outboundLinks ?? [],
    claimState: "unclaimed",
    publicationState: "draft_private",
    publicSurfacingState: "opted_out",
    publicSurfacingUpdatedAt: now,
    publicSurfacingReason: "Private concierge handoff accepted.",
    creationSource: "concierge",
    updatedAt: now,
    profileType: "person",
    person: fieldPatch.person ?? { roleTags: [] },
  });
  const profile = await ctx.db.get(profileId);
  if (profile === null || profile.profileType !== "person") {
    throw new Error("Unable to create concierge profile.");
  }
  return profile;
}

export const acceptInvitation = mutation({
  args: {
    token: v.string(),
    selectedFieldIds: v.array(v.id("seedImportCandidateFields")),
  },
  handler: async (ctx, args) => {
    const [activeSession, invitation] = await Promise.all([
      requireActiveBrowserSessionSubject(ctx),
      getInvitationByToken(ctx, args.token),
    ]);
    const { subject: actor, user } = activeSession;

    if (
      user.email === undefined ||
      !(await identityEmailVerified(ctx))
    ) {
      throw new Error(
        "A verified email address is required before claim-level actions.",
      );
    }

    if (invitation === null) {
      throw new Error("Handoff invitation is unavailable.");
    }

    if (
      invitation.state === "accepted" &&
      invitation.acceptedByUserId === user._id &&
      invitation.profileId !== undefined
    ) {
      const profile = await ctx.db.get(invitation.profileId);
      if (profile !== null && profile.profileType === "person") {
        return {
          state: "already_accepted" as const,
          profileId: profile._id,
          claimState: profile.claimState,
          ownerDestination: ownerDestination(profile._id),
          profilePath: `/p/${profile.slug}`,
        };
      }
    }

    const now = Date.now();
    if (invitation.state !== "active" || invitation.expiresAt <= now) {
      throw new Error("Handoff invitation is unavailable.");
    }

    const candidate = await ctx.db.get(invitation.candidateId);
    if (candidate === null) {
      throw new Error("Handoff invitation is unavailable.");
    }
    assertPrivatePersonCandidate(candidate);
    const batch = await ctx.db.get(candidate.batchId);
    if (!isHandoffBatchAvailable(batch)) {
      throw new Error("Handoff invitation is unavailable.");
    }

    if (invitation.profileId !== candidate.matchedProfileId) {
      throw new Error("Handoff invitation is unavailable.");
    }

    const offeredFields = await getOfferedFields(ctx, invitation);
    if (offeredFields.some((field) => field.candidateId !== candidate._id)) {
      throw new Error("Handoff invitation is unavailable.");
    }
    const selectedFields = selectHandoffFields(offeredFields, args.selectedFieldIds);
    const profile = await createOrReuseConciergeProfile(
      ctx,
      invitation,
      candidate,
      selectedFields,
      now,
    );
    const claimRequestId = await ctx.db.insert("profileClaimRequests", {
      profileId: profile._id,
      profileSlug: profile.slug,
      profileType: "person",
      requestedDisplayName: profile.displayName,
      userId: user._id,
      method: "handoff_invitation",
      state: "approved",
      evidenceSource: "manual",
      evidenceSummary: "Verified-email account accepted a private concierge handoff invitation.",
      createdAt: now,
      updatedAt: now,
      reviewedAt: now,
    });
    const siblingInvitations = await ctx.db
      .query("seedHandoffInvitations")
      .withIndex("by_candidateId_state", (query) =>
        query.eq("candidateId", candidate._id).eq("state", "active"),
      )
      .collect();

    await approveProfileClaimForUser(ctx.db, {
      profile,
      profileId: profile._id,
      userId: user._id,
      grantedByClaimRequestId: claimRequestId,
      verified: false,
      now,
      actor,
      note: "Private concierge handoff granted claimed-unverified owner authority.",
    });

    await Promise.all([
      ...selectedFields.map((field) =>
        ctx.db.patch(field._id, {
          confidence: "owner_confirmed",
          reviewState: "accepted",
          reviewedBy: actor,
          reviewedAt: now,
          reviewNote: "Confirmed by the owner during private handoff acceptance.",
          updatedAt: now,
        }),
      ),
      ctx.db.patch(candidate._id, {
        matchedProfileId: profile._id,
        claimState: "claimed_unverified",
        updatedAt: now,
      }),
      ctx.db.patch(invitation._id, {
        profileId: profile._id,
        state: "accepted",
        acceptedByUserId: user._id,
        acceptedAt: now,
        updatedAt: now,
      }),
      ...siblingInvitations
        .filter((sibling) => sibling._id !== invitation._id)
        .map((sibling) =>
          ctx.db.patch(sibling._id, {
            state: "revoked",
            revokedBy: actor,
            revokedAt: now,
            revokeReason: "Superseded when another invitation for this candidate was accepted.",
            updatedAt: now,
          }),
        ),
    ]);

    const claimedProfile = await ctx.db.get(profile._id);
    return {
      state: "accepted" as const,
      claimRequestId,
      profileId: profile._id,
      claimState: claimedProfile?.claimState ?? "claimed_unverified",
      ownerDestination: ownerDestination(profile._id),
      profilePath: `/p/${profile.slug}`,
    };
  },
});
