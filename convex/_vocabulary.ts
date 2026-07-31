import type { Doc } from "./_generated/dataModel";
import type { DatabaseWriter } from "./_generated/server";

export type VocabularyScope = Doc<"vocabularyTerms">["scope"];

export type VocabularyCandidate = {
  scope: VocabularyScope;
  label: string | undefined;
  aliases?: string[];
  source?: Doc<"vocabularyTerms">["source"];
  rank?: number;
};

export const SEEDED_VOCABULARY_TERMS: Array<{
  scope: VocabularyScope;
  label: string;
  aliases?: string[];
  rank: number;
}> = [
  { scope: "person_role", label: "DJ", aliases: ["DJs", "Deejay"], rank: 100 },
  { scope: "person_role", label: "VJ", aliases: ["Visuals", "Video jockey"], rank: 92 },
  { scope: "person_role", label: "Host", aliases: ["MC"], rank: 86 },
  { scope: "person_role", label: "Photographer", rank: 72 },
  { scope: "community_subtype", label: "Club", aliases: ["Club night", "Venue"], rank: 100 },
  { scope: "community_subtype", label: "Collective", aliases: ["Crew"], rank: 84 },
  { scope: "community_subtype", label: "Festival", rank: 82 },
  { scope: "community_category", label: "Music", rank: 100 },
  { scope: "community_category", label: "Dance", aliases: ["Dancing"], rank: 90 },
  { scope: "community_category", label: "Social", rank: 80 },
  { scope: "profile_tag", label: "House", aliases: ["House music"], rank: 100 },
  { scope: "profile_tag", label: "Trance", rank: 94 },
  { scope: "profile_tag", label: "Techno", rank: 92 },
  { scope: "profile_genre", label: "Drum & Bass", aliases: ["D&B", "DnB", "Drum and Bass", "Drum n Bass"], rank: 100 },
  { scope: "profile_genre", label: "House", aliases: ["House music"], rank: 96 },
  { scope: "profile_genre", label: "Trance", rank: 94 },
  { scope: "profile_genre", label: "Techno", rank: 92 },
  { scope: "event_participant_role", label: "DJ set", aliases: ["Set", "Headliner"], rank: 100 },
  { scope: "event_participant_role", label: "Performer", aliases: ["Artist"], rank: 92 },
  { scope: "event_participant_role", label: "Host", aliases: ["MC", "Opener"], rank: 80 },
  { scope: "event_tag", label: "Tonight", rank: 100 },
  { scope: "event_tag", label: "Festival", rank: 96 },
  { scope: "world_tag", label: "Club world", aliases: ["Club", "Venue"], rank: 100 },
  { scope: "world_tag", label: "Cyberpunk", rank: 80 },
  { scope: "world_tag", label: "Dance floor", rank: 78 },
  { scope: "discovery_facet", label: "Featured", aliases: ["Curated"], rank: 100 },
  { scope: "discovery_facet", label: "Upcoming", aliases: ["Soon", "Tonight"], rank: 96 },
];

export function normalizeVocabularyLabel(input: string): string {
  return input.trim().replace(/\s+/g, " ");
}

export function createVocabularyKey(input: string): string {
  const normalized = normalizeVocabularyLabel(input)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

  return normalized.replace(/\s+/g, "_");
}

export function createVocabularyCandidates(
  scope: VocabularyScope,
  labels: Array<string | undefined>,
): VocabularyCandidate[] {
  return labels.map((label) => ({ scope, label }));
}

export function collectVocabularyKeys(candidates: VocabularyCandidate[]): string[] {
  const keys = new Set<string>();

  for (const candidate of candidates) {
    if (candidate.label === undefined) {
      continue;
    }

    const key = createVocabularyKey(candidate.label);
    if (key) {
      keys.add(`${candidate.scope}:${key}`);
    }
  }

  return [...keys].sort();
}

function normalizeVocabularyAliases(aliases: string[] | undefined): string[] {
  const normalized = new Set<string>();

  for (const alias of aliases ?? []) {
    const label = normalizeVocabularyLabel(alias);

    if (label) {
      normalized.add(label);
    }
  }

  return [...normalized].sort((first, second) => first.localeCompare(second));
}

export async function recordVocabularyTerms(
  db: DatabaseWriter,
  candidates: VocabularyCandidate[],
  now: number,
) {
  for (const candidate of candidates) {
    const label = normalizeVocabularyLabel(candidate.label ?? "");
    const key = createVocabularyKey(label);

    if (!key) {
      continue;
    }

    const aliases = normalizeVocabularyAliases(candidate.aliases);

    const existing = await db
      .query("vocabularyTerms")
      .withIndex("by_scope_key", (query) => query.eq("scope", candidate.scope).eq("key", key))
      .unique();

    if (existing) {
      await db.patch(existing._id, {
        label: candidate.source === "seeded" ? label : existing.source === "seeded" ? existing.label : label,
        aliases: candidate.source === "seeded" ? aliases : existing.aliases,
        rank: candidate.source === "seeded" && candidate.rank !== undefined ? candidate.rank : existing.rank,
        usageCount: existing.usageCount + 1,
        updatedAt: now,
      });
      continue;
    }

    await db.insert("vocabularyTerms", {
      scope: candidate.scope,
      key,
      label,
      aliases,
      source: candidate.source ?? "user_created",
      usageCount: 1,
      rank: candidate.rank ?? 10,
      createdAt: now,
      updatedAt: now,
    });
  }
}

/**
 * Release vocabulary usages a profile or world no longer contributes.
 *
 * The counterpart to `recordVocabularyTerms`, which only ever increments. Without
 * this, replacing a visible tag leaves the old term's `usageCount` inflated
 * forever while the search document correctly drops it.
 *
 * Only the delta should be passed — terms the caller genuinely removed. Counts
 * floor at zero rather than going negative, because the wider model is not
 * reference-counted yet and a stray release must not corrupt a shared term.
 */
export async function releaseVocabularyTerms(
  db: DatabaseWriter,
  candidates: VocabularyCandidate[],
  now: number,
) {
  for (const candidate of candidates) {
    const key = createVocabularyKey(normalizeVocabularyLabel(candidate.label ?? ""));

    if (!key) {
      continue;
    }

    const existing = await db
      .query("vocabularyTerms")
      .withIndex("by_scope_key", (query) => query.eq("scope", candidate.scope).eq("key", key))
      .unique();

    if (!existing) {
      continue;
    }

    await db.patch(existing._id, {
      usageCount: Math.max(0, existing.usageCount - 1),
      updatedAt: now,
    });
  }
}

/**
 * Release usages by scope-qualified key, for callers that only hold the keys a
 * search document recorded rather than the original candidates.
 *
 * `collectVocabularyKeys` writes them scope-qualified as `scope:key`, so each is
 * split back apart here. Counts floor at zero for the same reason as
 * `releaseVocabularyTerms`.
 */
export async function releaseVocabularyKeys(
  db: DatabaseWriter,
  scopedKeys: string[],
  now: number,
) {
  for (const scopedKey of scopedKeys) {
    const separator = scopedKey.indexOf(":");

    if (separator <= 0) {
      continue;
    }

    const scope = scopedKey.slice(0, separator) as VocabularyCandidate["scope"];
    const key = scopedKey.slice(separator + 1);

    if (!key) {
      continue;
    }

    const existing = await db
      .query("vocabularyTerms")
      .withIndex("by_scope_key", (query) => query.eq("scope", scope).eq("key", key))
      .unique();

    if (!existing) {
      continue;
    }

    await db.patch(existing._id, {
      usageCount: Math.max(0, existing.usageCount - 1),
      updatedAt: now,
    });
  }
}
