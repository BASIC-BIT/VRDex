# Home browsing polish

Status: visual direction approved by BASIC on October 29, 2026. Implementation
defaults below are identified separately for plan review. Deliver as one
combined change, not separate feature PRs.

Prototype: <https://vrdex-home-polish-20261029.basicbit.chatgpt.site>.
Loading demonstration: add `?loading=slow`; its simulated delay must not enter
production. Latest prototype source commit: `231a22e9e522b3ab371fbec06a0f0b1e48b3dcd6`.
The prototype uses illustrative data. It is visual/interaction evidence, not
proof of production latency, privacy, roster completeness or navigation.

## Intent and scope

Make search, schedule and discovery feel like one continuous Home page. Keep
reading position stable while data loads or preferences change. Give favorite
people/clubs and interest in an event/set distinct, consistent controls.

Preserve public search and native links, free timeline packing, browser-local
preferences and one nonmodal event inspector. No learned recommendation model,
analytics project, account synchronization, event publishing or new genre
authoring workflow. VRC.tl remains a visual reference, not a destination.

PR #397 was closed at BASIC's direction and its workflows stopped. Its isolated
height change is not shipped. Include that requirement here in the combined PR.

## Approaches and decisions

- Club artwork: BASIC selected full-name typographic artwork in the existing
  card shape over a smaller card without a full-height artwork area.
- Lineup: BASIC rejected arbitrary three-person previews. Cards highlight
  favorite people on the lineup, with access to the full roster in the panel.
- Schedule: BASIC removed the Timeline/Agenda switch and the entire Agenda UI.
  Keep the timeline as the browsing surface.
- My night: use compact stacked event/DJ bars instead of single-line chips or
  full-height copies of public event bars. Pack overlaps into separate lanes.
- Delivery: design all feedback together before implementation, then one PR.

## Home layout

On desktop, show search, a useful timeline and the start of discovery artwork
together. Complete discovery cards may continue below the fold. Check 1280x800
and 1440x900 at 100% zoom. An occupied My night may legitimately add height.

Use a smaller search heading beside its field on wide screens, with 24px above
and below the search row. On narrow screens use the stacked heading/form with
22px above and below. Keep the form usable, with native GET submission.

Consolidate Schedule, date, earlier/Now/later controls, favorites and compact
timezone/hour-format metadata into one wide-screen toolbar. Wrap deliberately
on smaller screens; preserve comfortable touch controls. Remove redundant
containers, large gaps and the view switch rather than shrinking text to fit.

Keep at least four event lanes, 376px total, and grow for additional occupied
lanes. Preserve 94px public lane pitch, 78px bars, free top-down packing and the
one-hour gap between consecutive public events sharing a lane. Keep viewed
time, selection, focus and date navigation in sync while panning.

## Interest and favorites

Interested is the saved state for any future event or individual set. My night
projects those choices onto the viewed timeline. Preserve the existing version
1 preference schema, stored `plan` references, 200-reference limit, 500 favorite
profile limit, storage fallback, cross-tab behavior and capacity feedback.
Do not create a separate Interested destination in this slice.

Current implementation default: include ongoing and future choices that overlap
the viewed range; omit ended/cancelled/unavailable items from timed bars. A
visitor can browse another future date without changing their interest list.
Retain removal and navigation access for references that cannot be drawn.

Purple + marks interest; a selected check confirms it. Hover or keyboard focus
on a saved control crossfades the check to an X, with Remove interest as its
tooltip. Clicking removes interest. Keep the hover fill translucent so it
blends with the highlighted row. Included sets keep a disabled check and
Included with event tooltip; do not create separate references for them.

The star favorites the person or club identified by that control. It responds
immediately with a small selection pop. Favoriting never adds events to My
night. Only the directly activated control may animate its selection change;
unrelated renders, incoming storage changes and offscreen copies must not
replay animations. Respect reduced motion. Tooltips and explicit accessible
names accompany icon-only controls. Preserve the actual public entity identity.

Normal schedule DJ cells reveal separate star and set-interest controls on
hover and focus within. Use sibling buttons, not nested interactive elements.
Tab through open-set, favorite and interest controls normally. Highlight the
whole cell consistently behind both label and controls. On touch, opening the
event panel provides the full-size controls.

## My night

Hide the projection when it contains no drawable choices in the viewed range.
Use 44px two-tier bars on a 50px lane pitch. Align the first header beside the
My night label; do not reserve a separate heading band. Two lanes occupy 100px.
Keep a shared horizontal time scale with the public timeline.

Each compact header shows the event identity and small club logo; the lower
track shows authored DJ intervals. Whole-event interest shows its loaded DJ
track. A saved set retains the event header above the selected DJ interval.
Use actual authored set times and IDs, never equal divisions of event length.
Reuse overlap packing with zero artificial travel-time padding for personal
choices. Preserve explicit overlap feedback and known roster coverage.

Favorite DJs have gold stars by their names. A favorite club has a small gold
star grouped with its logo, with a Favorite club: {club name} tooltip. Keep
purple as the interest color. Update these markers without rebuilding bars or
changing lane height. Truncate long labels with full accessible names.

## Discovery content

Keep two event and two similarly sized club positions, with truthful sparse
results. Retain the current recommendation eligibility and bounded candidate
sampling; profile genres may still inform ranking.

Event text order: linked title, compact muted date/club metadata, then a gold
star and every matching favorite person when present. No arbitrary name cap.
With no favorite matches, omit the summary. Full lineup with a right arrow
opens the shared inspector. Do not substitute general profile genres for
event/set genres. Omit those genre labels in this slice. Club genre labels
remain public club assignments with owner display labels.

The current signal inspects only eight associations per source. That can rank
candidates but cannot supply a complete favorite-name summary. Resolve matches
for the two selected cards with bounded, targeted public membership lookups.
Do not scan every full roster or imply that a partial match list is complete.
Keep summary height reserved while this separate result is pending.

For absent or failed club artwork, use its full name as responsive typographic
artwork, preserving normal card dimensions. A restrained background may vary
deterministically by stable club identity. Wrap long names and punctuation;
do not generate initials or imitate a club's owner-supplied logo. Existing safe
media handling and arbitrary-logo contain sizing remain authoritative.

Browse has a subtle control border, right-facing arrow and hover treatment.
On mobile, use wider horizontally browsable cards within each group. Preserve
access to all cards, visible/focusable controls and page-level overflow limits.
Missing event-poster redesign is not approved; keep the existing frame/fallback.

## Stable updates and loading

Source investigation found that favorites participate in the hook's effect
lifetime/context key, recreating its controller and collapsing cards to Loading.
The controller also invalidates on favorite changes. Fix both boundaries.

Current implementation default: favoriting immediately updates local marks;
keep cards visible while refreshing their recommendation inputs. Commit a ready
replacement together, with a short opacity transition and stable card slots.
Do not replace the currently focused card underneath the visitor; apply its
pending replacement when focus leaves. Inspector selection survives ordinary
reranking and does not depend on the selected card remaining recommended.
Public revocation, a changed public-query result or error still clears obsolete
data and closes genuinely unavailable details. Do not retain untrusted content
merely to preserve geometry; retain its frame instead.

First load reserves the real responsive artwork and metadata footprint. Use
quiet static placeholders and one small section-level spinner/Loading status.
Show the spinner after 150ms only if still pending; reserve space immediately.
Reveal ready content immediately with an optional 140ms opacity fade. Do not
add a minimum loading delay. Hide decorative placeholders from assistive
technology and use section `aria-busy`, with one loading announcement.

Prototype sizing uses 128px event metadata space and 72px club metadata space,
80px for mobile clubs. These are minimums, not fixed-height clipping rules.
Long content may grow. Existing content stays during ordinary refresh; initial
placeholders are not a replacement for usable warm content.

Review Home startup as a whole. Reserve the schedule toolbar, axes and four-row
chart before runtime/data arrival. Keep poster/image frames stable during decode
and panel dimensions stable while details load. Search stays usable throughout.
Settle empty and failed states explicitly; do not leave indefinite spinners.
Do not flash unavailable copy during an ordinary refresh.

Measure cold/warm readiness of search, schedule and discovery, artwork arrival,
layout shifts and preference-triggered query registrations. Compare the same
fixture/device before and after; report raw results and incomplete loads.
Separate three logical first-value reads from actual live/wire concurrency.
Keep the five-minute candidate cadence and minute-level local expiry handling.
Do not introduce tracking, unbounded queries or artificial production delays.

## Inspector and navigation

Keep the shared nonmodal side panel on desktop and bottom panel on mobile.
Link the title to the canonical full event page and add an Open full event page
icon beside Close. Remove the redundant Open event text button. Preserve native
links and modifier clicks. Escape/close returns focus without moving the page.

Use compact performer rows: name, viewer-local set time, star and interest
controls. Omit the generic DJ role label, retaining meaningful non-DJ roles.
Show one timezone/hour-format indicator; remove repeated offsets per person.
Convert each instant independently across midnight/DST. The supplied Halloween
example crosses daylight saving; never apply one fixed GMT offset to every set.
Preserve full roster pagination, unlinked authored names, selected late-page
sets, partial coverage and Retry/More behavior. Do not leak private profiles.

Remove TimelineAgenda, the view branch and dead styles/tests after migrating
shared schedule formatting. Ignore legacy `scheduleView=agenda` and remove it
when writing navigation URLs; preserve date, zone, favorites and other params.
The old chart uses Agenda for untimed records. Replace that with date-aligned
markers in the timeline for date-only events, using Time TBA and no invented
hour/duration. Open-end events retain their known-start marker. Both open the
same inspector and retain interest access. A date-only saved item has a marker,
not a proportional time bar.

Current implementation default for Next event: offer it when a quiet viewport
has a known later event in the already-loaded public schedule buffer. Navigate
to that authored start/date. Do not represent a sampled discovery candidate as
the globally next event or add a new unlimited future-search service. When no
target is known, keep date navigation and Now available. This bounded scope is
an implementation call for review, not a new discovery horizon.

## Exact copy and verification

Preserve existing approved copy. Utility labels used here include Interested,
My night, Full lineup, Browse, Next event, Loading, Retry, More, Time TBA,
Remove interest, Included with event and Favorite club: {name}. Accessible names
may include full event/performer context. Any newly authored public sentences
require BASIC's exact-copy review under AGENTS.md.

Verify cold, warm, slow, empty, failed and revoked data; keyboard/touch/reduced
motion; long names and failed images; existing saved-state compatibility;
favorites beyond the old roster prefix; dense/partial/late-page rosters;
individual versus whole-event interest; multiple overlapping choices;
date-only/open-end/cancelled events; local midnight/DST; URL restoration and
modifier links; and unchanged inspector focus during reranks.

Run real browser/visual checks at desktop and mobile sizes. Preserve fail-closed
fixture leases and cleanup verification. Refresh screenshots only after visual
review. Select ci:browsers and ci:visuals before the normal combined PR run.
BASIC performs the merge. Do not reopen #397 or create a separate spacing PR.
