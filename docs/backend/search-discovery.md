# Search And Discovery

## Status Note

Current recommendation and first implementation for expanded public discovery, covering `#25`, `#30`, `#31`, `#32`, `#33`, `#95`, `#96`, and `#97`.

## Locked Decisions

- public discovery starts from explicit VRDex records, not scraped popularity or private presence
- search is a first-class product surface, not a secondary directory page
- search and discovery must enforce `publicationState` and `publicSurfacingState`
- search and discovery must enforce profile field visibility; `unlisted` direct-page fields are not indexed or shown on cards
- community-submitted and unverified records can be discoverable only with visible trust and source labels
- events, worlds, people, and communities participate in universal search through search documents
- PostHog is the first-pass analytics target for discovery instrumentation when configured

## Search Documents

`searchDocuments` is the universal search surface.

Each document stores:

- `entityType`: `profile`, `world`, or `event`
- target id fields for the source record
- public route, title, subtitle, summary, and image URL
- `searchText`: weighted keyword corpus used by Convex full-text search
- `exactTokens`: normalized exact-match terms for deterministic reranking
- `vocabularyKeys`: scoped normalized tags and role/category terms
- trust, freshness, and featured ranking signals
- sanitized source label

The first live implementation uses Convex full-text search. Convex supports relevance ordering and prefix/typeahead behavior. Fuzzy typo matching should not be reimplemented with ad hoc regex piles or one-off Levenshtein hacks in app code.

### Partial And Stylized Profile Names

Profile-name retrieval also uses the Convex `search_names` index, built from display
names, slugs, public aliases, and internal search aliases. It stores normalized name
suffixes so an interior substring such as `land` finds `Outlandish`. The existing
keyword index still handles genres, tags, bios, worlds, and events.
Keyword candidates must contain every query word (with prefix matching for the
last word), so `Lost K20` does not return `Lost Melody` on `Lost` alone.
The filter preserves accent folding and `&`/`and` normalization.
Literal and stylized suffixes have separate token prefixes in the same index and
separate candidate reads. An ambiguous stylized bucket cannot consume the literal
candidate allowance.

Name normalization ignores case, combining accents, whitespace, and punctuation.
Queries of at least three normalized characters also support `0/o`, `1/i`, `1/l`,
`3/e`, `4/a`, `5/s`, and `7/t` in either direction. Numeric-only queries do not
expand. Ordinary `i` and `l` are never interchangeable: broad index candidates are
verified against the original normalized names before they become results.
This is a discovery aid, not identity verification or a duplicate-merge rule.

Literal exact names rank first, then literal prefixes and substrings, then stylized
exact names, prefixes, and substrings. Existing ranking signals break ties within
those tiers. One- and two-character queries retain the existing keyword/typeahead
path without extra substring or substitution expansion.
Exact identity names, including world/event titles and profile aliases beyond the
additional index budget, beat exact keyword/taxonomy matches. Exact keywords in
turn remain ahead of partial profile names.

The shared `searchPublicDocuments` helper serves universal search, person lookup,
the public HTTP API, and hosted MCP. The stdio MCP client uses the HTTP API.
There is no separate UI matching implementation.

Keyword, literal-name, and stylized-name reads share a 256-document candidate
budget (86 keyword, 85 literal, 85 stylized) before deduplication and ranking.
Keyword-only queries may use all 256 slots.
Search remains bounded, not exhaustive: very broad queries can omit matches beyond
that ceiling. Only the ranked window needed to fill the requested limit is hydrated,
and live profile surfacing checks still drop hidden or stale records.

Each name's suffix generation is capped at 120 Unicode characters, with a 512-character shared
budget in display-name, slug, public-alias, then search-alias order. Keyword indexing
is unaffected by that additional name-index budget. Suffix terms and query prefixes
are capped at 32 UTF-8 bytes, following [Convex's term limit](https://docs.convex.dev/search/text-search#limits).
Longer queries are verified in full after candidate retrieval. Full normalized
identity names are stored separately for verification and ranking. The combined
literal/stylized suffix corpus also has a 16,000-byte ceiling, so adding the second
candidate namespace does not double the document-read footprint.

After deploying the optional fields and new search index, an authorized operator
must run the resumable migration once to populate existing profiles:

```sh
pnpm cx -- prod run migrations:runBackfillProfileNameSearch
```

Wait for migration completion before claiming existing profiles support the new
matching behavior. Normal profile writes populate the fields immediately. The
migration reuses the delta-aware reindexer, so it does not inflate vocabulary counts
or change publication/surfacing state. Deploy and migration execution are separate
operator actions; implementation tests do not establish production rollout.

Profile and event mutations update their own search documents. Worlds do not yet have a public write mutation, so `search.rebuildWorldSearchDocuments` is an internal backfill hook for keeping world search documents populated until that write path exists.

Published event documents remain index-eligible across community visibility changes. Public search rechecks the event's live community before returning a result, so hiding takes effect immediately and restoring does not require an unbounded hosted-event reindex.

Profile search documents always include public identity basics such as display name, slug, profile type, and route. Optional profile fields only participate when their `fieldVisibility` is `public`; `unlisted` fields remain visible on direct profile pages but are omitted from search text, exact tokens, vocabulary keys, summaries, and image cards.

Event results recheck the live community before projection and rebuild the route from the current community slug and event code. Community visibility changes and reslugs therefore take effect without rewriting every hosted event document.

## Semantic And Vector Search Seam

`searchEmbeddings` is a provider-neutral vector seam keyed to `searchDocuments`.

Current recommendation:

- use Convex full-text search for the first production keyword/typeahead path
- keep embeddings optional until a provider is selected
- evaluate Convex vector search, Weaviate, Pinecone, Typesense, Meilisearch, and Algolia before committing to a separate service
- prefer provider choice based on real query quality, operations burden, self-hosting posture, and privacy boundaries

The schema uses 1536 dimensions as the first embedding-seam default because that matches common embedding models and Convex's vector-index range.

## Ranking Model

Initial ranking combines:

- Convex full-text relevance
- exact title/slug/alias token boost
- vocabulary term match boost
- trust weight for claimed and verified profiles
- upcoming-event freshness
- featured-placement weight
- entity-type weight so events can surface strongly for tonight/soon discovery

This is intentionally transparent and deterministic. Personalization and analytics-derived ranking are later layers.

## Featured Placements

`featuredPlacements` models curated discovery positions such as home hero, event poster wall, discover hero, and discovery rail.

Featured labels must stay honest:

- `Featured`
- `Curated`
- `Upcoming`
- `Partner-provided`

Avoid unsupported labels such as global popularity, live now, most attended, or trending unless backed by safe documented data.

## Public Surfacing Enforcement

Profiles carry `publicSurfacingState`:

- `public`: normal public discovery and profile access
- `opted_out`: valid owner opt-out, hidden from ordinary public surfaces
- `suppressed`: moderation/safety suppression, hidden from ordinary public surfaces
- `archived`: operator judgement that the row should not be on the site, hidden from ordinary public surfaces

Only `public` surfaces. Ask `isPubliclySurfaced` rather than comparing against the hidden states, so a fifth one is hidden everywhere by adding a literal instead of by finding each comparison -- which is what adding `archived` had to do to the two places that spelled it out inline.

Public profile reads, search documents, event participants, and linked world attributions must respect this state. Hiding a profile releases the vocabulary terms it contributed and restoring one records them again, so a reversible state does not leave discovery facets undercounted; see `_profileSurfacing.setProfileSurfacing`. World search documents must not index linked profile attribution names unless the linked profile is publicly readable.

## Analytics Events

Optional PostHog instrumentation emits:

- `search_submitted`
- `search_result_clicked`
- `discovery_filter_selected`
- `event_card_clicked`
- `featured_card_clicked`

Missing PostHog configuration must not break local, preview, self-hosted, or production reads.

## Out of Scope

- choose the long-term semantic/vector provider after real query testing
- add personalized ranking once auth, consent, and analytics history exist
- create PostHog dashboards and quality reports
- add richer moderation dashboard for suppression requests
- add paid or partner placement policy only after explicit product review
