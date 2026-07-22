# Product Direction

## Status

Current recommendation from the July 9, 2026 product-direction pass.

This is the durable product compass for maintainers and agents. Keep detailed
feature designs in focused planning docs, but use this document to preserve what
VRDex is trying to become, what it is not, and how new work should be shaped.

## Product Identity

VRDex is a VR-first identity, profile, events, and scene-operations platform.
VRChat is the first ecosystem and implementation focus, not the limit of the
public product category.

Current recommendation:

- VRDex should become the trusted public identity and presence layer for the
  VRChat scene.
- The first strong user is the event operator who needs people, links, assets,
  set times, events, and publishing workflows to line up cleanly.
- The first public proof of value is not marketing copy. It is real data:
  events happening today, the people in those events, the communities hosting
  them, the worlds involved, and the links or media that make those records
  useful.
- Profiles, communities, events, worlds, links, slots, sets, interest signals,
  follows, provenance, privacy controls, and public APIs are the primitives.
  Surfaces such as Home, search, lookup, event timelines, profile pages, and
  operator tools are focused compositions of those primitives.

VRDex should not collapse into only one of these:

- a VRCTL clone
- a generic Linktree clone
- a booking bot
- a wiki
- a social network feed
- a marketing landing page

The product can compete with pieces of those categories while remaining a
broader data and workflow layer.

## Product Wedge

Current recommendation:

- Start with the operator workflow because it has concrete pain and clear
  utility.
- The strongest early job is helping an event operator or lineup wrangler get
  approved performer links, logos, genres, stream links, set times, Discord
  timestamp output, and event publishing artifacts without repeated manual
  re-entry.
- Public profiles matter because they make that workflow reusable: a performer
  can own one page and communities can reference it repeatedly.
- Public event surfaces matter because they turn the identity graph into a
  useful scene map.
- Search and lookup matter as direct-intent tools. They should be fast, visible,
  and useful before the broader discovery graph has enough density.

## Homepage Direction

Locked decision:

- For the current product stage, direct lookup is the root experience.
- Preserve the event-oriented discovery surface at `/discovery` while its
  content density, naming, and ranking mature.

Current recommendation:

- The long-term discovery surface should include a timeline-style view of
  events happening today.
- The valuable unit is "what is happening when," not a loose list of event
  cards.
- The first implementation may use event cards or a list if that is the
  shippable slice, but the target should be a time-oriented schedule surface.
- The timeline surface does not need to consume the whole homepage. It can be a
  primary module with a route to a focused full-page schedule.
- The final public name should probably not be `timeline` if that collides with
  other product meanings.
- Direct search should remain prominent for exact lookup.
- Home should lead with utility and data, not explanatory product copy.

See `docs/planning/homepage-discovery-direction.md` for the detailed Home,
search/discovery, ranking, and copy direction.

## Navigation Shape

Current recommendation:

- Prefer focused entry points over a shallow homepage that tries to show
  everything.
- A deeper navigation structure is acceptable and probably necessary as long as
  each route has a clear job.
- The root experience should stay selective about attention.
- Search should handle direct lookup.
- `/`, `/lookup`, and later operator tools should optimize for dense workflow
  utility during the current stage.
- Event schedule/timeline views should optimize for "what is happening when."
- Profile and community pages should optimize for canonical identity and
  owner-controlled presentation.

The product can have a mountain of structured data underneath the hood. The UI
should reveal it progressively by task.

## Copy And Public Tone

Locked decision:

- Public copy needs human taste review before production merge.

Current recommendation:

- Less is more.
- Stand by the data.
- Use headers, labels, and direct facts instead of long explainers.
- Any non-obvious explanatory copy, tooltip, onboarding prompt, or trust text
  should be deliberately crafted and reviewed.
- Do not expose implementation uncertainty or internal provider mechanics in
  public copy unless the user must act on it.
- Avoid generic AI-flavored value propositions.

The goal is not a blank website. The goal is that every sentence earns its
space.

## Privacy And Social Signals

Locked decision:

- Follows, favorites, saves, and interest signals should be private by default.

Current recommendation:

- Aggregate counts may be public when they do not expose individual users, but
  owners should be able to hide or show those counts on their own profile or
  community page.
- Ranking and personalization should start from explicit user actions such as
  follows, favorites, event interest, saved calendar items, and chosen
  interests.
- Avoid opaque recommendation copy.
- Avoid unconsented attendance inference, private presence inference, and
  background "where did this user spend time" data collection.
- Friend-aware discovery remains a privacy-reviewed future direction, not a
  default homepage assumption.

## Events, Roles, And Slots

Locked decision:

- Generic event participation is not the same thing as a role-specific event
  slot.

Current recommendation:

- A person can be associated with an event in a broad way.
- A person can also occupy a first-class slot, such as a DJ set, dance slot,
  VJ slot, host slot, photographer role, or another scoped contribution.
- DJ-oriented flows should be first-class where they solve real operator pain,
  without hard-coding the whole product into one rave-only taxonomy.
- Role and slot vocabulary should stay flexible enough for non-club events.
- Slot records should be able to link to profiles, display labels, schedule
  times, confirmation state, media links, and later set/performance artifacts.

## Sets And Performance Artifacts

Current recommendation:

- VRDex should support first-class set or performance artifacts linked to a
  person, an event, and optionally a specific event slot.
- The first practical version should support external links such as SoundCloud,
  Mixcloud, YouTube, archive links, or a performer's own site.
- Hosted DJ-set upload is a tempting future product direction, but it needs its
  own design pass for audio quality, storage cost, streaming cost, copyright,
  moderation, takedowns, download controls, and self-hosting posture.
- If hosted audio exists, independent high-quality uploads must be supported.
  A stream capture can be useful, but it should not be treated as the quality
  baseline when performers may have local Audacity, Audition, Ableton, or
  recorder output.
- Restream-derived automatic set capture is a candidate direction, especially
  if VRDex operates the event media pipeline, but it needs trimming, waveform
  review, silence snapping, explicit owner approval, and quality checks before
  publication.
- Download permission should be owner-controlled.

Open research:

- actual storage and egress unit economics for large DJ sets
- audio quality expectations and encoding targets
- copyright and takedown policy
- whether hosted sets belong in VRDex core, a premium tier, a self-hosted
  module, or a later companion service

## Structured-Language Utilities

Locked decision:

- VRDex may own public utility endpoints when they are useful on their own and
  also form dependable building blocks for core product workflows.
- Language models used in creator-facing flows should primarily understand and
  structure user-provided intent. They must not replace a creator's voice or
  silently publish generated creative content by default.
- Probabilistic interpretation and durable mutation are separate operations.
  Users review an editable draft before event, profile, or schedule data is
  created.

Current recommendation:

- VRDex Time is the first utility: a specialized temporal model produces a
  constrained plan and deterministic code produces the canonical answer.
- Future event drafting may use a fast general model to extract event fields and
  send the temporal fragment to VRDex Time.
- Compare that orchestration against a general model using deterministic tools;
  choose from measured accuracy, latency, and cost rather than architectural
  preference.
- Treat poster parsing as reviewable extraction with provenance, not
  owner-confirmed fact.

See `docs/planning/temporal-parsing-service.md` for the first implementation.

## Design System Direction

Current recommendation:

- VRDex has a code-owned semantic contract for color, typography, spacing,
  layout, density, focus, radii, elevation, entity cards, metadata, and event
  schedule rows.
- Homepage and theme exploration can proceed against that contract without
  inventing route-local styling.
- Additional themes remain candidate mappings until their contrast, public
  routes, and component states have been visually reviewed.
- Shared primitives and tokens should be preferred over one-off Tailwind
  treatments.
- Public UI should feel calm, minimal, trustworthy, and data-forward.

See `docs/engineering/design-system.md` for the contract and adoption gaps.

## Development Pattern

Current recommendation:

- Turn large product uncertainty into docs and issue-ready slices before
  coding.
- Preserve the ambitious direction, but ship in narrow, testable vertical
  slices.
- Label decisions honestly as locked decisions, current recommendations,
  candidate directions, interview-later items, or open research.
- Use visual verification for meaningful UI changes.
- Do not let a future platform vision block the smallest useful operator or
  public utility slice.
- Do not add complexity just because the data model can support it.

## Interview Later

- What should the public event schedule surface be called if not `timeline`?
- Which aggregate counts should be visible by default, owner-hidden by default,
  or never public?
- Which slot roles deserve first-class presets beyond DJ, VJ, host, dancer, and
  photographer?
- What quality threshold would performers expect before trusting hosted set
  playback?
- Which public copy phrases feel human enough to keep?
