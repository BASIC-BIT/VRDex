# Home discovery

Status: BASIC approved the corrected visual recommendation direction on October
28, 2026. The superseded chronological design has been removed. Implementation
choices in the [plan](../plans/2026-10-28-home-discovery.md) are author defaults
for plan review, not additional decisions attributed to BASIC.

The approved [October 29 Home polish](2026-10-29-home-polish-design.md) supersedes
this document's Agenda, control, personal-lane, loading and discovery presentation
details where they differ. Its complete selected-card favorite membership and
stable refresh rules replace prefix-based labels. Public visibility, authored
times and bounded recommendation sampling still apply.

## Approved direction

Locked direction from BASIC: discovery is for visually finding interesting
upcoming events, distinct from the timeline's job of planning tonight. A cool
poster, a genre the visitor wants to hear, or a recognizable DJ can make an
event interesting. Discovery should mix familiar connections and new things,
as a recommendation feed does. The two-event/two-club visual composition remains
approved direction.

Withdraw the seven-day cutoff, ongoing-first/soonest-first ordering, the rule
that favorites cannot affect ranking, and the requirement that every club card
justify its placement with its next event. Those were author proposals that
duplicate the timeline and do not serve this purpose.

Approved recommendation, with exact implementation defaults in the linked plan:

- Lead with posters. Keep date/title legible but let artwork, readable genres
  and recognizable lineup names supply the reasons to open an event. Highlight
  favorited performers subtly using the existing preference state.
- Blend events connected to favorite DJs/clubs with unfamiliar events connected
  through public genre assignments. Include variety rather than filling both
  spots with the same club or repeatedly showing the same familiar records.
- With only two event cards, initially aim for one familiar connection and one
  discovery when candidates support both. This is an author-proposed starting
  heuristic, not a user-selected ratio or a permanent slot assignment. Sparse
  signals should fall back to varied public upcoming events without pretending
  to know the viewer's taste.
- Reach beyond this week. A date further away does not by itself make an event
  less worthy of discovery. The plan specifies sampling bands and read budgets
  without a fixed upper eligibility cutoff. Those are implementation defaults,
  not an additional product requirement from BASIC.
- Show clubs through their artwork, name and public musical identity. Select
  a mixture of existing connections and relevant unfamiliar communities. Do not
  fabricate community genres from the genres of their booked performers.
- Reuse the single nonmodal event panel, favorites and My night actions. The
  section does not follow timeline pan/date/favorites-only controls.
- Do not rank poster aesthetics with an invented quality score. The poster is
  something the visitor judges visually. Artwork availability may affect card
  composition without becoming a claim about event quality.

Existing code provides browser-local favorite profile IDs and My night picks.
It does not provide explicit listener genre preferences or an engagement-trained
recommendation model. The plan defines how musical affinity is derived, how
public performer/genre identity is retrieved without unbounded roster reads,
and how new visitors get varied results. A public DJ's genre
assignment can be evidence for a proposed affinity rule; it must not silently
become a direct event or community genre assignment.

Candidate retrieval must span future dates before ranking, rather than reranking
the first chronological page. The implementation plan defines bounded sampling,
stable rotation and diversity, signal strength and missing-data fallback. A simple explainable blend is a suitable first
implementation; collecting click/dwell histories or training a model would be
additional scope, not something already authorized by this design discussion.

## Preserved interaction and presentation contracts

Use the [approved private visual study](https://vrdex-timeline-study-20261022.basicbit.chatgpt.site)
for the two-event/two-club composition. Keep search and Schedule above discovery.
Events and Clubs sit alongside each other on wide screens and stack on mobile.
No introductory prose, carousel, filler cards or invented event counts. A club
can appear without an upcoming event. Its primary destination is its canonical
community profile, not a name-based search.

Event cards use canonical public links, enhanced on ordinary activation to the
existing nonmodal event panel. Modified-click, new-tab and no-JavaScript links
retain native behavior. Separate save/favorite controls remain accessible on
keyboard and touch. Posters lead the cards; logos stay proportional and
contained. Missing artwork uses a deliberate shared fallback. Full posters stay
intact in the detail panel.

Schedule and discovery share exactly one selected event, one detail panel, the
existing browser-local preference store and its existing action semantics.
Closing restores focus to the real invoker. Discovery does not pan Schedule or
change its filters. Preserve pending-pan history flushing and Back behavior.

Preserve public publication, suppression, host, performer, artwork and per-field
visibility checks at current read time. New joins must not restore private
fields. Browser-local favorites remain browser-local; no favorite histories or
public snapshots are persisted by this feature. Derived genre affinity is a
recommendation input, not a factual genre assignment to an event or community.

## States, copy and verification

Use minimal utility labels: Discover, Events, Clubs, Browse, Loading, Unavailable,
Retry, No events and No clubs. Keep the existing action labels for favorites and
My night. Do not show a definitive empty state for incomplete or failed reads.
No new authored sentences are approved. Additional prose requires BASIC's exact
review under AGENTS.md.

Use bounded public reads and explicit partial coverage; never filter a truncated
first page and claim complete genre/search results. Failures keep search and
Schedule usable. Refresh public eligibility, discard stale responses and keep
selection stable during refresh. Viewer-local times, date-only authored dates,
DST and fractional-offset zones retain existing behavior.

Verify recommendation mixing, cold start, sparse signals, diverse hosts, distant
events, private fields, partial roster/candidate coverage, hidden/unpublished
records, cross-section panel replacement and synchronized save/favorite actions.
Require actual desktop/mobile screenshots, VLM review, shared design tokens and
both browser/visual CI selections. Fixed-date local fixtures retain their
cross-worker lease through exact owned cleanup.

Interactive genre filters, trained engagement models, analytics collection,
account synchronization, new editorial tooling, external publishing and changes
to event authoring remain separate work. VRC.tl is a visual reference only, not
a publishing destination. Keep /discovery and existing search/lookup routes.
