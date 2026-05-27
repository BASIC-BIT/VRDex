import type { Doc } from "./_generated/dataModel";
import type { DatabaseReader, DatabaseWriter } from "./_generated/server";
import { optionalField, safeHttpsUrl } from "./_publicFields";
import { canReadProfile } from "./_profilePermissions";
import { getProfileBySlug } from "./_profileSlugs";
import {
  collectVocabularyKeys,
  createVocabularyCandidates,
  createVocabularyKey,
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
  source?: {
    sourceType: Doc<"searchDocuments">["sourceType"];
    label: string;
  };
  startsAt?: number;
  score: number;
};

type SearchDocumentInput = Omit<Doc<"searchDocuments">, "_id" | "_creationTime">;
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
  const shared = createVocabularyCandidates("profile_tag", profile.tags);

  if (profile.profileType === "person") {
    return [...shared, ...createVocabularyCandidates("person_role", profile.person.roleTags)];
  }

  return [
    ...shared,
    ...createVocabularyCandidates("community_subtype", [profile.community.subtype]),
    ...createVocabularyCandidates("community_category", profile.community.categoryTags),
  ];
}

export function createProfileSearchDocument(profile: Doc<"profiles">): SearchDocumentInput {
  const typeLabel = profile.profileType === "person" ? "Person profile" : "Community profile";
  const typeSpecific =
    profile.profileType === "person"
      ? profile.person.roleTags
      : compact([profile.community.subtype, ...profile.community.categoryTags]);
  const source = sourceForProfile(profile);
  const vocabulary = vocabularyForProfile(profile);

  return {
    entityType: "profile",
    publicState: publicStateForProfile(profile),
    profileId: profile._id,
    profileType: profile.profileType,
    slug: profile.slug,
    routePath: profile.profileType === "person" ? `/p/${profile.slug}` : `/c/${profile.slug}`,
    title: profile.displayName,
    subtitle: typeLabel,
    ...optionalField("summary", profile.headline ?? profile.bio),
    ...optionalField("imageUrl", safeHttpsUrl(profile.avatarImageUrl ?? profile.bannerImageUrl)),
    searchText: weightedCorpus([
      { values: [profile.displayName, profile.slug], weight: 8 },
      { values: profile.aliases, weight: 5 },
      { values: profile.tags, weight: 4 },
      { values: typeSpecific, weight: 4 },
      { values: [profile.headline, profile.bio, profile.region, profile.timezone, typeLabel], weight: 1 },
    ]),
    exactTokens: exactTokens([profile.displayName, profile.slug, ...profile.aliases, ...profile.tags, ...typeSpecific]),
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

    return options.hiddenProfileKeys !== undefined && !options.hiddenProfileKeys.has(key);
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
    routePath: `/w/${world.slug}`,
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
  const routePath = event.slug === undefined ? "/discover" : `/e/${event.slug}`;
  const isUpcoming = event.startAt >= Date.now();

  return {
    entityType: "event",
    publicState: event.publicationState === "published" && event.slug !== undefined ? "public" : "hidden",
    eventId: event._id,
    slug: event.slug ?? String(event._id),
    routePath,
    title: event.title,
    subtitle: event.communityName ?? context.community?.displayName ?? "Event",
    ...optionalField("summary", event.summary),
    ...optionalField("imageUrl", safeHttpsUrl(event.posterImageUrl)),
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

export function toPublicSearchResult(
  document: Doc<"searchDocuments">,
  query: string | undefined,
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

  return {
    entityType: document.entityType,
    ...optionalField("profileType", document.profileType),
    slug: document.slug,
    routePath: document.routePath,
    title: document.title,
    ...optionalField("subtitle", document.subtitle),
    ...optionalField("summary", document.summary),
    ...optionalField("imageUrl", document.imageUrl),
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
