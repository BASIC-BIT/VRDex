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

## Public web entry and compatibility

Home `/` renders the shared public search control without fetching lookup or
private data. New submissions use `/search?q=...`; a selected preview opens
the entity's canonical person, community, event or world route. The overlay
renders at most five suggestions, not a total match count. Full search keeps
All, People, Communities, Events and Worlds filters in URL state and applies
them server-side before the result limit. Empty input does not enumerate data.

Nonempty old `/?q=...` bookmarks redirect to `/search?q=...&view=dj` after
trimming. `/lookup`, `/lookup/suggest` and the legacy DJ view retain their
permissions and bulk behavior. Public Home and standard search use only
`/search/suggest` and the public projection, never private seed suggestions or
lookup recents. `/discover?q=...` still redirects to standard search; the
existing `/discovery` page remains reachable from Home navigation.

The [approved first-slice scope](../superpowers/specs/2026-10-26-homepage-search-first-slice-design.md)
defers exact genre filtering, timeline and favorites. Genre keyword search
remains supported; there is no client-side exact genre filter.

## Home recommendation reads

Home discovery uses `homeDiscovery` public queries, independently of Schedule
navigation and universal search ranking. The browser retains favorites and derives
affinity locally; these queries neither persist nor log preference lists.
The [October 29 Home polish](../superpowers/specs/2026-10-29-home-polish-design.md)
keeps candidate-query lifetimes independent of favorite changes. Existing cards
remain visible while ready replacements are assembled. A focused card waits for
blur; an open inspector survives ordinary reranking. Revocation and errors still
remove obsolete public content. Candidate refresh stays at five minutes and local
expiry at one minute.
The [approved Home direction](../superpowers/specs/2026-10-28-home-discovery-design.md)
allows public genre assignments to inform recommendations without creating event
or community genre assignments from booked performers.

`listEvents({ now, timeZone, band, kind, direction, cursor? })` samples four
viewer-local date bands: days 0–6, 7–29, 30–89 and day 90 onward. There is no
upper eligibility deadline. Timed events start at actual `now`; date-only events
start at authored today and honor `EVENT_DATE_ONLY_ENABLED`. Earlier ongoing and
open-ended events remain Schedule's responsibility. Each ascending or descending
stream uses its own scheduled/published start-time or event-date index. A query
reads at most 12 raw rows with one database pagination context. The caller stops
each stream after two eligible identities or three pages, yielding at most 32
identities across the 16 streams before deduplication. Ineligible hosts can leave
a page empty while its cursor still permits continuation. This is a bounded pool,
not an exhaustive future directory or a promise to rotate through every record.

Candidates carry event identity, canonical host route, title, public host identity,
the existing `TimelineSchedule`, and an optional safe poster URL. Candidate reads
do not load rosters or media kits. Events require current published/scheduled
state, a public community host and a supported canonical route. Missing ends stay
missing. No placeholder end time or image-quality score is introduced.

`listClubs({ direction, cursor? })` samples the public-community publication index
in both directions, 12 raw rows per page. The caller retains at most 12 public
identities per direction after at most three pages each. Clubs need no event.
Favorite clubs resolved through `profileSignals` can join this pool independently
of their position in the generic sample.

All continuation envelopes bind the full request identity, including exact `now`,
timezone, band, schedule kind and direction for events. Responses return
`{ items, cursor, complete }`; `complete` describes exhaustion of the indexed
stream, not completion of a client budget. Stopping with a cursor must retain
partial coverage. Clients must not present sampled absence as a definitive result.

`eventSignals({ eventIds })` accepts at most four unique IDs and rechecks current
event/host eligibility. For each eligible event it reads eight rows plus one
coverage probe from each of confirmed slots (time order), authored lineup
(position order) and participants (event index order). Only confirmed participants
whose explicit role is DJ contribute musical evidence. Linked public people are
deduplicated by stable ID and retain their own exact public genre slugs, readable
names, optional display labels and featured flags. Manual unlinked labels can
display but supply neither favorite matches nor genres. Event tags and private or
unlisted profile genres never become recommendation genres.

Signal coverage is `partial` whenever any association source has an uninspected
ninth row. `complete` means all sources were inspected for eligible public
evidence; it makes no claim about private identities or real-world attendance.
Hidden, missing and ineligible linked identities return no metadata and do not
alter coverage, avoiding disclosure of their existence. Partial coverage with no
favorite match supplies no negative familiarity evidence.

`profileSignals({ profileIds })` accepts at most 50 unique IDs per request. The
browser can resolve its existing maximum 500 favorite IDs in batches, with at
most three outstanding logical first-value reads, sharing that scheduler with
candidate continuations. Cached first values can complete synchronously while
warm wire revalidation remains pending; this is not a strict wire or backend
concurrency limit. See the [Home discovery measurements](../testing/playwright-visual-preview.md#home-discovery-evidence)
for the separately measured warm revalidation burst. Invalid, missing, suppressed
and private identities are omitted.
Repeated IDs are deduplicated before checking batch limits. Current field
visibility is enforced on every public response, including after suppression or
visibility changes.

Focus can retain at most one existing profile-signal batch of up to 50 IDs for
an outside-sample club. It does not register a pin-specific read. Event focus
can retain at most one old candidate generation; the reviewed native case
measured 19 retained watches. These are separate live subscription bounds, not
three-wire-work guarantees.

`favoriteLineup({ eventIds, favoriteProfileIds })` resolves complete favorite-person
membership for at most two selected discovery cards. Raw limits are two event IDs
and 25 favorite IDs, checked before deduplication. Invalid/unavailable events and
private, suppressed or non-person profiles are omitted. It returns only each
event ID and matched people's `id`, `slug` and `displayName`, without genres,
artwork or association metadata. Membership uses exact indexed `.first()` reads
for confirmed slots, authored lineup entries and confirmed participants of every
public-detail role. Date-only events skip slots, matching the detail roster.
People appearing in multiple sources are returned once; there is no roster-prefix
or name limit.

The separate favorite-lineup controller accepts at most 500 favorites, splits
them into twenty batches of 25 and allows three outstanding logical first values.
Completed reads remain subscribed, so this does not cap live subscriptions or
wire concurrency. It publishes a summary only when all current batches finish.
Context changes, changed live membership/privacy results and errors clear the
previous summary; cancelled generations cannot publish or launch more batches.
An event absent from any current batch is omitted. Empty favorites or selected
cards require no membership reads. This path neither selects recommendations nor
changes candidate refresh, sampling or expiry budgets.

Community signals include optional compact `imageUrl`, `logoImageUrl` and
`bannerImageUrl`. The shared compact-artwork projection reads only the first active
profile-image, primary-logo and banner placements plus the compact-display
preference, then at most three selected assets by ID. Assets must belong to that
profile and remain active, public, unsuppressed and unretired. Discovery field
visibility still applies. An invalid/private first placement never causes a scan
for a later replacement. Authored private identity placements also suppress
automatic destination-artwork replacements. No gallery or complete media-kit
collection is hydrated.

Worst-case row bounds per request (before shared profile/asset caching):

- Event candidates: 12 event rows plus at most 12 distinct host reads, 24 total.
- Event signals: four events, four hosts, 108 association rows and at most 96
  distinct linked-profile reads, 212 total. Coverage probes are never hydrated.
- Club candidates: 12 profile rows plus at most nine artwork rows per public
  community (three placements, one preference, three assets, two automatic
  destination checks), 120 total.
- Favorite signals: 50 profile reads plus the same optional community artwork
  bound, 500 total; person signals require no artwork hydration.
- Favorite lineup membership: two events, at most two distinct hosts and 25
  cached profile reads, plus at most 150 exact association lookups (three per
  event/person pair), each returning at most one row: 179 document reads/returned
  rows maximum per batch. Date-only pairs use two association lookups. A full
  500-favorite refresh is at most 20 requests, 3,000 association lookups and 3,580
  document reads/returned rows before live revalidation. Empty index probes still
  cost lookups; these bounds are separate from candidate sampling above.

The browser handles lazy loading, request concurrency, stable sampling/ranking and
stale-response rejection. Public eligibility reads remain reactive and must not
be replaced by persisted public snapshots. Home recommendations add no engagement
tracking and do not change `/discovery`, `/lookup` or search compatibility routes.

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

The web `PublicSearchResult` type derives from the backend projection and adds only
the server-authored claim entry path. Person results retain visible genre labels,
featured flags, outbound link presentation and resolved destination metadata.
`public-search-genres` provides readable labels and stable featured-first ordering
without mutating results. The shared `PublicProfileLinks` board handles public
link actions independently of legacy lookup queries or private seed access.
Standard public results show up to three readable genre names, with the rest
behind an independent `+N` disclosure. Each person with public links has its own
`Links` disclosure; opening one does not close another. Clipboard success and
failure are announced without closing the result or navigating away. Fallback
copy restores the copy control's focus and removes its temporary textarea.

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
- add engagement-trained ranking after separate authorization, consent, and analytics design
- create PostHog dashboards and quality reports
- add richer moderation dashboard for suppression requests
- add paid or partner placement policy only after explicit product review
