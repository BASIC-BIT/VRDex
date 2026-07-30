import type { Doc } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { getPublicProfileMediaKit } from "./_profileAssets";
import { toProfileLookupResult } from "./_profileLookup";
import { canReadProfile } from "./_profilePermissions";
import { getProfileTrustLabel } from "./_profileStates";
import { firstSafePublicImageUrl } from "./_publicFields";
import {
  normalizeSearchQuery,
  sortSearchResults,
  toPublicSearchResult,
  type PublicSearchResult,
  type SearchEntityType,
} from "./_searchDocuments";

export type PublicSearchFilters = {
  entityType?: SearchEntityType;
  profileType?: "person" | "community";
};

export function publicSearchLookupAvatarUrl(
  result: Pick<PublicSearchResult, "imageUrl" | "profileImageUrl">,
): string | undefined {
  return firstSafePublicImageUrl(result.imageUrl, result.profileImageUrl);
}

export function publicSearchLookupUsesLogo(
  result: Pick<PublicSearchResult, "imageUrl" | "logoImageUrl" | "profileImageUrl">,
): boolean {
  return (
    result.logoImageUrl !== undefined &&
    result.imageUrl === result.logoImageUrl &&
    result.logoImageUrl !== result.profileImageUrl
  );
}

function boundedLimit(value: number | undefined, fallback: number, max: number): number {
  return Math.max(1, Math.min(value ?? fallback, max));
}

export async function projectPublicSearchResult(
  ctx: QueryCtx,
  document: Doc<"searchDocuments">,
  searchText: string | undefined,
): Promise<PublicSearchResult | null> {
  if (document.entityType !== "profile" || document.profileId === undefined) {
    return toPublicSearchResult(document, searchText);
  }

  const profile = await ctx.db.get(document.profileId);

  if (profile === null || !canReadProfile("public", profile)) {
    return null;
  }

  const mediaKit = await getPublicProfileMediaKit(ctx.db, profile);
  const result = toPublicSearchResult(document, searchText, mediaKit);
  const person = toProfileLookupResult(profile, {
    avatarImageUrl: publicSearchLookupAvatarUrl(result),
    ...(publicSearchLookupUsesLogo(result)
      ? {}
      : { avatarAppearance: mediaKit.avatarAppearance }),
    sourceLabel: result.source?.label,
  });

  return {
    ...result,
    trustLabel: getProfileTrustLabel(profile.claimState, profile.creationSource),
    ...(person === null ? {} : { person }),
    ...(profile.claimState === "unclaimed" ? { claimEligible: true } : {}),
  };
}

export async function searchPublicDocuments(
  ctx: QueryCtx,
  args: {
    query: string;
    limit?: number;
  } & PublicSearchFilters,
  options: { defaultLimit: number; maxLimit: number; takeMultiplier?: number },
): Promise<PublicSearchResult[]> {
  const searchText = normalizeSearchQuery(args.query);
  const limit = boundedLimit(args.limit, options.defaultLimit, options.maxLimit);

  if (!searchText) {
    return [];
  }

  const documents = await ctx.db
    .query("searchDocuments")
    .withSearchIndex("search_text", (search) => {
      const publicDocuments = search.search("searchText", searchText).eq("publicState", "public");
      const matchingEntity = args.entityType === undefined
        ? publicDocuments
        : publicDocuments.eq("entityType", args.entityType);

      return args.profileType === undefined
        ? matchingEntity
        : matchingEntity.eq("profileType", args.profileType);
    })
    .take(limit * (options.takeMultiplier ?? 2));

  const documentsByKey = new Map(
    documents.map((document) => [`${document.entityType}:${document.slug}`, document]),
  );
  const rankedDocuments = sortSearchResults(
    documents.map((document) => toPublicSearchResult(document, searchText)),
  );
  const projected: PublicSearchResult[] = [];
  let offset = 0;

  while (projected.length < limit && offset < rankedDocuments.length) {
    const batchSize = limit - projected.length;
    const batch = rankedDocuments.slice(offset, offset + batchSize);
    offset += batch.length;
    const batchResults = await Promise.all(
      batch.map((result) =>
        projectPublicSearchResult(
          ctx,
          documentsByKey.get(`${result.entityType}:${result.slug}`)!,
          searchText,
        ),
      ),
    );

    projected.push(
      ...batchResults.filter((result): result is PublicSearchResult => result !== null),
    );
  }

  return projected;
}
