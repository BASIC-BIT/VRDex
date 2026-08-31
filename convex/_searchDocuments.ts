import type { Doc } from "./_generated/dataModel";
import type { DatabaseReader, DatabaseWriter } from "./_generated/server";
import type { PublicProfileMediaKit } from "./_profileAssets";
import { eventPathForSlugs } from "./_eventPaths";
import type { toProfileLookupResult } from "./_profileLookup";
import { visibleProfileField, visibleProfileList } from "./_profileFieldVisibility";
import { firstSafeHttpsUrl, optionalField, safeHttpsUrl } from "./_publicFields";
import { canReadProfile } from "./_profilePermissions";
import type { ProfileTrustLabel } from "./_profileStates";
import { getProfileBySlug } from "./_profileSlugs";
import {
  collectVocabularyKeys,
  createVocabularyCandidates,
  createVocabularyKey,
  recordVocabularyTerms,
  releaseVocabularyKeys,
  type VocabularyCandidate,
} from "./_vocabulary";

export type SearchEntityType = Doc<"searchDocuments">["entityType"];
export type PublicSearchResult = {
  entityType: SearchEntityType;
  profileType?: "person" | "community";
  slug: string;
  routePath: string;
  title: string;
  subtitle?: string;
  summary?: string;
  imageUrl?: string;
  profileImageUrl?: string;
  logoImageUrl?: string;
  avatarAppearance?: PublicProfileMediaKit["avatarAppearance"];
  trustLabel?: ProfileTrustLabel;
  source?: {
    sourceType: Doc<"searchDocuments">["sourceType"];
    label: string;
  };
  person?: NonNullable<ReturnType<typeof toProfileLookupResult>>;
  claimEligible?: boolean;
  startsAt?: number;
  score: number;
};

type SearchDocumentInput = Omit<Doc<"searchDocuments">, "_id" | "_creationTime">;
type ProfileGenre = NonNullable<Doc<"profiles">["genres"]>[number];
type WorldSearchDocumentOptions = {
  hiddenProfileKeys?: Set<string>;
};

const ENTITY_TYPE_WEIGHT: Record<SearchEntityType, number> = {
  event: 18,
  profile: 12,
  world: 10,
};

function normalizeInlineText(input: string | undefined): string {
  return (input ?? "").trim().replace(/\s+/g, " ");
}

export function normalizeSearchQuery(input: string): string {
  return normalizeInlineText(input).slice(0, 120);
}

export function createSearchToken(input: string): string {
  return createVocabularyKey(input).replace(/_/g, " ");
}

function compact<T>(values: Array<T | undefined>): T[] {
  return values.filter((value): value is T => value !== undefined);
}

function weightedCorpus(groups: Array<{ values: Array<string | undefined>; weight: number }>): string {
  const parts: string[] = [];

  for (const group of groups) {
    for (const value of group.values) {
      const text = normalizeInlineText(value);
      if (!text) {
        continue;
      }

      for (let index = 0; index < group.weight; index += 1) {
        parts.push(text);
      }
    }
  }

  return parts.join(" ").slice(0, 8_000);
}

function exactTokens(values: Array<string | undefined>): string[] {
  const tokens = new Set<string>();

  for (const value of values) {
    const token = createSearchToken(value ?? "");
    if (token) {
      tokens.add(token);
    }
  }

  return [...tokens].sort();
}

function visibleProfileGenres(profile: Doc<"profiles">): ProfileGenre[] {
  return visibleProfileList(profile, "genres", profile.genres ?? [], "discovery");
}

function profileGenreSearchLabels(genres: ProfileGenre[]): string[] {
  return genres.flatMap((genre) =>
    compact([genre.displayName, genre.displayLabel, ...(genre.aliases ?? [])]),
  );
}

function trustRankForProfile(profile: Doc<"profiles">): number {
  if (profile.claimState === "claimed_verified") {
    return 40;
  }

  if (profile.claimState === "claimed_unverified") {
    return 28;
  }

  if (profile.creationSource === "community") {
    return 10;
  }

  return 8;
}

function publicStateForProfile(profile: Doc<"profiles">): Doc<"searchDocuments">["publicState"] {
  return canReadProfile("public", profile) ? "public" : "hidden";
}

function publicProfileImageUrl(profile: Doc<"profiles">): string | undefined {
  return (
    safeHttpsUrl(visibleProfileField(profile, "avatarImageUrl", profile.avatarImageUrl, "discovery")) ??
    safeHttpsUrl(visibleProfileField(profile, "bannerImageUrl", profile.bannerImageUrl, "discovery"))
  );
}

function effectiveFeaturedRank(document: Doc<"searchDocuments">): number {
  if (document.entityType === "event" && document.startsAt !== undefined && document.startsAt < Date.now()) {
    return Math.min(document.featuredRank, 8);
  }

  return document.featuredRank;
}

function sourceForProfile(profile: Doc<"profiles">): Pick<SearchDocumentInput, "sourceType" | "sourceLabel"> {
  if (profile.creationSource === "community") {
    return {
      sourceType: "community",
      sourceLabel: "Community submitted",
    };
  }

  if (profile.creationSource === "import") {
    return {
      sourceType: "import",
      sourceLabel: "Imported profile seed",
    };
  }

  if (profile.creationSource === "moderator") {
    return {
      sourceType: "moderator",
      sourceLabel: "Moderator curated",
    };
  }

  return {
    sourceType: "owner",
    sourceLabel: "Owner-authored",
  };
}

export function vocabularyForProfile(profile: Doc<"profiles">): VocabularyCandidate[] {
  const shared = createVocabularyCandidates(
    "profile_tag",
    visibleProfileList(profile, "tags", profile.tags, "discovery"),
  );
  const genres = visibleProfileGenres(profile).map((genre) => ({
    scope: "profile_genre" as const,
    label: genre.displayName,
    aliases: compact([genre.displayLabel, ...(genre.aliases ?? [])]),
  }));

  if (profile.profileType === "person") {
    return [
      ...shared,
      ...genres,
      ...createVocabularyCandidates(
        "person_role",
        visibleProfileList(profile, "personRoleTags", profile.person.roleTags, "discovery"),
      ),
    ];
  }

  return [
    ...shared,
    ...genres,
    ...createVocabularyCandidates("community_subtype", [
      visibleProfileField(profile, "communitySubtype", profile.community.subtype, "discovery"),
    ]),
    ...createVocabularyCandidates(
      "community_category",
      visibleProfileList(profile, "communityCategoryTags", profile.community.categoryTags, "discovery"),
    ),
  ];
}

export function createProfileSearchDocument(profile: Doc<"profiles">): SearchDocumentInput {
  const typeLabel = profile.profileType === "person" ? "Person profile" : "Community profile";
  const aliases = visibleProfileList(profile, "aliases", profile.aliases, "discovery");
  const searchAliases = profile.searchAliases ?? [];
  const tags = visibleProfileList(profile, "tags", profile.tags, "discovery");
  const genres = visibleProfileGenres(profile);
  const genreLabels = profileGenreSearchLabels(genres);
  const headline = visibleProfileField(profile, "headline", profile.headline, "discovery");
  const bio = visibleProfileField(profile, "bio", profile.bio, "discovery");
  const region = visibleProfileField(profile, "region", profile.region, "discovery");
  const timezone = visibleProfileField(profile, "timezone", profile.timezone, "discovery");
  const typeSpecific =
    profile.profileType === "person"
      ? visibleProfileList(profile, "personRoleTags", profile.person.roleTags, "discovery")
      : compact([
          visibleProfileField(profile, "communitySubtype", profile.community.subtype, "discovery"),
          ...visibleProfileList(
            profile,
            "communityCategoryTags",
            profile.community.categoryTags,
            "discovery",
          ),
        ]);
  const source = sourceForProfile(profile);
  const vocabulary = vocabularyForProfile(profile);

  return {
    entityType: "profile",
    publicState: publicStateForProfile(profile),
    profileId: profile._id,
    profileType: profile.profileType,
    slug: profile.slug,
    routePath: `/${profile.slug}`,
    title: profile.displayName,
    subtitle: typeLabel,
    ...optionalField("summary", headline ?? bio),
    ...optionalField("imageUrl", publicProfileImageUrl(profile)),
    searchText: weightedCorpus([
      { values: [profile.displayName, profile.slug], weight: 8 },
      { values: aliases, weight: 5 },
      { values: searchAliases, weight: 5 },
      { values: genreLabels, weight: 5 },
      { values: tags, weight: 4 },
      { values: typeSpecific, weight: 4 },
      { values: [headline, bio, region, timezone, typeLabel], weight: 1 },
    ]),
    exactTokens: exactTokens([
      profile.displayName,
      profile.slug,
      ...aliases,
      ...searchAliases,
      ...genreLabels,
      ...tags,
      ...typeSpecific,
    ]),
    vocabularyKeys: collectVocabularyKeys(vocabulary),
    trustRank: trustRankForProfile(profile),
    featuredRank: trustRankForProfile(profile),
    sourceType: source.sourceType,
    sourceLabel: source.sourceLabel,
    updatedAt: profile.updatedAt,
  };
}

function worldAttributionKey(attribution: Doc<"worlds">["creatorAttributions"][number]): string | undefined {
  if (!attribution.profileSlug || !attribution.profileType) {
    return undefined;
  }

  return `${attribution.profileType}:${attribution.profileSlug}`;
}

function searchableWorldAttributions(
  world: Doc<"worlds">,
  options: WorldSearchDocumentOptions = {},
): Doc<"worlds">["creatorAttributions"] {
  return world.creatorAttributions.filter((attribution) => {
    const key = worldAttributionKey(attribution);

    if (key === undefined) {
      return true;
    }

    return options.hiddenProfileKeys === undefined || !options.hiddenProfileKeys.has(key);
  });
}

export async function getHiddenWorldAttributionProfileKeys(db: DatabaseReader, world: Doc<"worlds">) {
  const keys = new Set<string>();

  await Promise.all(
    world.creatorAttributions.map(async (attribution) => {
      const key = worldAttributionKey(attribution);

      if (key === undefined || attribution.profileSlug === undefined) {
        return;
      }

      const profile = await getProfileBySlug(db, attribution.profileSlug);
      if (profile === null || !canReadProfile("public", profile)) {
        keys.add(key);
      }
    }),
  );

  return keys;
}

export function vocabularyForWorld(
  world: Doc<"worlds">,
  options: WorldSearchDocumentOptions = {},
): VocabularyCandidate[] {
  const attributions = searchableWorldAttributions(world, options);

  return [
    ...createVocabularyCandidates("world_tag", world.tags),
    ...createVocabularyCandidates(
      "world_creator_role",
      attributions.map((attribution) => attribution.role),
    ),
  ];
}

export function createWorldSearchDocument(
  world: Doc<"worlds">,
  options: WorldSearchDocumentOptions = {},
): SearchDocumentInput {
  const source = world.sourceAttribution;
  const attributions = searchableWorldAttributions(world, options);
  const creatorNames = attributions.map((attribution) => attribution.displayName);
  const creatorRoles = attributions.map((attribution) => attribution.role);
  const vocabulary = vocabularyForWorld(world, options);

  return {
    entityType: "world",
    publicState: world.publicationState === "published" ? "public" : "hidden",
    worldId: world._id,
    slug: world.slug,
    routePath: `/${world.slug}`,
    title: world.displayName,
    subtitle: "World",
    ...optionalField("summary", world.summary ?? world.description),
    ...optionalField("imageUrl", safeHttpsUrl(world.heroImageUrl ?? world.media[0]?.url)),
    searchText: weightedCorpus([
      { values: [world.displayName, world.slug, world.vrchatWorldId], weight: 8 },
      { values: world.tags, weight: 5 },
      { values: creatorNames, weight: 4 },
      { values: creatorRoles, weight: 3 },
      { values: [world.summary, world.description, world.visibilityStatus], weight: 1 },
    ]),
    exactTokens: exactTokens([world.displayName, world.slug, world.vrchatWorldId, ...world.tags, ...creatorNames]),
    vocabularyKeys: collectVocabularyKeys(vocabulary),
    trustRank: source?.sourceType === "owner" ? 34 : source?.sourceType === "partner" ? 24 : 14,
    featuredRank: 20,
    sourceType: source?.sourceType ?? "manual",
    sourceLabel: source?.label ?? "VRDex world record",
    updatedAt: world.updatedAt,
  };
}

export function vocabularyForEvent(event: Doc<"events">, roleLabels: string[] = []): VocabularyCandidate[] {
  const inferredTags = [event.communityName, event.timezone, event.startAt >= Date.now() ? "Upcoming" : undefined];

  return [
    ...createVocabularyCandidates("event_tag", inferredTags),
    ...createVocabularyCandidates("event_participant_role", roleLabels),
  ];
}

export function createEventSearchDocument(
  event: Doc<"events">,
  context: { community?: Doc<"profiles">; world?: Doc<"worlds">; roleLabels?: string[] } = {},
): SearchDocumentInput {
  const sourceUrl = safeHttpsUrl(event.sourceUrl);
  const vocabulary = vocabularyForEvent(event, context.roleLabels ?? []);
  const worldTerms = context.world ? [context.world.displayName, ...context.world.tags] : [];
  const routePath = event.slug === undefined || context.community === undefined
    ? "/"
    : eventPathForSlugs(context.community.slug, event.slug);
  const isUpcoming = event.startAt >= Date.now();

  return {
    entityType: "event",
    publicState:
      event.publicationState === "published" &&
      event.eventStatus === "scheduled" &&
      event.slug !== undefined &&
      context.community !== undefined
        ? "public"
        : "hidden",
    eventId: event._id,
    slug: event.slug ?? String(event._id),
    routePath,
    title: event.title,
    subtitle: event.communityName ?? context.community?.displayName ?? "Event",
    ...optionalField("summary", event.summary),
    ...optionalField("imageUrl", firstSafeHttpsUrl(event.thumbnailImageUrl, event.posterImageUrl, event.bannerImageUrl)),
    searchText: weightedCorpus([
      { values: [event.title, event.slug], weight: 8 },
      { values: [event.communityName, context.community?.displayName], weight: 5 },
      { values: worldTerms, weight: 4 },
      { values: context.roleLabels ?? [], weight: 3 },
      { values: [event.summary, event.notes, event.timezone, sourceUrl], weight: 1 },
    ]),
    exactTokens: exactTokens([
      event.title,
      event.slug,
      event.communityName,
      context.community?.displayName,
      ...worldTerms,
      ...(context.roleLabels ?? []),
    ]),
    vocabularyKeys: collectVocabularyKeys(vocabulary),
    trustRank: event.sourceType === "manual" ? 30 : event.sourceType === "community" ? 20 : 16,
    freshnessAt: event.startAt,
    featuredRank: isUpcoming ? 42 : 8,
    sourceType: event.sourceType,
    sourceLabel: event.sourceLabel,
    startsAt: event.startAt,
    updatedAt: event.updatedAt,
  };
}

export async function reindexEventSearchDocument(
  db: DatabaseWriter,
  event: Doc<"events">,
  context: { community?: Doc<"profiles">; world?: Doc<"worlds">; roleLabels?: string[] } = {},
  now: number,
) {
  const existingDocument = await db
    .query("searchDocuments")
    .withIndex("by_eventId", (query) => query.eq("eventId", event._id))
    .unique();
  const nextDocument = createEventSearchDocument(event, context);
  const beforeKeys = new Set(
    existingDocument?.publicState === "public" ? (existingDocument.vocabularyKeys ?? []) : [],
  );
  const afterKeys = new Set(
    nextDocument.publicState === "public" ? (nextDocument.vocabularyKeys ?? []) : [],
  );

  await upsertSearchDocument(db, nextDocument);

  const addedCandidates = new Map<string, VocabularyCandidate>();
  const retainedCandidates = new Map<string, VocabularyCandidate>();
  if (nextDocument.publicState === "public") {
    for (const candidate of vocabularyForEvent(event, context.roleLabels ?? [])) {
      const scopedKey = `${candidate.scope}:${createVocabularyKey(candidate.label ?? "")}`;
      const into = beforeKeys.has(scopedKey) ? retainedCandidates : addedCandidates;
      if (!into.has(scopedKey)) into.set(scopedKey, candidate);
    }
  }

  await recordVocabularyTerms(db, [...addedCandidates.values()], now);
  await recordVocabularyTerms(db, [...retainedCandidates.values()], now, {
    incrementUsage: false,
  });

  const removedKeys = [...beforeKeys].filter((key) => !afterKeys.has(key));
  if (removedKeys.length > 0) await releaseVocabularyKeys(db, removedKeys, now);
}

export function toPublicSearchResult(
  document: Doc<"searchDocuments">,
  query: string | undefined,
  mediaKit?: PublicProfileMediaKit,
): PublicSearchResult {
  const queryToken = createSearchToken(query ?? "");
  const exactBoost = queryToken && document.exactTokens.includes(queryToken) ? 200 : 0;
  const vocabularyBoost = queryToken
    ? document.vocabularyKeys.some((key) => key.endsWith(`:${queryToken.replace(/\s+/g, "_")}`))
      ? 80
      : 0
    : 0;
  const freshnessBoost = document.startsAt && document.startsAt >= Date.now() ? 30 : 0;
  const score =
    exactBoost +
    vocabularyBoost +
    freshnessBoost +
    document.trustRank +
    effectiveFeaturedRank(document) +
    ENTITY_TYPE_WEIGHT[document.entityType];

  const profileImageUrl = mediaKit?.profileImage?.imageUrl;
  const logoImageUrl = mediaKit?.primaryLogo?.imageUrl;
  const preferredProfileImageUrl =
    mediaKit?.compactDisplay === "logo" ? logoImageUrl ?? profileImageUrl : profileImageUrl ?? logoImageUrl;
  const imageUrl = document.entityType === "profile" ? preferredProfileImageUrl ?? document.imageUrl : document.imageUrl;

  return {
    entityType: document.entityType,
    ...optionalField("profileType", document.profileType),
    slug: document.slug,
    // Profiles and worlds still derive their root path so documents indexed under
    // retired prefixes do not keep dead links. Event paths carry community context,
    // so their indexed route must be preserved.
    //
    // Slugless events keep `String(event._id)` as their slug, but the constructor
    // marks those `hidden`, so they never reach this public projection.
    routePath: document.entityType === "event" ? document.routePath : `/${document.slug}`,
    title: document.title,
    ...optionalField("subtitle", document.subtitle),
    ...optionalField("summary", document.summary),
    ...optionalField("imageUrl", imageUrl),
    ...optionalField("profileImageUrl", profileImageUrl),
    ...optionalField("logoImageUrl", logoImageUrl),
    ...(document.entityType === "profile" && mediaKit
      ? { avatarAppearance: mediaKit.avatarAppearance }
      : {}),
    ...optionalField("startsAt", document.startsAt),
    source:
      document.sourceType && document.sourceLabel
        ? { sourceType: document.sourceType, label: document.sourceLabel }
        : undefined,
    score,
  };
}

export function sortSearchResults(results: PublicSearchResult[]): PublicSearchResult[] {
  return [...results].sort((first, second) => {
    if (second.score !== first.score) {
      return second.score - first.score;
    }

    return first.title.localeCompare(second.title);
  });
}

export async function upsertSearchDocument(db: DatabaseWriter, input: SearchDocumentInput) {
  const existingById = input.profileId
    ? await db
        .query("searchDocuments")
        .withIndex("by_profileId", (query) => query.eq("profileId", input.profileId))
        .unique()
    : input.worldId
      ? await db
          .query("searchDocuments")
          .withIndex("by_worldId", (query) => query.eq("worldId", input.worldId))
          .unique()
      : input.eventId
        ? await db
            .query("searchDocuments")
            .withIndex("by_eventId", (query) => query.eq("eventId", input.eventId))
            .unique()
        : null;

  if (existingById) {
    await db.patch(existingById._id, input);
    return existingById._id;
  }

  const existing = await db
    .query("searchDocuments")
    .withIndex("by_entityType_slug", (query) =>
      query.eq("entityType", input.entityType).eq("slug", input.slug),
    )
    .unique();

  if (existing) {
    await db.patch(existing._id, input);
    return existing._id;
  }

  return await db.insert("searchDocuments", input);
}

/**
 * Rebuild one profile's search document and reconcile its vocabulary as a delta.
 *
 * The profile counterpart of `reindexWorldSearchDocument`, for the same reason:
 * `recordVocabularyTerms` only increments, so a path that replays a profile's
 * whole vocabulary on every write inflates counts for terms nothing touched, and
 * never releases the ones an edit removed. Editing tags through the profile
 * editor did exactly that -- discovery dropped the old value while its
 * `usageCount` kept the reference for good.
 *
 * The stored document's `vocabularyKeys` are the "before" set rather than a
 * snapshot the caller takes, so no caller can forget to take one and a profile
 * that has never been indexed starts from empty on its own.
 */
export async function reindexProfileSearchDocument(
  db: DatabaseWriter,
  profile: Doc<"profiles">,
  now: number,
) {
  const existingDocument = await db
    .query("searchDocuments")
    .withIndex("by_profileId", (query) => query.eq("profileId", profile._id))
    .unique();
  const nextDocument = createProfileSearchDocument(profile);
  // A hidden profile contributes nothing in either direction. Its document
  // keeps `vocabularyKeys` after suppression has already released those terms,
  // so treating them as live would release them a second time -- decrementing
  // counts for terms other, still-public profiles are using. Republishing
  // records the whole set again, which is where they come back.
  const isPublic = canReadProfile("public", profile);
  const beforeKeys = new Set(isPublic ? (existingDocument?.vocabularyKeys ?? []) : []);
  const afterKeys = new Set(isPublic ? (nextDocument.vocabularyKeys ?? []) : []);

  await upsertSearchDocument(db, nextDocument);

  // Deduplicated by scoped key before recording, same as the world path: two
  // candidates can share one key, the document stores it once, and recording
  // both would increment twice against a single later release.
  //
  // Nothing is recorded for a profile the public cannot read. `vocabularyForProfile`
  // honours per-field visibility but knows nothing about surfacing state, so an
  // opted-out or suppressed profile would otherwise push its tags into the
  // discovery term list while its own search document stayed hidden -- a term
  // offered to everyone, sourced from a record withdrawn from everyone.
  const addedCandidates = new Map<string, VocabularyCandidate>();
  // Keys this profile already held, split out rather than skipped. Two spellings
  // canonicalize to one key -- "Drum & Bass" and "Drum and Bass" -- so correcting
  // one is a label change with nothing to add to the count. Dropping the
  // candidate entirely left the search document carrying the corrected text while
  // `vocabularyTerms.label` kept the old wording, and discovery reads the term
  // list, so the correction never reached the surface it was made for.
  const retainedCandidates = new Map<string, VocabularyCandidate>();

  if (isPublic) {
    for (const candidate of vocabularyForProfile(profile)) {
      const scopedKey = `${candidate.scope}:${createVocabularyKey(candidate.label ?? "")}`;
      const into = beforeKeys.has(scopedKey) ? retainedCandidates : addedCandidates;

      if (!into.has(scopedKey)) {
        into.set(scopedKey, candidate);
      }
    }
  }

  await recordVocabularyTerms(db, [...addedCandidates.values()], now);
  await recordVocabularyTerms(db, [...retainedCandidates.values()], now, {
    incrementUsage: false,
  });

  const removedKeys = [...beforeKeys].filter((key) => !afterKeys.has(key));

  if (removedKeys.length > 0) {
    await releaseVocabularyKeys(db, removedKeys, now);
  }
}

/**
 * Rebuild one world's search document and reconcile its vocabulary as a delta.
 *
 * `recordVocabularyTerms` increments unconditionally, so replaying a world's whole
 * vocabulary on every rebuild inflates counts for terms nothing changed. Comparing
 * the stored document's `vocabularyKeys` against the rebuilt ones records only what
 * appeared and releases only what went away, which is what makes a rebuild safe to
 * run repeatedly.
 */
export async function reindexWorldSearchDocument(
  db: DatabaseWriter,
  world: Doc<"worlds">,
  now: number,
) {
  const hiddenProfileKeys = await getHiddenWorldAttributionProfileKeys(db, world);
  const existingDocument = await db
    .query("searchDocuments")
    .withIndex("by_worldId", (query) => query.eq("worldId", world._id))
    .unique();
  const nextDocument = createWorldSearchDocument(world, { hiddenProfileKeys });
  const beforeKeys = new Set(existingDocument?.vocabularyKeys ?? []);
  const afterKeys = new Set(nextDocument.vocabularyKeys ?? []);

  await upsertSearchDocument(db, nextDocument);

  // Deduplicated by scoped key before recording. Two attributions sharing a role
  // produce two candidates for one key, and the document stores that key once, so
  // recording both would increment twice while a later release decrements once --
  // permanently inflating the term.
  const addedCandidates = new Map<string, VocabularyCandidate>();
  // Retained keys reconciled rather than skipped, the same as the profile path
  // above and for the same reason: a spelling correction that keeps the key is a
  // label change, and dropping it left discovery showing the old wording.
  const retainedCandidates = new Map<string, VocabularyCandidate>();

  for (const candidate of vocabularyForWorld(world, { hiddenProfileKeys })) {
    const scopedKey = `${candidate.scope}:${createVocabularyKey(candidate.label ?? "")}`;
    const into = beforeKeys.has(scopedKey) ? retainedCandidates : addedCandidates;

    if (!into.has(scopedKey)) {
      into.set(scopedKey, candidate);
    }
  }

  await recordVocabularyTerms(db, [...addedCandidates.values()], now);
  await recordVocabularyTerms(db, [...retainedCandidates.values()], now, {
    incrementUsage: false,
  });

  const removedKeys = [...beforeKeys].filter((key) => !afterKeys.has(key));

  if (removedKeys.length > 0) {
    await releaseVocabularyKeys(db, removedKeys, now);
  }
}
