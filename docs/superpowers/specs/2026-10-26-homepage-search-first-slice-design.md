# Homepage and unified search: first production slice

## Status and intent

Status: implementation design for BASIC's review. No product code is changed by
this document. BASIC approved the interactive homepage prototype as the visual
reference and selected staged production implementation, beginning with Home
and search. This document makes the first PR's boundary reviewable.

Reference: [approved homepage prototype](https://vrdex-timeline-study-20261022.basicbit.chatgpt.site).
The reference uses fictional data. Its fixture clock, names, browser-local
favorites and hash router are not production contracts.

This slice replaces the DJ-lookup-first public entry with compact universal
search and progressively disclosed results backed by the existing public data.
It retains useful individual link lookup without making lineup collection a
public search feature.

## Approaches and selected direction

Selected by BASIC: implement the approved design in working slices using the
existing Next.js, TypeScript, Convex and shared UI infrastructure. The first PR
delivers Home/search; timeline and discovery follow separately.

Porting the standalone prototype directly would copy its fake records and
browser-local state instead of using production authorization and routing.
Replacing Home, timeline, planning preferences and discovery in one PR would
couple several data contracts and delay a useful, independently testable search
change. Neither is the selected approach.

## First PR boundary

- Replace `/` with the approved compact search header and brand/account
  navigation. Submit public queries to `/search`.
- Show at most five compact public suggestions as an overlay that does not move
  surrounding content. Include identity and a quiet entity-type label. No
  genre shortcuts, result accordions or copy controls in the preview.
- Enter with no selected suggestion and `View all results` open `/search?q=...`.
  Arrow keys select suggestions; Enter on a selected suggestion and pointer
  selection open its canonical entity page. This reuses the app's current
  navigation behavior; it is an implementation recommendation where the
  prototype used full results or an event inspector for selections.
- Keep the full results page at `/search`, with All, People, Communities,
  Events and Worlds filters. People includes DJs and other people. Preserve
  canonical routes, images, public source/trust state and eligible claim links.
- Show readable person genres, and move public link/copy actions behind an
  individual `Links` disclosure. Several results can be open at once.
- Remove the visible All VRDex / DJ links mode switch from the primary public
  search experience. Keep working compatibility routes and permissions.
- Home is intentionally a search-first entry in this PR. Do not add empty
  timeline/discovery placeholders or fictional content to fill the future
  sections. Keep `/discovery` reachable. Later PRs add the real timeline and
  the approved two-event/two-club discovery composition.

## Data and component boundaries

`convex/search.ts:searchUniversal`, `convex/_publicSearch.ts` and
`fetchDiscoverySearch` remain the public query and projection path. Keep
entity/profile filters on the server before the result limit. Reuse
`useSearchSuggestions` cancellation and request freshness behavior, improving
it where tests expose gaps. Cap the rendered and keyboard-addressable preview
at five; do not display the bounded suggestion count as a total-match count.

`DiscoverySearchForm` currently lives in `discovery-analytics.tsx`. Extract a
focused shared search control if needed rather than adding another independent
fetching and keyboard implementation. Preserve bounded analytics without raw
query text or private profile values. Use normal Next.js routes and GET form
submission, not the prototype's hash routing.

The existing public result already contains visibility-filtered person genres
and outbound links. Reuse that projection, including safe destination handling,
and derive UI types from it rather than maintaining a narrower hand-written
copy that drops genre display flags or link metadata. Share the existing lookup
link presentation/copy formatting without importing private lookup fetching
into public search.

Closed person rows show identity, appropriate role metadata and readable genres.
Prefer `displayLabel` over `displayName`; order explicitly featured genres first
with stable order inside each group. Show up to three names with quiet
separators and an accessible `+N` disclosure for the remainder. Missing genres
or links produce no empty disclosure chrome. Keep the profile link independent
of the `Links` button. A successful copy announces success without closing the
row, navigating, or moving focus.

Events, communities and worlds keep their own result metadata; do not manufacture
DJ-specific fields for them. Event dates use the existing viewer-local time
components, and the later event inspector is not required in this PR.

### Genre filter boundary

Current recommendation for this first PR: improve genre display and preserve
genre keyword search, but do not ship an exact Genre selector yet. The existing
universal query has no exact genre argument; client-filtering its first 24 rows
would silently omit valid matches. The prototype's exact filter remains a
reference for a follow-up with a reviewed server-side eligibility, slug and
pagination contract. Do not imply that person genres are automatically inherited
by events, communities or worlds. This is a deliberate scope recommendation for
BASIC to review, not an existing approved production capability.

## Compatibility and privacy

- Redirect nonempty legacy `/?q=...` bookmarks to the existing lookup
  destination `/search?q=...&view=dj`; new Home form submissions use `/search`.
- Preserve `/lookup`, `/lookup/suggest` and `/search?view=dj`, including bulk
  lookup and explicitly authorized private seed workflows. Keep them out of
  the primary public mode switch.
- Public Home and standard search never fetch or merge private seed suggestions.
  Sign-in alone does not grant private lookup access. Preserve the existing
  grant/feature checks and masking on compatibility surfaces.
- Preserve the existing `/discover` redirect and `/discovery` page.
- Do not migrate or reuse lookup recents for public search: they may contain
  private lookup terms. New public search history or synced favorites are not
  part of this slice.

## Interaction, copy and failure states

The search field has a clear action. Escape and outside interaction dismiss
the preview; keyboard focus and IME composition remain usable. Submission,
entity filters, refresh, and Browser Back/Forward preserve meaningful URL state.
Suggestions for a previous query or filter must never be selectable after the
current input changes. Empty input does not enumerate the public directory.
Suggestion failures do not prevent an explicit full search submission.

Use shared charcoal-theme tokens, subtle radii, image fallbacks and the approved
wordmark. Match the prototype's compact composition, not its literal CSS.
No promotional copy or explanatory cards are added.

Previously approved prototype utility labels available for reuse are
`DJs, clubs & events`, `Search results`, `View all results`, `Links`, `Copy`,
`No results`, and `Home`. Keep People/Communities/Worlds naming where required by
the app's broader entity model. Preserve existing approved status copy unless a
change is necessary. Any newly authored public sentences must be shown exactly
to BASIC before shipping under `AGENTS.md`'s public copy rule. Accessibility
names may be explicit without adding visible explanatory prose.

## Verification and delivery

Use anonymous local Convex and controlled public fixtures for development. Do
not use hosted bindings, seed production, or change external integrations.
Test public result projection/visibility and server filters with Convex tests;
exercise URL normalization and compatibility redirects with focused unit/route
tests; exercise real keyboard, mouse and touch interactions in Playwright.

Required cases include the five-row limit, no layout shift, clearing and
dismissing suggestions, IME input, stale/out-of-order query and filter responses,
Enter versus selected Enter, Browser Back/Forward, refresh, multiple open link
rows, copy success/failure, sparse records, private-seed exclusion, and intact
legacy bulk lookup. Use BASICBIT and the existing sparse/public/private fixtures
instead of the prototype's invented profiles.

Capture and visually inspect desktop and mobile Home/search screenshots, with
an open preview and expanded result. Use `ci:browsers` and `ci:visuals` for the
implementation PR. Update product direction, unified search planning, backend
search docs where behavior changes, and local-development route guidance in the
same PR. The earlier October 21 design remains historical context; this spec
and the approved prototype govern the first slice once this document is approved.

## Explicitly later

The continuous timeline, one-hour public-row spacing, event/set inspector,
club/DJ favorites, My night, and equally sized event/club discovery cards remain
approved visual direction for their later production slices. This PR does not
define their account persistence or backend query contracts. Event authoring
remains the canonical organizer workflow. Discord/VRCPop mirroring is separate;
VRC.tl remains excluded as an integration destination.
