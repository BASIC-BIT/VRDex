# Home timeline and night planning

Status: approved by BASIC on October 26, 2026. Implementation planning follows
this design; implementation begins after review of that plan.

## Intent and existing decisions

Home should help someone find a DJ, see what is happening, and plan where to
spend their night. The compact public search slice is merged in PR #387. This
slice adds the timeline below it without changing its search behavior.

The [interactive study](https://vrdex-timeline-study-20261022.candidchub21.chatgpt.site/)
and BASIC's subsequent feedback establish the interaction direction:

- Scroll continuously across days. No Today / Tomorrow / Upcoming tabs.
- Pack events into the first available row, independently of community.
- Leave one hour between successive events sharing a row.
- Use community logos with their original proportions and transparency.
- Keep the horizontal scale reasonably compact without making sets illegible.
- Open event poster and details in a popout while browsing continues.
- Let people favorite DJs and clubs.
- Let people add a whole event or an individual set to My night.
- Show My night separately at the top in purple. Omit it when empty.
- Reveal a small add action on desktop hover, also on keyboard focus.
- Keep copy minimal. Remove sample labels, walkthrough text and time prose.

If approved, this design supersedes the date tabs, community-based or one-event-per-row
layout, and selection behavior in the older
[whole-home draft](2026-10-21-homepage-search-schedule-design.md). Its public
visibility and authored-time requirements still apply.

## Approaches

The settled prototype leaves one sensible layout: a full-width timeline under
compact Home search. Three narrow columns would make proportional sets hard
to read. A separate schedule-only destination would leave Home unfinished.
Neither is proposed for another visual exploration.

Two persistence approaches remain possible. Account-backed saves offer device
sync but require authenticated preference storage and guest migration.
Browser-local saves let public visitors use the complete interaction without
sign-in. Current recommendation: browser-local My night and favorites for
this slice, explicitly device-local, with stable identities that can support
an independently designed account-sync migration later. This is the author's
proposal, not an already approved persistence decision.

Keep `/discovery` as the existing browse destination. A focused full schedule
route can come later. Do not replace existing discovery or build another page
as a prerequisite for a useful Home timeline.

## Home composition

Reuse the merged wordmark, shared navigation, heading and compact search.
Insert Schedule beneath search. The eventual discovery section remains later
work; do not add placeholders for it.

Schedule contains a small toolbar, continuous date/hour axis, optional My night
lanes, and public event lanes. Proposed scale starts at 100 CSS pixels per
hour, matching the compact study. Keep it adjustable in implementation based
on desktop and narrow-screen screenshots. Short cells truncate labels rather
than changing their time width. Exact identity and timing are available in
details and Agenda.

Start near the current time, with about one hour of past context. Provide Now,
earlier/later buttons and a date picker. Date selection pans the same axis;
it does not switch datasets into separate named periods. Pointer drag,
trackpad and native touch scrolling all work. Dragging must suppress accidental
event clicks without swallowing a deliberate tap.

Use a globe icon with the viewer's timezone and a clock icon with their hour
format. Accessible names explain the icons. Do not add a sentence announcing
all times or narrating how scrolling works. Default to browser timezone and
locale hour format. These are displays, not new settings in this slice.

## Event bars and row assignment

Keep at least four event rows of chart height (376px), including on quiet or
empty dates. Grow beyond that when occupied lanes require more space.

Each event has a header with community logo, event name and subdued community
name. A smaller lower track contains authored performer intervals. Use existing
identity fallbacks when a logo is missing. Logos use contain sizing in a square
space; never force arbitrary artwork into a circular crop.

For each loaded packing window, sort by authored start instant and stable
event ID. Put an event into the first top-down lane whose previous event ends
at least 60 minutes before this event begins. At exactly one hour the lane is
available. This is visual spacing; it does not change event times.

Freeze assignment within the loaded window while the user pans. Appending
later results preserves existing assignments. Prepending earlier results or
receiving material schedule edits may require repacking; do that as one
anchored update, retaining the viewed instant, selected event and focus.
Never repack because the minute clock advances or a person favorites a DJ.

An event crossing midnight remains one bar. Day bands mark local midnight.
Geometry uses absolute elapsed time, so a daylight-saving day may contain
23 or 25 hours. Repeated local hours show an offset in exact-time detail.
The Now line means current time, not verified streaming or attendance.

Do not invent endpoints. Events with no authored end appear as start markers
with an unresolved-end indication and remain available in Agenda and details.
They enter the range query only when their authored start falls in that range,
including a start exactly on its lower boundary, excluding its upper boundary.
Do not use the existing six-hour runtime eligibility fallback to carry such a
marker across later windows. They do not reserve a fabricated multi-hour bar.
Date-only events live in a
compact untimed group under their authored date. Sets with unresolved times
stay in the event lineup, outside proportional geometry. Preserve canonical
timing validation rather than independently guessing durations.

## Browsing and event details

Click an event to select it and open a nonmodal floating panel at the lower
right on desktop, similar to the accepted study. Keep the timeline's width
and scroll position. Scrolling and selecting another event remain available.
The panel scrolls internally and has a visible Close action. Escape closes
it, returning focus to the invoking control when still present.

On mobile use a bottom panel bounded to roughly half the viewport, with an
expand action for longer details. Do not dim or block the remaining timeline.
Use nonmodal semantics and a named region, not a modal focus trap. A fully
expanded detail view may cover the chart; collapsing restores browsing.

Show the intact poster, title, community, viewer-local schedule, venue,
organizer description and lineup. Reuse eligible canonical links and existing
public-event presentation rules. Open event reaches its canonical page.
Do not start media automatically. No new live-presence or stream integration.

Clicking a set opens the same event panel with that set selected and visible.
Performer profile navigation remains a separate link. Opening details does not
add anything to My night. Detail fetching must ignore stale responses when
selection changes. A failed fetch offers Retry; a no-longer-public event clears
its details and any cached public content.

## My night

Save an event reference or an event-plus-stable-slot reference. Never identify
a saved set by array index, display name or its currently rendered position.
Resolve current public timing when rendering, so schedule edits are reflected.

Desktop hover and keyboard focus reveal a small plus control on event headers
and set cells. The control has an explicit accessible name and does not trigger
the parent selection action. On touch, add/remove is available in details and
Agenda without relying on hover. Selected items show their saved state.

My night uses the same axis and horizontal scroll position as the public
lanes. Purple fill, border and a saved icon distinguish it without relying on
color alone. It disappears when there are no saved items at all. When saved
items are outside the viewport, retain the heading with a control that pans
to the next saved item; do not draw an empty lane for an unrelated day.

Pack saved items tightly into the first nonoverlapping lane. The public
timeline's one-hour breathing room does not apply to a personal itinerary.
Overlapping selections occupy separate lanes and receive a conflict marker;
never silently remove one or prevent saving it.

Adding a whole event replaces saved individual sets from that event. Its sets
then read as included. Removing the whole event leaves no saved sets from it.
Selecting a set already included in a whole-event save does not create a
duplicate. These are proposed simplification rules for this slice.

Keep unavailable references removable without displaying stale names, posters
or other revoked public metadata. Cancelled public events may retain their
current public identity with cancellation status but leave timed plan lanes.
Unresolved-time saves appear in an untimed part of My night. Do not fabricate
times to fit them on the chart.

## Favorites

Favorite eligible public people and communities by stable profile ID. Favorited
DJs receive a restrained star and warm label on their sets. Favorited clubs
receive that treatment in event identity. Purple remains specific to My night.
Favorite actions are available in details and accessible wherever shown inline.

Favorites filtering includes an event if its host club is favorited or an
eligible linked performer is favorited. Display the whole event and all its
eligible sets for context. Favorite matches never imply an endorsement,
verification or public popularity score. Manual performer names without a
linked profile cannot become durable person favorites.

Local favorites are private, have no public counts, and require no login.
Use versioned storage with validation, bounded record counts and cross-tab
updates. Proposed limits are 200 planning references and 500 favorite profile
IDs per browser. Reject another addition at the limit with the exact proposed
status "Limit reached"; do not evict existing choices. Storage failure keeps
this session usable and exposes the concise
status "Not saved" rather than claiming persistence. Never persist full public
event/profile projections or copy private grants into these records.

## Public data contract

The current `events.listPublicUpcoming` returns at most 24 previews, scans a
bounded candidate set and is centered on now. Preview `nextSlots` is not a
complete timed lineup. Neither can honestly supply this timeline.

Add a bounded, paginated public interval query. Initially fetch a 48-hour window
around the viewed instant. Prefetch neighboring windows as the viewport nears
their edge. Limit individual requests to seven days and 50 events per page,
deduplicate by stable ID, and retain at most three 48-hour windows of chart
data in the client. Exact scan budgets and index strategy belong to the plan.
They must support explicit continuation rather than silently truncating dense
or long-running events. Overlap means start before range end and authored end
after range start. Query ongoing events that began before the loaded range.

Return canonical identity/path, public host/logo, schedule kind, authored times,
status and every eligible timed slot needed for the returned interval. Fetch
full poster, prose and mixed lineup detail only for the selected event. Avoid
one full-detail query per bar. Reuse `_eventPublic` and canonical slot-publicity
rules. Hidden communities, performers and worlds must not leak through joins.

Add a separate bounded public saved-reference resolver, accepting at most 50
event/slot references per request. Resolve the browser's at most 200 plan items
in batches, independently of chart-window caches. Return current eligible
identity, canonical path, authored timing and cancellation status, or a generic
unavailable result. Missing and private references are indistinguishable.
Resolve slots by stable stored slot ID belonging to the specified event;
deleted-and-recreated slots are unavailable rather than name-matched.
Do not return publication internals, private fields or reasons for invisibility.
This supports Next saved navigation and removes revoked cached content without
fetching every intervening timeline window. While references are unresolved,
show a loading state rather than stale stored metadata or an empty plan.

Only currently public, discoverable, noncancelled scheduled events enter the
public chart. Past parts of scheduled events can remain for temporal context.
Loading or incomplete pages must not be called empty or used for a total event
count. A failed chunk preserves readable data, marks the failed range and
offers Retry. Revalidate visible data and saved references on focus and after
bounded cache expiry; revoked data must be dropped. Account permissions,
authoring and publication rules remain unchanged.

Filters must operate across the selected range, not just an arbitrary first
page. Favorite filtering may progressively drain bounded public pages, showing
an explicit loading/partial state until coverage completes. An empty favorites
view is final only once the selected interval is complete. No event-count
summary is proposed. Agenda and Timeline share the same records and filters.

## Navigation, accessibility and states

Persist an explicitly navigated anchor instant and timezone in the URL using
replacement during panning, with coarse debouncing. Date jumps and explicit
view/filter changes can create history entries. Preserve legacy root `q`
redirects. Event selection stays local to the current view; canonical links
remain the shareable detail destination. Back restores the previous anchor
without resetting search or opening an arbitrary event.

Agenda provides a chronological list with exact times and the same details,
favorites and planning actions. All timeline controls work by keyboard with
visible focus. Bars use ordinary controls, not an incomplete ARIA grid. Short
sets have usable accessible controls in Agenda and details even when their
on-chart width is too small for a touch target. Respect reduced motion and
avoid announcing every clock tick or scroll change.

Before the viewer timezone is known, reserve layout with a loading state;
never render UTC dates as though they were local. Distinguish no records,
no filter matches, pending data and failure. Search remains usable throughout.
With JavaScript disabled, preserve working GET search and existing discovery
navigation; do not claim an interactive timeline is available.

## Proposed public copy

Utility labels: Schedule, Now, Earlier, Later, Date, Timeline, Agenda,
Favorites, My night, Add to My night, Remove from My night, Included,
Favorite, Unfavorite, Open event, Close, Expand, Collapse, Retry, More,
Time TBA, Unavailable, Cancelled, Overlap, Next saved, Not saved.
Limit reached is the proposed storage-cap label.

Additional state wording for exact-copy review: "No events in this range",
"No favorites in this range", "Events unavailable", "Loading events",
"More events available", "Saved in this browser".

Use these only when their state applies. No tagline, sample banner, tutorial
paragraph, browser-storage essay or decorative filler. Accessibility names can
include event/performer identity and exact timing where necessary.

## Scope and proof

Deliver public timeline, accessible Agenda, event detail panel, browser-local
My night and person/community favorites together as this proposed slice.
Leave account sync, notifications, calendar export, social counts, recurring
series, drag-to-edit authoring and new discovery cards out of it. VRCTL remains
visual prior art only, never an integration or publishing destination.

The plan must prove interval completeness, privacy joins, authored versus
missing times, DST and midnight geometry, deterministic one-hour row packing,
stable pan/selection, stale detail protection, overlap planning, identity-safe
storage, and no-hover keyboard/touch operation. Use real local public fixtures
for end-to-end coverage and direct desktop/mobile screenshot review. Dense,
empty, failed, long-name, missing-logo and unavailable-saved-item states need
coverage. Keep existing Home/search and legacy lookup checks passing.

Builder choices include component boundaries, suitable shared nonmodal panel
primitives, exact responsive dimensions, measured scan budgets and cache
invalidation mechanics. These may not change the public visibility guarantees,
invent timing or silently weaken completeness.
