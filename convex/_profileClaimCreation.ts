import type { AuthSubject } from "./_communityAuthority";
import type { Id } from "./_generated/dataModel";
import type { DatabaseWriter } from "./_generated/server";
import { approveProfileClaimForUser } from "./_profileOwnership";
import { claimError } from "./_claimErrors";
import { createProfileSlugBase, findAvailableProfileSlug } from "./_profileSlugs";
import {
  type CommunitySubmissionProfileInput,
  sanitizeCommunitySubmissionProfileInput,
} from "./_profileSubmissions";
import { createProfileSearchDocument, upsertSearchDocument, vocabularyForProfile } from "./_searchDocuments";
import { hasAcceptedSuppression } from "./_suppressions";
import { ensureShortLinkForTarget } from "./_shortLinks";
import { recordVocabularyTerms } from "./_vocabulary";

type CreateClaimedDiscordProfileOptions = {
  userId: Id<"users">;
  discordProviderAccountId: string;
  input: CommunitySubmissionProfileInput;
  now: number;
  actor?: AuthSubject;
};

export async function createClaimedDiscordProfileForUser(
  db: DatabaseWriter,
  options: CreateClaimedDiscordProfileOptions,
) {
  // Owner-authored: this path only runs for a verified user who confirmed no
  // existing profile matches, and it hands them ownership in the same call.
  const input = sanitizeCommunitySubmissionProfileInput(options.input, {
    linkSource: "owner_authored",
  });
  const now = options.now;
  const slug = await findAvailableProfileSlug(db, input.displayName);

  // Claim creation inserts published/public directly, so it is another way to put
  // a retracted identity back in front of people: a verified user with a linked
  // Discord account can declare no suitable match and recreate it.
  // Structured rather than a plain Error: Convex redacts plain messages in
  // production, so a claim client would otherwise be told to try again for a
  // permanent safety rejection.
  if (
    await hasAcceptedSuppression(db, {
      slugs: [createProfileSlugBase(input.displayName), slug],
      displayNames: [input.displayName, ...input.aliases],
      profileType: input.profileType,
    })
  ) {
    throw claimError("IDENTITY_SUPPRESSED");
  }

  const sharedFields = {
    slug,
    displayName: input.displayName,
    sortName: input.sortName,
    aliases: input.aliases,
    tags: input.tags,
    outboundLinks: input.outboundLinks,
    claimState: "unclaimed" as const,
    publicationState: "published" as const,
    publicSurfacingState: "public" as const,
    publicSurfacingUpdatedAt: now,
    creationSource: "self" as const,
    publishedAt: now,
    updatedAt: now,
  };
  const profileId = await db.insert(
    "profiles",
    input.profileType === "person"
      ? {
          ...sharedFields,
          profileType: "person",
          person: {
            roleTags: input.person.roleTags,
          },
        }
      : {
          ...sharedFields,
          profileType: "community",
          community: input.community,
        },
  );
  const profile = await db.get(profileId);

  if (profile === null) {
    throw new Error("Unable to create claimed profile.");
  }

  const claimRequestId = await db.insert("profileClaimRequests", {
    profileId,
    profileSlug: slug,
    profileType: input.profileType,
    requestedDisplayName: input.displayName,
    userId: options.userId,
    method: input.profileType === "person" ? "discord_person" : "discord_community",
    state: "approved",
    evidenceSource: "discord_api",
    evidenceSummary: `Linked Discord account ${options.discordProviderAccountId} created and claimed ${input.profileType} profile.`,
    createdAt: now,
    updatedAt: now,
    verifiedAt: now,
    reviewedAt: now,
  });

  await approveProfileClaimForUser(db, {
    profile,
    profileId,
    userId: options.userId,
    grantedByClaimRequestId: claimRequestId,
    verified: false,
    now,
    ...(options.actor !== undefined ? { actor: options.actor } : {}),
    note: "Discord linked-account profile creation grants owner control without stronger profile verification.",
  });

  const [updatedProfile, shortLink] = await Promise.all([
    db.get(profileId),
    ensureShortLinkForTarget(db, { targetType: "profile", targetId: profileId }, now),
  ]);
  const finalProfile = updatedProfile ?? profile;

  await Promise.all([
    upsertSearchDocument(db, createProfileSearchDocument(finalProfile)),
    recordVocabularyTerms(db, vocabularyForProfile(finalProfile), now),
  ]);

  return {
    claimRequestId,
    profileId,
    profileType: input.profileType,
    slug,
    claimState: finalProfile.claimState,
    profilePath: `/${slug}`,
    shortLinkCode: shortLink.code,
    shortLinkPath: shortLink.shortLinkPath,
  };
}
