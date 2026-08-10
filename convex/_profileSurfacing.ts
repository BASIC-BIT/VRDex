import type { Doc } from "./_generated/dataModel";
import type { DatabaseWriter } from "./_generated/server";
import {
  createProfileSearchDocument,
  upsertSearchDocument,
  vocabularyForProfile,
} from "./_searchDocuments";
import { recordVocabularyTerms, releaseVocabularyTerms } from "./_vocabulary";

export type ProfileReindexKey = {
  profileType: Doc<"profiles">["profileType"];
  profileSlug: string;
};

export type HiddenSurfacingState = Exclude<
  Doc<"profiles">["publicSurfacingState"],
  "public"
>;

/**
 * Whether a profile is currently readable by the public.
 *
 * The one definition, so a new hidden state is hidden everywhere by adding a
 * literal rather than by finding every comparison. `canReadProfile` and the seed
 * pipeline's `isPubliclyReadableProfile` both ask this question, and both used
 * to spell it out inline -- which is why adding `archived` needed this first.
 */
export function isPubliclySurfaced(
  profile: Pick<Doc<"profiles">, "publicSurfacingState"> &
    // Optional because the seed queue gate's callers do not all load it, and its
    // absence has to read as "not known to be published" rather than as
    // published.
    Partial<Pick<Doc<"profiles">, "publicationState">>,
): boolean {
  return profile.publicationState === "published" && profile.publicSurfacingState === "public";
}

/**
 * Take a profile off every public surface, or put it back.
 *
 * Hiding a profile is four things, not one: the state, the search document, the
 * vocabulary terms it contributed to discovery, and the worlds whose stored
 * search text still carries its display name. Suppression did all four; archival
 * needs the identical four, and the fourth is the one that looks optional and
 * leaves a retracted name searchable through its world credits when skipped.
 *
 * Returns the reindex key when the caller has work to schedule, so a page of
 * profiles can be covered by one world scan instead of one per profile.
 */
export async function setProfileSurfacing(
  db: DatabaseWriter,
  profile: Doc<"profiles">,
  next: {
    state: Doc<"profiles">["publicSurfacingState"];
    reason: string;
    now: number;
  },
): Promise<ProfileReindexKey | null> {
  // Snapshotted before the patch: `vocabularyForProfile` reads the visible
  // fields, and after the state change there are none to read. Empty when the
  // profile was already hidden, because it contributed nothing to release.
  const vocabularyBefore = isPubliclySurfaced(profile) ? vocabularyForProfile(profile) : [];

  await db.patch(profile._id, {
    publicSurfacingState: next.state,
    publicSurfacingUpdatedAt: next.now,
    // Only while the profile is hidden. The field explains why a row is off the
    // public surfaces, so carrying a restoration note on a public profile leaves
    // current-state metadata that contradicts the state -- and seed publication
    // already clears it on the same transition. The note is not lost: the
    // `profile_unarchived` audit event keeps it, which is where a past decision
    // belongs.
    publicSurfacingReason: next.state === "public" ? undefined : next.reason,
    updatedAt: next.now,
  });

  const updated = await db.get(profile._id);

  if (updated === null) {
    return null;
  }

  await upsertSearchDocument(db, createProfileSearchDocument(updated));

  // Both directions, because this moves profiles back as well as away. Releasing
  // alone was right while the only caller hid profiles permanently; for a
  // reversible state it left a restored profile searchable with its discovery
  // facets missing, and a later reindex reads the retained vocabulary keys as
  // references that already exist and never increments them.
  if (isPubliclySurfaced(updated)) {
    await recordVocabularyTerms(db, vocabularyForProfile(updated), next.now);
  } else {
    await releaseVocabularyTerms(db, vocabularyBefore, next.now);
  }

  return { profileType: updated.profileType, profileSlug: updated.slug };
}
