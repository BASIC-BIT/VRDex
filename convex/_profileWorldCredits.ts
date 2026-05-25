import type { Doc } from "./_generated/dataModel";
import type { DatabaseReader } from "./_generated/server";

const PROFILE_WORLD_CREDIT_LIMIT = 6;
const PROFILE_WORLD_CREDIT_QUERY_LIMIT = 50;

type ProfileType = "person" | "community";
type WorldCreatorRole =
  | "world_author"
  | "builder"
  | "venue_operator"
  | "community_operator"
  | "media_credit"
  | "storefront_owner";

export type PublicProfileWorldCredit = {
  slug: string;
  displayName: string;
  roles: WorldCreatorRole[];
  tags: string[];
  summary?: string;
  sourceLabel?: string;
};

type ProfileReference = {
  profileType: ProfileType;
  slug: string;
};

type ProfileWorldCreditRecord = {
  credit: Doc<"worldProfileCredits">;
  world: Doc<"worlds">;
};

function optionalField<T>(key: string, value: T | undefined): Record<string, T> {
  return value === undefined ? {} : { [key]: value };
}

export function createPublicProfileWorldCredits(
  records: ProfileWorldCreditRecord[],
  limit = PROFILE_WORLD_CREDIT_LIMIT,
): PublicProfileWorldCredit[] {
  const groups = new Map<string, { credits: Doc<"worldProfileCredits">[]; world: Doc<"worlds"> }>();

  for (const { credit, world } of records) {
    if (world.publicationState !== "published") {
      continue;
    }

    const current = groups.get(world.slug) ?? { credits: [], world };
    current.credits.push(credit);
    groups.set(world.slug, current);
  }

  return [...groups.values()]
    .map(({ credits, world }) => ({
      slug: world.slug,
      displayName: world.displayName,
      roles: [...new Set(credits.map((credit) => credit.role))],
      tags: world.tags,
      ...optionalField("summary", world.summary),
      ...optionalField("sourceLabel", credits.find((credit) => credit.sourceLabel)?.sourceLabel),
    }))
    .sort((first, second) => first.displayName.localeCompare(second.displayName))
    .slice(0, Math.max(1, Math.min(limit, PROFILE_WORLD_CREDIT_LIMIT)));
}

export async function getPublicProfileWorldCredits(
  db: DatabaseReader,
  profile: ProfileReference,
): Promise<PublicProfileWorldCredit[]> {
  const credits = await db
    .query("worldProfileCredits")
    .withIndex("by_profileType_profileSlug", (query) =>
      query.eq("profileType", profile.profileType).eq("profileSlug", profile.slug),
    )
    .take(PROFILE_WORLD_CREDIT_QUERY_LIMIT);
  const records = (
    await Promise.all(
      credits.map(async (credit) => {
        const world = await db.get(credit.worldId);

        if (world === null) {
          return null;
        }

        return { credit, world };
      }),
    )
  ).filter((record): record is ProfileWorldCreditRecord => record !== null);

  return createPublicProfileWorldCredits(records);
}
