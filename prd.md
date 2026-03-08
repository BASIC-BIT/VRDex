# VRDex PRD

## Status note

This is an evolving PRD.

- locked decisions should be called out explicitly when they are truly decided
- anything else should be treated as a candidate first pass, not final product truth
- unresolved areas should be captured as interview topics instead of silently hardening into policy

Locked so far:

- stack direction is `Next.js + Convex + AWS + Stripe + Docusaurus + Vercel`
- clubs and groups are first-class entities
- unclaimed profiles can appear in search if clearly labeled
- customization target is polished link-page-builder flexibility, not raw HTML/CSS
- the product should be open source and self-hostable
- public docs and public API posture are part of the vision, not optional extras

## Product

`VRDex` (`vrdex.net`)

## One-line pitch

VRDex is a VRChat-first directory and profile platform for people and clubs, combining verified identity, customizable public pages, and event presence in one place.

## Why now

- VRChat scenes already run on fragmented identity packets: links, logos, bios, contact info, Discord servers, and group pages
- DJs and clubs repeatedly answer the same questions in DMs
- the scene already accepts Discord<->VRChat linking and verification
- partner products exist, but public portable identity is still fragmented

## Problem statement

There is no single trusted, shareable page that combines:

- person identity
- club identity
- public links and assets
- trust / ownership signals
- upcoming appearances
- VR-native integrations

Generic link-page tools are not scene-aware, and scene tools are not yet the canonical identity layer.

## Product vision

VRDex becomes the canonical public directory for the VRChat scene:

- people can own a profile
- clubs can own a profile
- community members can seed missing entries
- partner systems can point to one canonical page
- fans can see where someone is playing next

## Primary audiences

### People

- DJs
- VJs
- hosts
- photographers
- performers
- organizers

### Clubs

- venues
- collectives
- brands
- communities
- agencies

### Consumers

- bookers
- event staff
- club owners
- fans
- community members

## Core product pillars

### 1. Identity

- public person and club profiles
- claim flows
- verification badges
- source attribution

### 2. Presentation

- avatar, logo, banner
- theme presets
- section ordering
- Linktree-like block layout

### 3. Privacy

- field-level visibility after claim
- public, unlisted, private controls
- verification without forced public disclosure

### 3b. Guided onboarding

- concierge-prepared drafts
- handoff invitations
- first-run setup wizard

### 4. Presence

- upcoming appearances
- recent appearances
- club activity summaries
- source-aware event listings

### 5. Integrations

- Discord
- VRChat
- VRCLinking
- Decked Out
- VRC Pop

### 5b. Open platform posture

- public API
- self-hostable deployment path
- public documentation
- room for a public or self-hostable MCP later

### 6. Monetization

- likely paid creator and paid club tiers, exact packaging still to be interviewed
- Stripe-backed subscriptions
- room for future premium appearance/analytics features

Current recommendation:

- free tier should include core club operations, rosters, staff management, and normal profile usage
- paid tiers should lean toward additional customization, premium presentation, and deeper insights rather than locking basic collaboration behind payment

## v1 goals

- launch a clean public profile system for people and clubs
- make claims and verification feel trustworthy
- let owners control visibility on every field
- support avatar/banner customization and strong sharing UX
- show upcoming appearances on person pages
- support at least one meaningful integration path
- establish the billing foundation early so premium plans do not require a later rewrite

## v1 non-goals

- full club operations suite
- full booking management platform
- direct competition with Decked Out scheduling flows
- direct competition with VRC Pop live-scene views
- dependence on VRCTL access
- freeform HTML/CSS customization
- a giant enterprise billing matrix on day one

## Functional requirements

### Profiles

- create person profile
- create club profile
- create unclaimed community-submitted profile
- claim an existing profile
- edit profile fields
- set per-field visibility
- upload or import avatar/banner/logo assets
- configure page order and featured sections
- support concierge-created private drafts
- support handoff invite acceptance flow
- support a first-run wizard for newly claimed or handed-off profiles
- support opt-out controls for people or clubs that do not want to be listed

Current recommendation for ordinary community submissions:

- allow a narrow public field set only: display name, aliases, genre/tags, public links, logo/image, and source note
- do not allow private contact info or anything implying verified ownership
- likely do not allow fully freeform bios from ordinary public submitters in v1

### Billing

- support Stripe customer creation and subscription lifecycle
- map plan entitlements to product capabilities
- support a free tier plus at least one or two paid tier concepts, exact plan boundaries still to be decided
- support webhook idempotency and audit logs
- support billing portal access for self-serve plan management

Current recommendation:

- roster tools belong in free
- normal staff features belong in free
- paid value should come from added insights, unlocks, and premium customization

### Trust

- Discord login for ownership
- VRChat proof-code verification
- optional VRCLinking attestation support
- native VRChat linking support if usable
- visible badge and source model

### Club permissions and ownership

- support club claim by an initial owner
- support ownership transfer
- support staff membership and role assignment inside a club
- support granular permissions for club management actions
- start with a pragmatic permission set for MVP, not a full Discord-sized policy system

Locked decision:

- the initial delegable actions should include editing the club profile, managing appearances/events, managing staff/roles, managing integrations, and managing billing
- ownership transfer stays owner-only and should use an acceptance flow
- clubs should have exactly one owner in v1
- clubs must be able to add unclaimed roster members

Current recommendation:

- treat `owner` as the only reserved/special role
- seed clubs with familiar default roles like `admin` and `mod`
- let admins manage billing by default, while keeping the most dangerous ownership-sensitive billing actions constrained
- avoid hard-coding every non-owner role forever; role structure should be able to evolve

Interview later:

- whether v1 supports fully custom role creation or only editable default roles
- which exact billing actions count as dangerous and remain owner-only

### Profiles versus users

Locked decision:

- a profile is its own record and can exist before any user claims it
- linking a user later changes authority over the profile, not the identity of the profile record itself
- clubs and people should be referable throughout the product even before claim

Why this matters:

- clubs need to add unclaimed roster members and appearances early
- community submissions and concierge drafts need durable profile records
- claims should attach to existing profiles cleanly instead of creating duplicate identities

### Listing opt-out

Locked decision:

- people and clubs need an opt-out mechanism that can prevent unwanted listing by third parties
- valid opt-out should suppress public surfacing regardless of format, not just dedicated profile pages

Important distinction:

- a normal self-service opt-out comes from the claimed owner of a profile
- before claim, any suppression request is a separate verified moderation/safety flow, not ordinary self-service profile control

Current recommendation:

- the ideal behavior is case-by-case handling based on abuse risk
- practical MVP fallback is to leave entries visible until review unless and until stronger abuse-risk detection exists

Interview later:

- what proof is required for pre-claim suppression requests
- whether opt-out should hard-block new submissions or queue them for moderation review

### Events and appearances

- attach upcoming appearances to a person profile
- attach upcoming appearances to a club profile
- store source attribution per appearance
- allow manual confirmation of appearance records
- support AI-assisted extraction from event descriptions

Current recommendation:

- appearance entries can exist without a full standalone event page in the first slice
- minimum event/appearance structure should include title, club, start time, optional end time, source, optional link, and optional notes
- event/location modeling should leave room for VRChat world linkage, platform compatibility hints, and DJ slot breakdowns
- stream/watch links should use typed media link categories in v1, while still allowing generic/other links and multiple links where needed
- when a claimed person is added to an appearance in v1, they should receive a passive in-app notification
- claimed people should be able to choose whether they are simply notified when added; stronger approval gates can land later

Candidate direction:

- disputed appearances may need the club page and person page to diverge temporarily
- one likely approach is to let the club keep the slot/name while removing or disabling the hotlink/public association to the person's main profile until resolved

### Discovery

- search by name
- search by alias
- filter by profile type
- filter by genres / vibe tags
- filter by verification state
- browse upcoming appearances

## UX principles

- mobile-first shareability
- no ugly defaults
- expressive but bounded customization
- zero confusion around what is public vs private
- every public page should be legible as a media kit
- customization target is polished link-page builder flexibility, not full webpage coding
- overall product tone should feel calm, minimal, and easy to trust

## Trust model

Every public fact should have both:

- a visibility state
- a provenance source

Examples:

- booking email: private, owner-entered
- Discord handle: public, imported from Discord
- VRChat group: public, verified by proof code
- upcoming event: partner-confirmed or AI-suggested pending review

Authority levels should also differ by origin:

- owner-confirmed
- concierge-prepared but not yet confirmed
- community-submitted
- partner-confirmed
- AI-suggested

Discovery rule:

- community-submitted profiles can still appear in search results
- they must be visually marked as unverified or community-submitted
- claimed and verified profiles should outrank them
- profiles or identities under a valid opt-out should not be surfaced publicly through profiles, roster displays, appearance references, or similar discovery features

## Event intelligence approach

Use LLMs where they help, not where they replace trust:

- parse event descriptions for possible lineup entities
- extract likely set times
- normalize names against known people/clubs
- queue matches for confirmation

Do not auto-publish low-confidence extractions as hard facts.

Streaming and world-awareness direction:

- events should eventually support VRChat world linkage
- world linkage can enable world previews and platform hints such as PC-only or Quest-compatible guidance
- DJ/media links may need multiple variants, especially VRCDN PC vs Quest behavior
- more advanced stream/player knowledge is valuable, but can land after the core appearance model exists

## Low-priority R&D ideas

Candidate direction:

- an avatar showcase viewer for profiles, ideally using a non-rippable or harder-to-rip representation instead of shipping a raw avatar model to the browser
- the most promising direction is likely an imposter-style or sprite-angle-rendered pipeline, potentially generated through a companion creator/VCC workflow

Interview later:

- whether this belongs in VRDex itself, a companion VCC plugin, or both
- whether the first version should be a faux-3D viewer, a turntable sprite set, or a richer avatar presentation mode

## Relationship graph direction

Candidate direction:

- a later relationship/knowledge graph could be genuinely powerful for showing affiliations, collaborations, appearances, and scene history
- if done poorly, it risks becoming a gimmick or an over-modeled UX burden

Current recommendation:

- do not force a heavy relationship taxonomy into v1
- start with simpler roster and affiliation mechanics unless clear product value justifies more structure

## Documentation approach

Ship documentation infrastructure from day one.

Recommended direction:

- Docusaurus in the main repo
- public product docs for users and partners
- internal docs for engineering, moderation, integrations, and agent notes
- skills remain thin and mostly route agents toward canonical docs pages

## Open source and public platform approach

Locked direction:

- the project should be open source
- the project should be self-hostable
- infrastructure configuration should live in the repo
- public APIs should be documented clearly and rate-limited responsibly

Current recommendation:

- frontend/server rendering can use internal server-side data paths where convenient
- external consumers should still get a documented public API with independent rate limiting and partner-aware limits when justified
- a public MCP or self-hostable MCP is a promising later extension

## Quality and verification approach

VRDex should be built with layered verification loops from day one.

Minimum target layers:

- unit tests
- integration tests
- typed schema and contract checks
- e2e Playwright flows
- Playwright visual regression
- VLM review of changed screenshots for UI work
- CI artifact capture for screenshot diffs

Near-term stretch layers:

- PR preview environment checks
- automated feature demo capture (screenshots/video)
- AST-based policy checks
- unused dependency / dead code checks
- automated review-recycle loops for PR comments

Important caveat:

- truly private internal docs require auth or a separate internal deployment, not just hidden navigation

## Interview backlog

These topics should be revisited in later product interviews rather than treated as settled:

- exact free vs paid feature boundaries
- whether paid plans are person-based, club-based, or both
- whether concierge setup is a paid service, a manual growth tactic, or both
- which appearance/event features are free vs premium
- which integrations are launch-critical vs later
- which profile customization options are available to free users
- what the minimum viable club permission roles should be at launch
- whether transfer-of-ownership should require one-step transfer, acceptance flow, or admin recovery path

## Success metrics

- number of claimed profiles
- number of club profiles
- share-page visits per profile
- percentage of profiles with imported or uploaded assets
- percentage of public profiles with at least one upcoming appearance
- number of partner-sourced confirmations

## Ideal v1 user stories

### DJ story

"I claim my profile, import my Discord avatar, upload a banner, hide my private contact details, and send one link whenever a club asks for my info."

### Club story

"I claim my club page, link my Discord and VRChat group, add my branding and booking info, and use the page as the public home for my community."

### Fan story

"I visit a DJ page, see what they sound like, where they are playing next, and which clubs they are affiliated with."

## Recommended build order

1. auth, claims, and core schema
2. person and club profile pages
3. asset handling, visibility controls, and first-run wizard
4. concierge drafts and handoff flow
5. billing foundation and plan entitlements
6. upcoming appearances model
7. partner/event ingestion
8. AI-assisted matching and confirmation workflow

## Phase framing

### v0.5

- pre-MVP but demoable
- core profiles
- claims
- privacy basics
- community submissions
- calm public pages

Current target slice:

- person profiles
- club profiles
- claim flow
- privacy controls
- community submissions
- unclaimed search labeling
- basic upcoming appearances
- calm polished public pages

Explicitly not in the first demo slice:

- billing
- notifications
- partner integrations
- AI extraction
- advanced club permissions beyond basics

### v1

- real release candidate
- club management basics
- roster basics
- upcoming appearances
- billing foundation
- public docs and public API foundation

### v1.5

- immediate follow-on improvements
- richer event ingestion
- notifications and approval settings
- AI-assisted extraction and matching
- deeper insights and premium polish

## Strong product bet

VRDex wins by being the trusted public identity and presence layer for the scene.

If that works, deeper club tooling becomes a natural extension instead of a premature pivot.
