import type { Doc } from "./_generated/dataModel";
import type { DatabaseWriter } from "./_generated/server";

export type VocabularyScope = Doc<"vocabularyTerms">["scope"];

export type VocabularyCandidate = {
  scope: VocabularyScope;
  label: string | undefined;
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
  { scope: "event_participant_role", label: "DJ set", aliases: ["Set"], rank: 100 },
  { scope: "event_participant_role", label: "Performer", aliases: ["Artist"], rank: 92 },
  { scope: "event_participant_role", label: "Host", aliases: ["MC"], rank: 80 },
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

    const existing = await db
      .query("vocabularyTerms")
      .withIndex("by_scope_key", (query) => query.eq("scope", candidate.scope).eq("key", key))
      .unique();

    if (existing) {
      await db.patch(existing._id, {
        label: existing.source === "seeded" ? existing.label : label,
        usageCount: existing.usageCount + 1,
        updatedAt: now,
      });
      continue;
    }

    await db.insert("vocabularyTerms", {
      scope: candidate.scope,
      key,
      label,
      aliases: [],
      source: candidate.source ?? "user_created",
      usageCount: 1,
      rank: candidate.rank ?? 10,
      createdAt: now,
      updatedAt: now,
    });
  }
}
