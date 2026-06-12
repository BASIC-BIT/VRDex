# Genre Graph Metadata

Candidate direction. VRDex should treat genres as canonical graph metadata, not only freeform profile tags.

## Why This Matters

- DJs and communities need search and lookup to understand `Drum & Bass`, `D&B`, `DnB`, `dnb`, and similar spellings as the same genre.
- Events, communities, and people need genre data that survives imports from partner lists, user edits, and future bot/API lookups.
- Later recommendations need more than direct equality. Sparse relationships like shared parent genres, fusion genres, influence links, and proximity-style adjacency can help recommend related DJs, communities, and events without requiring dense user behavior data.

## Source Findings

- MusicBrainz is the best first canonical seed. It has a public genre list with stable UUIDs, genre aliases, typed relationships, and cross-links to other databases.
- MusicBrainz documents genres as part of its folksonomy tagging system. Tags are user-voted and subjective, while the genre list is curated and expanded by request.
- MusicBrainz `drum and bass` is genre UUID `462f9321-6103-49c9-b6db-96219bce6f62`.
- MusicBrainz aliases for `drum and bass` include `d'n'b`, `d&b`, `dnb`, `drum 'n' bass`, `drum & bass`, `drum'n'bass`, plus search hints like `drum n bass` and `drumandbass`.
- MusicBrainz relationships for `drum and bass` include parent `edm`, subgenres such as `dancefloor drum and bass`, `darkstep`, `deep drum and bass`, `jungle`, `liquid funk`, `neurofunk`, `techstep`, and typed links like fusion and influenced genres.
- Wikidata is useful as a crosswalk and alias enrichment source. Wikidata `drum and bass` is `Q188994`, includes aliases like `D&B` and `DnB`, and carries identifiers for MusicBrainz, Discogs, Every Noise, AllMusic, Rate Your Music, and other systems.
- Every Noise at Once is useful for dense genre neighborhoods and weaker proximity-style adjacency. Treat it as a recommendation enrichment source, not as the canonical ontology.
- Discogs styles are useful import/export compatibility metadata for music collectors and DJs, but should not be the sole canonical model.
- Rate Your Music appears to have strong genre hierarchy coverage, and MusicBrainz/Wikidata already cross-link to it, but VRDex should not depend on scraping it for core behavior.
- Mixed In Key does not appear to expose a public developer API from its public site or support navigation. Its useful public integration posture is file/library metadata: key, BPM, Energy Level, ID3 tag cleanup, automatic cue points, and export/sync workflows for DJ software such as Rekordbox and Serato.

## Current Recommendation

- Use MusicBrainz genre UUIDs as the initial canonical external anchor where available.
- Store VRDex-owned genre IDs and slugs so the app is not locked to one upstream source.
- Store aliases as first-class indexed records, not ad hoc string arrays hidden on profiles.
- Store graph edges as typed, sourced, weighted facts so the same structure can serve browsing, search expansion, and later recommendation systems.
- Keep profile `tags` and canonical `genres` separate. Tags can remain flexible identity/vibe labels, while genres point to canonical genre nodes.
- Use LLMs only for fuzzy interpretation of messy user text or event posters. Deterministic code should normalize against known aliases and validate candidate genre IDs.

## Picker UX Concerns

Current recommendation:

- Avoid both failure modes common in genre pickers: a tiny list that forces bad supersets, and a huge unstructured list that makes users browse thousands of niche names.
- Start with broad, familiar genre families such as `house`, `trance`, `drum and bass`, `dubstep`, `techno`, and `bass music`, then progressively reveal narrower child genres.
- Let users search aliases and niche spellings directly; `dnb`, `D&B`, and `drum & bass` should land on canonical `drum and bass` without requiring the user to know the canonical display label.
- Selecting a child should infer true parent genres without making the user manually select them. If someone selects `bass house`, `house` should appear as an inferred parent, not as another explicit user choice.
- Distinguish true hierarchy from loose affinity. `bass music`, `140`, `dubstep`, and `riddim` may overlap in scene vocabulary without always being clean parent/child supersets.
- Suggested related genres should be capped and ranked. Selecting one genre should not explode into thousands of adjacent subgenres.
- The UI should show enough structure to explain why something appears: explicit selection, inferred parent, alias match, or related suggestion.
- Manual/contact genre requests are a better first escape hatch than building a full user-generated genre submission workflow.
- Freeform profile tags can still exist for niche self-expression, but they should not silently become canonical genres.

## Current Code Slice

Current recommendation:

- Store optional inline `profiles.genres` facts for the DJ lookup slice instead of adding normalized genre tables immediately.
- Keep the public projection small: `slug`, `displayName`, optional `displayLabel`, and optional `featured` display intent. Source, confidence, aliases, parent slugs, and external IDs are stored for search/indexing and later migration, not shown as public UI mechanics.
- Use `profile_genre` vocabulary/search indexing so structured genre labels can participate in lookup without mixing them back into flexible `tags`.
- Treat this inline shape as a migration bridge. Once picker UX, alias management, and graph traversal are implemented, move canonical genre nodes, aliases, edges, and profile/event genre assignments into normalized tables.

## Suggested Data Shape

```ts
type GenreNode = {
  slug: string;
  displayName: string;
  normalizedName: string;
  description?: string;
  externalIds: {
    musicBrainzGenreId?: string;
    wikidataQid?: string;
    discogsStyleId?: string;
    everyNoiseId?: string;
    rateYourMusicGenreId?: string;
    allMusicStyleId?: string;
  };
  status: "seeded" | "reviewed" | "deprecated";
};

type GenreAlias = {
  genreId: Id<"genres">;
  alias: string;
  normalizedAlias: string;
  locale?: string;
  kind: "canonical" | "alias" | "search_hint" | "external_label";
  source: "manual" | "musicbrainz" | "wikidata" | "partner_import" | "llm_suggested";
};

type GenreEdge = {
  fromGenreId: Id<"genres">;
  toGenreId: Id<"genres">;
  type: "subgenre_of" | "fusion_of" | "influenced_by" | "adjacent_to" | "scene_overlap";
  weight: number;
  source: "musicbrainz" | "wikidata" | "every_noise" | "manual" | "event_cooccurrence";
  confidence: "high" | "medium" | "low";
};

type ProfileGenre = {
  profileId: Id<"profiles">;
  genreId: Id<"genres">;
  source: "owner_selected" | "community_submitted" | "partner_import" | "manual_review" | "llm_suggested";
  confidence: "high" | "medium" | "low";
  explicit: boolean;
  displayLabel?: string;
};
```

Implementation note for Convex:

- `genres` should index `slug`, `normalizedName`, and stable external IDs.
- `genreAliases` should index `normalizedAlias` so lookup can resolve `dnb` directly to canonical `drum and bass`.
- `genreEdges` should index both `fromGenreId` and `toGenreId` because browsing and recommendations need traversal in both directions.
- `profileGenres` or `eventGenres` should carry source and confidence rather than storing only bare genre IDs on the profile/event document.

## Relationship Semantics

- `subgenre_of` is a high-confidence hierarchy edge, useful for browse filters and parent expansion.
- `fusion_of` is a typed composition edge, useful for bridging communities that share only one side of a genre lineage.
- `influenced_by` is a directional historical/style edge, useful for explaining why loosely related genres are recommended.
- `adjacent_to` is a weak proximity edge, useful for recommendations but risky for strict filtering.
- `scene_overlap` should be derived later from VRDex data such as co-bookings, shared communities, and repeated event pairings.

## Product Rules

- Public profile and lookup UI should show concise display names, not ontology mechanics.
- Search can expand aliases immediately, but broader related-genre expansion should be explicit or weighted lower.
- Recommendation explanations should be human-legible, such as `shares DnB parent genre`, `often appears with jungle`, or `adjacent in electronic dance music`.
- Imported or LLM-suggested genre facts should remain reviewable before they become high-confidence public metadata.

## Audio Analysis R&D

Candidate direction:

- Audio-derived similarity is a separate R&D lane from the genre ontology.
- Useful features could include BPM, musical key, energy, spectral balance, rhythmic patterns, onset density, timbral texture, harmonic/chord density, and stem-derived drum/bass/melody structure.
- Manually selected genres can nudge or label an audio embedding space, but they should not be treated as a substitute for audio features.
- This could eventually support recommendations like new-release triage, similar-set discovery, and profile/event matching by musical fingerprint.

Current recommendation:

- Do not make audio analysis part of the first genre graph implementation.
- If this becomes real, treat it as an opt-in media-library or uploaded-set feature with clear rights, storage, and privacy boundaries.
- Mixed In Key-style metadata may be useful if available through exported files or DJ-library metadata, but VRDex should not assume a public Mixed In Key API exists.

## First Useful Slice

- Seed a small electronic/DJ-focused graph from MusicBrainz for `electronic`, `edm`, `drum and bass`, `jungle`, `liquid funk`, `neurofunk`, `dancefloor drum and bass`, `house`, `techno`, `trance`, `dubstep`, and nearby VRChat-relevant genres.
- Add alias normalization for the seeded graph.
- Change profile lookup/search to resolve genre aliases to canonical genre IDs while preserving the owner-entered display label where useful.
- Keep recommendation traversal out of the first implementation except for tests that prove graph edges are stored correctly.
- Prototype the picker with inferred parent display and a capped related-suggestions lane before expanding the seed graph aggressively.
