# Home discovery

Status: superseded draft, not approved for implementation. The correction below
records BASIC's October 28 feedback. The earlier selection and ranking details
remain historical context only and must not be implemented as requirements.

## Corrected direction

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

Current recommendation for the next design pass:

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
  less worthy of discovery. The practical candidate horizon and retrieval
  budgets still need design; do not replace the withdrawn seven-day cutoff with
  another arbitrary fixed value without explaining the choice.
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
recommendation model. The next design must define how musical affinity is
derived, how public performer/genre identity is retrieved without unbounded
roster reads, and how new visitors get varied results. A public DJ's genre
assignment can be evidence for a proposed affinity rule; it must not silently
become a direct event or community genre assignment.

Candidate retrieval must span the chosen future horizon before ranking, rather
than reranking the first chronological page. Define bounded pagination/sampling,
stable rotation and diversity, signal strength and missing-data fallback before
writing an execution plan. A simple explainable blend is a suitable first
implementation; collecting click/dwell histories or training a model would be
additional scope, not something already authorized by this design discussion.

The historical sections below preserve usable panel, accessibility, privacy and
state ideas, but their selection contract and copy inventory require revision
and a fresh builder check before design approval.

## Intent and scope

Complete Home's browse section beneath compact search and Schedule. Visitors
can notice an event, inspect it while continuing to browse, save it to My night,
or discover the community hosting it. Clubs receive similar visual weight to
events. Real public records and artwork carry the section; introductory prose
does not.

Preserve the shipped search, continuous timeline, Agenda, purple My night,
private favorites, nonmodal event panel, local time handling and legacy routes.
Keep `/discovery` working. This slice does not change event management,
distribution, account sync, the wordmark or the timeline's packing rules.

Sources: the [approved private visual study](https://vrdex-timeline-study-20261022.basicbit.chatgpt.site),
the [shipped timeline design](2026-10-26-home-timeline-design.md),
the [shipped search design](2026-10-26-homepage-search-first-slice-design.md)
and [product direction](../../planning/product-direction.md). The study's
fixtures, genre filters, hash routes and covered-set restoration are not
production contracts.

## Approaches and choice

1. Event-led discovery, chosen by BASIC. Select current/upcoming events and
   clubs with upcoming events automatically. This stays useful as organizers
   maintain records, without an editorial operation.
2. Curated discovery. Explicitly select events and clubs, useful for outreach
   and intentional introductions, but requiring selection controls and upkeep.
   Deferred. Existing search `featuredRank` is a system score and does not
   establish an editorial selection policy.

No popularity claims, random community promotion, paid placements or inferred
attendance. Favorites remain actions and do not change discovery ordering in
this slice. Interactive genre filtering is deferred; existing public genre
labels may be displayed only where their actual entity assignments support it.
Do not derive community genres from performers or event tags.

## Composition and card behavior

Use the approved private homepage study as visual reference, with two event
cards and two similarly sized club cards. Search and Schedule remain above.
On wide screens the Events and Clubs groups sit alongside each other. Narrow
screens stack the groups and reduce columns when needed for readable titles
and usable controls. No carousel or fixed empty card slots.

Event cards show artwork, title, viewer-local date/time and public host identity
when available. Artwork can crop in cards; the existing detail panel preserves
the full poster. Use the approved public image projection, responsive image
sizes and intentional missing/broken-image fallback. Club artwork keeps logos
proportional, transparent and contained, without applying a circular crop.

Club cards show their public name, logo and the next qualifying event's title
and viewer-local date/time. This supplies the reason they appear without
inventing an upcoming-event count. The card's primary link opens the canonical
community profile `/<slug>`. Its next-event link opens that event in the shared
panel. Do not route through name-based directory search as the prototype did.

Event titles remain real links to canonical public event routes. Ordinary
unmodified activation enhances them to the shared panel. New-tab, modified-click
and no-JavaScript navigation retain link behavior. Saving to My night and
favoriting a club are separate controls, never nested inside another button or
link. Use existing action semantics, focus treatment and capacity feedback.
Quick-add appears on pointer hover and keyboard focus; touch has a visible
action. No new gestures, autoplay or externally inferred live state.

## Selection contract

Author's recommendation: discovery uses the viewer's resolved browser timezone,
independent of the timeline's selected date, pan, search and favorites filter.
Changing the timeline's display timezone updates discovery's timezone too.
Define today in that timezone. The window ends at local midnight seven calendar
dates after today, exclusive. Include today's date and the following six dates.
Use calendar arithmetic across DST, not seven fixed 24-hour intervals.

Eligible records are published, scheduled, publicly readable events with a
supported public route. Reuse canonical publication, hidden-host, suppression,
media and field-visibility checks. A literal host name is not a community
identity. Unhosted events can appear only if they have a supported public event
route; they cannot produce a club card.

Build bounded candidate streams directly from event indexes, not the first 12
`fetchDiscovery` previews or the mixed first 40 profile search documents:

- Ongoing timed events: authored `startAt <= now < endAt`, using the published,
  scheduled end-time index, ascending end time. Filter future starts before
  accepting a candidate. Never manufacture an end for an open-ended event.
- Future timed/open-ended events: `now <= startAt < windowEnd`, using the
  published, scheduled start-time index, ascending start time.
- Date-only events: authored date between today and the sixth following date,
  inclusive, using the published, scheduled event-date index. Preserve authored
  dates rather than converting them to midnight instants. Respect existing
  date-only feature enablement.

Recommended hard budget: inspect at most 100 raw rows per stream, with one
additional probe row to determine exhaustion. Bound raw reads before visibility
joins; memoize repeated host eligibility checks within the request. Only selected
cards need artwork resolution. No roster, full event detail or participant
hydration during discovery selection. The implementation plan must check this
budget against Convex transaction/read limits before fixing query boundaries.

Deduplicate by event ID. Among eligible inspected candidates, order ongoing
events first by earliest authored end, then future timed events by start, then
date-only events by authored date. Break ties by event ID. Take at most two event
cards. This is a deterministic bounded selection, not a promise of the globally
nearest events when a stream is truncated. No completeness, total-concurrency,
popularity or global-ranking claims appear in the UI.

For Clubs, use future timed and current/future date-only candidates from those
streams, ordered as above, regardless of which two event cards were selected.
Take the first two distinct eligible community IDs, with each club's earliest
qualifying event among inspected candidates as its context. An ongoing-only
event does not qualify a club as having an upcoming event. Two events from one
club do not create duplicate clubs. No wider profile fallback fills the group.

Represent coverage explicitly as complete or partial. Any truncated stream makes
coverage partial. A zero-card partial read is not a verified empty result. Keep
the Browse link available in all cases; do not show No events/No clubs for a
partial read. A successful bounded selection may show fewer than two cards.
Do not add automatic unbounded continuation or expose scan mechanics in prose.
Exact genre search, exhaustive directory browsing and global nearest-event
selection would need separate contracts.

## Ownership and integration

Introduce a small Home browsing controller above Schedule and discovery. It
owns exactly one selected event, its originating focus target, the active
display timezone and one EventDetailPanel. Schedule and discovery call the same
selection/close actions. Preserve Schedule's pending-pan history flush, browser
Back, unavailable-selection clearing and existing standalone usage.

Opening discovery details does not pan the timeline, clear its filters, move
scroll position or add URL history. Selecting a timeline event replaces that
same panel. On close return focus to the actual invoking control if connected,
otherwise the appropriate Events or Schedule heading. Roster reads and stale
detail suppression remain in the existing detail controller.

Reuse the module's existing useTimelinePreferences external store, reducer and
storage version. Multiple components may subscribe to that same store, but no
new independent store or persisted content snapshots are introduced. Reuse
togglePlanAction and existing capacity handling. Whole-event saves replace set
saves; covered sets remain Included. Club favorites use real profile IDs and
immediately affect the timeline's favorites filter. My night may remain outside
the current viewport until the visitor chooses its existing navigation action.

Create a focused public discovery query and derived result types, reusing the
canonical eligibility and public artwork projections. A response carries only
selected event identities/card fields, selected community identities/card fields
and coverage. Keep request failure separate from coverage. Do not change the
existing `/discovery` query just to fit Home.

Client initialization resolves timezone before selection, as Schedule does.
Refresh on a five-minute clock bucket, timezone change and tab visibility return;
backend updates to publication/status/host eligibility also refresh the query.
Use fixed bucket anchors to avoid a watch per clock tick. On a new query key,
clear prior cards until the new result arrives; never retain an obsolete public
card through an error. Detail has its own existing reactive eligibility checks.

Without JavaScript, keep search and a real Browse link to `/discovery` available.
Do not server-render discovery times in a guessed timezone. The production plan
may choose a reactive hook or explicit subscription controller, but must retain
these state and refresh semantics.

## States and exact copy

Proposed visible strings for design approval, using utility labels and existing
patterns only:

| Use | Exact text |
| --- | --- |
| Section | Discover |
| Event group | Events |
| Club group | Clubs |
| Browse link to `/discovery` | Browse |
| Initial load | Loading events |
| Failed read | Events unavailable |
| Retry action | Retry |
| Empty events, complete coverage only | No events |
| Empty clubs, complete coverage only | No clubs |

Retain existing approved My night, saved-state and favorite action labels and
explicit accessibility names. Do not add a tagline, explanatory paragraph,
Featured label, sample wording or fake genre/count badges. New prose beyond
this inventory needs BASIC's exact review before shipping.

Loading reserves a modest card area without fake content. Failure offers Retry
and keeps Browse, search and Schedule usable. A failed request does not become
an empty state. With only one group populated, keep its actual cards and a
compact empty state for the other complete group. Partial coverage shows actual
cards and Browse without a definitive empty message. Missing artwork does not
affect eligibility or hide a working title/action.

## Verification and builder decisions

Verify real local Convex selection with hidden/suppressed hosts, cancelled and
unpublished records, duplicate hosts, missing routes/artwork, empty and truncated
streams, more than two eligible events, ongoing/open-ended/date-only schedules,
tie ordering, local midnight and DST. Verify that clubs can come from events
beyond the selected two and no private metadata leaks through a public join.

Exercise panel replacement across Schedule and discovery, keyboard/modified
links, focus restoration, club navigation, synchronized favorites and My night,
capacity feedback, stale responses, refresh failure and independent timeline
pan/filter behavior. Preserve the existing timeline time/history regressions.

Require actual desktop/mobile screenshots and VLM review against the approved
two-and-two composition, including sparse, empty, failed and missing-artwork
states. Include Storybook compositions as appropriate. UI delivery selects both
ci:browsers and ci:visuals and preserves the fixed-date fixture lease rules.

Leave component names, exact responsive breakpoints, focused query/helper file
boundaries and test placement to the implementation plan. Reuse shared tokens
and existing media primitives; no new service or paid dependency. A builder
review checks this design before BASIC sees it for approval. Product code waits
for that approval, followed by an implementation plan.
