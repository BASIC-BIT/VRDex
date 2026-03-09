# Issue Drafts

## Status note

This file captures issue bodies that were drafted during planning chat so they do not live only in conversation history.

- these are working drafts, not final GitHub issues yet
- once reviewed, they should be turned into real GitHub issues
- future issue drafting should be recorded here or created directly in GitHub, not left only in chat

## EPIC-01 Profile foundation

### Create base profile schema for people and communities

Problem:

VRDex needs a single durable profile model that supports both people and communities as first-class records, independent from user claims.

Scope:

- define the base profile schema
- support `person` and `community` profile types
- include core identity and presentation fields
- include publication and claim state foundations
- keep the schema compatible with unclaimed/community-created records

Non-goals:

- claim flow implementation
- advanced permissions
- billing
- events
- search indexing

Acceptance criteria:

- a base profile schema exists for both people and communities
- profile type is explicit
- core identity fields are present
- claim/publication state fields exist
- the schema supports records that exist before any linked user account
- the schema is documented well enough to support follow-on issues

### Add slug generation and uniqueness rules

Problem:

VRDex profiles need clean, stable, human-readable URLs. Owners should be able to choose their own slug, but the system must enforce uniqueness, validation, and safe fallback behavior.

Scope:

- define slug validation rules
- support initial slug generation
- support owner-set custom slugs
- enforce uniqueness across the profile namespace
- define fallback behavior when a desired slug is unavailable
- treat slugs as independent from login/account identifiers

Non-goals:

- custom domains
- slug history redirects
- SEO optimization beyond core canonical URLs
- tying URLs to VRChat display names
- advanced moderation beyond basic validation and reservation rules

Acceptance criteria:

- every profile has a canonical slug
- owners can choose or update a valid slug when available
- slugs are unique across the profile namespace
- invalid or reserved slugs are rejected
- slug rules are documented clearly enough for frontend and backend consistency
- canonical URLs do not depend on Discord or VRChat login identifiers

Follow-on issues worth filing later:

- add custom domain support for profiles
- add slug history and redirect behavior
- improve public profile SEO and metadata strategy

### Add profile type-aware core fields

Problem:

People and communities share a core profile system, but they still need some type-aware fields so the product can present the right data without overfitting the schema too early.

Scope:

- define core shared fields for all profiles
- define type-aware fields for `person` and `community`
- keep community category/subtype flexible
- ensure fields support unclaimed, claimed, and community-submitted states
- document which fields are shared vs type-specific

Non-goals:

- rich event modeling
- advanced permissions
- full taxonomy design
- deep subtype-specific forms
- partner-specific imported metadata

Acceptance criteria:

- shared core fields are defined clearly
- `person`-specific fields are defined clearly
- `community`-specific fields are defined clearly
- the model stays flexible enough for future community subtypes
- the field model is documented well enough for UI and backend implementation
- the schema does not require a rigid subtype taxonomy in `v0.5`

### Add profile read/write permissions baseline

Problem:

VRDex profiles can exist before claim, can be community-submitted, and can later become owner-controlled. We need a baseline permission model so profile reads and edits behave consistently from the start.

Scope:

- define who can read public profiles
- define who can edit unclaimed profiles
- define who can edit claimed profiles
- define baseline owner authority
- define baseline community-submission limits
- define moderation override assumptions at a basic level

Non-goals:

- advanced role delegation
- full moderation console
- community internal permission matrix
- approval workflows for every edit
- billing entitlements

Acceptance criteria:

- public profile visibility rules are defined
- claimed-owner edit authority is defined
- community-submission edit boundaries are defined
- sensitive fields are protected from ordinary community edits
- moderation override assumptions are documented
- the model is clear enough to implement without ambiguity

## EPIC-02 Claim and ownership

### Implement unclaimed vs claimed profile states

Problem:

VRDex profiles need to exist before ownership is established, but the product also needs to clearly distinguish profiles that are merely present in the directory from profiles that are actually controlled by their owner.

Scope:

- define claim state values for profiles
- distinguish unclaimed, claimed-unverified, and claimed-verified states
- expose claim state to UI and business logic
- support transition from unclaimed to claimed without changing profile identity
- document how claim state affects authority and trust labeling

Non-goals:

- full Discord claim flow implementation
- VRChat proof-code verification implementation
- concierge handoff
- notifications
- partner attestation logic

Acceptance criteria:

- profiles can exist in at least unclaimed and claimed states
- claim state is available to the backend and frontend
- claim state is reflected in trust labeling behavior
- state transition does not create duplicate profiles
- the state model is documented clearly enough for follow-on claim issues

### Implement Discord claim flow for person profiles

Problem:

The simplest and most familiar ownership path for a person profile is Discord. VRDex needs a clear, low-friction claim flow that lets a real user connect themselves to an existing person profile and gain authority over it.

Scope:

- support Discord-authenticated claim initiation for person profiles
- link a claimed profile to a Discord-authenticated user
- handle claiming an existing unclaimed profile
- handle creating a fresh claimed profile when no matching profile exists
- expose claim result/state to the UI
- document any confidence assumptions in the Discord claim path

Non-goals:

- community claim flow
- VRChat proof-code verification
- advanced conflict resolution
- partner attestation
- ownership transfer

Acceptance criteria:

- a signed-in Discord user can claim an existing unclaimed person profile
- a signed-in Discord user can create a new claimed person profile if no suitable record exists
- claiming attaches authority to the existing profile rather than creating duplicates when a match is used
- the claimed profile becomes owner-controlled after success
- the flow is documented clearly enough for later trust and moderation work

Implementation note:

- avoid aggressive auto-match in `v0.5`; prefer explicit suggested matches or direct-claim context

### Implement Discord-based claim flow for community profiles

Problem:

Communities need a practical way to prove ownership and take control of an existing VRDex community profile. Discord is the most natural first path, since many communities are centered on a Discord server even when they also exist in VRChat.

Scope:

- support Discord-based claim initiation for community profiles
- verify that the claiming user has the required level of authority over the relevant Discord server
- attach ownership to an existing unclaimed community profile
- support creating a new claimed community profile when needed
- keep the one-owner model intact in v1
- expose claim state/result to the UI

Non-goals:

- ownership transfer flow
- advanced delegated permissions
- VRChat group verification
- partner attestation
- complex conflict resolution

Acceptance criteria:

- a qualified Discord-authenticated user can claim an existing unclaimed community profile
- a qualified Discord-authenticated user can create a new claimed community profile when needed
- claim attaches to an existing community profile rather than duplicating identity when matched
- v1 preserves the one-owner model
- the flow is documented clearly enough for later permissions and moderation work

### Add VRChat proof-code verification path

Problem:

Discord is a strong claim path, but VRDex also needs a VRChat-native ownership signal. A proof-code verification path gives people and communities a platform-specific way to verify identity using visible VRChat profile or group data.

Scope:

- generate proof codes for verification attempts
- support person verification via VRChat profile text/location agreed fields
- support community verification via VRChat group text/location agreed fields
- verify proof-code matches through VRChat-integrated reads
- attach verification result to the existing profile record
- expose verification result to trust labeling and product logic

Non-goals:

- full automated trust scoring
- native VRChat account-linking replacement
- partner attestation
- claim flow by itself
- advanced moderation tooling around proof disputes

Acceptance criteria:

- a proof-code verification path exists for person profiles
- a proof-code verification path exists for community profiles
- successful verification attaches to the existing profile rather than creating a new one
- verification state can be reflected in trust labeling
- the proof-code flow is documented clearly enough for frontend and backend implementation

### Add authority transition from unclaimed to claimed profile

Problem:

Claiming a profile should not create a new identity object. VRDex needs a clear authority-transition model so an existing unclaimed profile becomes owner-controlled while preserving URLs, source history, references, and related records.

Scope:

- define the authority transition when a profile is claimed
- preserve the existing profile record through the transition
- preserve source history, references, and associated records
- update edit authority and trust labeling after claim
- document how claim changes profile control without changing profile identity

Non-goals:

- ownership transfer between already claimed owners
- merge tooling for multiple duplicate profiles
- full moderation dispute resolution
- notification flows
- deep audit UI

Acceptance criteria:

- claiming a profile does not create a duplicate profile record
- ownership/authority changes are attached to the existing profile
- related records such as roster references and event associations remain linked
- claim changes edit authority and trust labeling correctly
- the transition model is documented clearly enough for follow-on merge/conflict work

### Implement multi-provider account login for v0.5 (Discord, Google, email/password)

Problem:

VRDex should not be architected around Discord-only account access. The first release needs a flexible account layer that supports multiple login paths while keeping identity verification and trust source modeling separate.

Scope:

- support Discord login
- support Google login
- support email/password login
- require verified email before email/password accounts can perform claim-level actions
- unify sessions/account handling across providers
- keep provider login separate from verification and attestation state

Non-goals:

- every future social login provider
- VRChat OAuth login
- X login
- full account-linking UI for all providers
- advanced account recovery flows beyond a reasonable baseline

Acceptance criteria:

- users can create/access accounts through Discord, Google, or email/password
- email/password accounts require email verification before claim actions
- provider choice does not force one verification source or one trust model
- the account layer is documented clearly enough for follow-on claim and verification work

Follow-on issues worth filing later:

- add additional social login providers
- add native VRChat OAuth login if viable
- add richer linked-account management UI

## EPIC-04 Community submissions and trust labeling

### Build community profile submission flow

Problem:

VRDex needs a way for logged-in users to seed the directory with missing people and communities before those entities claim their profiles themselves.

Scope:

- build the public/community-facing submission flow
- support creating unclaimed person and community profiles
- enforce the approved narrow field set for ordinary community submissions
- capture source attribution for who submitted the entry
- route created entries into the normal unclaimed profile system

Non-goals:

- concierge/handoff flow
- claim flow
- moderation console
- freeform public bios
- advanced trust/ranking behavior beyond baseline labels

Acceptance criteria:

- a logged-in user can submit an unclaimed person profile
- a logged-in user can submit an unclaimed community profile
- the flow only allows the approved safe field set
- source attribution is stored and available for later display/moderation
- submitted records enter the system as unclaimed profiles, not a separate object type
- freeform public-submitted bios are not allowed in v1 unless explicitly constrained later

### Add community-submitted / unverified trust labels across cards and pages

Problem:

Community-submitted profiles are useful, but they must never be mistaken for owner-claimed or verified entries. VRDex needs explicit trust labels anywhere those profiles appear publicly.

Scope:

- add visible community-submitted / unverified labeling on profile cards
- add visible community-submitted / unverified labeling on profile pages
- support tooltip/help text explaining what the label means
- keep trust labels consistent across search and profile surfaces

Non-goals:

- search ranking logic itself
- moderation console
- advanced trust scoring
- partner attestation labeling
- claim flow implementation

Acceptance criteria:

- unclaimed community-submitted profiles are visibly labeled in cards
- unclaimed community-submitted profiles are visibly labeled on profile pages
- help text explains that the information is based on third-party submission until claimed
- labeling is consistent across the public product
- trust labels do not imply verification where none exists

### Add source attribution display and basic moderation rollback trail

Problem:

If VRDex allows community submissions, the system needs to preserve who added information and enough revision history to support trust, accountability, and moderation recovery.

Scope:

- display source attribution for community-submitted profiles
- store enough revision/audit data to support rollback or correction later
- expose a basic moderation-facing trail, even if the moderation UI itself is minimal at first
- connect attribution to the public trust model

Non-goals:

- full moderation dashboard
- advanced abuse scoring
- LLM moderation
- rich moderation workflows
- complete audit productization

Acceptance criteria:

- community-submitted profiles show who or what source created them where appropriate
- revision history is stored in a way that supports rollback/correction
- moderation has enough baseline data to understand provenance
- attribution and revision handling are documented clearly enough for later moderation work

## EPIC-05 Privacy and opt-out controls

### Add field-level visibility model and owner privacy controls

Problem:

Claimed owners need to control what parts of their profile are public, unlisted, or private without having to hide or delete the whole profile.

Scope:

- support field-level visibility states
- support `public`, `unlisted`, and `private`
- let claimed owners edit visibility for supported fields
- expose visibility cleanly in profile editing UX
- ensure frontend and backend behavior stay aligned

Non-goals:

- listing opt-out
- advanced moderation logic
- notification flows
- community internal permission controls
- every possible field type in one pass

Acceptance criteria:

- claimed owners can set visibility on supported profile fields
- the system correctly respects field visibility in public rendering
- field visibility behavior is consistent between frontend and backend
- visibility controls are understandable in the editing UX
- field privacy is clearly distinct from profile-level opt-out behavior

### Add claimed-owner listing opt-out flow

Problem:

Some people or communities do not want to be publicly listed at all by third parties. VRDex needs a self-service opt-out mechanism for claimed owners that is stronger than field-level privacy.

Scope:

- let a claimed owner request or enable listing opt-out
- suppress public surfacing of that profile across profile pages, roster displays, and event participant references
- model opt-out separately from ordinary field visibility
- make the UX clear enough that users understand the difference between privacy and opt-out

Non-goals:

- pre-claim suppression moderation workflow
- abuse-risk scoring
- nuanced partial opt-out edge cases
- internal-only suppression exceptions

Acceptance criteria:

- a claimed owner can enable listing opt-out
- valid opt-out suppresses public surfacing across the intended public surfaces
- opt-out is modeled separately from ordinary field privacy
- the UX clearly explains what opt-out does
- the behavior is documented clearly enough for moderation and discovery work

### Add pre-claim suppression moderation workflow

Problem:

Before a profile is claimed, the real person or community may still need a way to request suppression. VRDex needs a baseline moderation workflow for pre-claim suppression requests, even if the MVP handling stays simple.

Scope:

- support pre-claim suppression request intake
- track suppression request state
- support moderation review state for those requests
- support the MVP fallback behavior of visible-until-review
- leave room for later abuse-risk-based handling

Non-goals:

- full moderation dashboard
- mature abuse-risk scoring
- automated decisioning
- full notification workflow
- every edge-case policy for suppression

Acceptance criteria:

- pre-claim suppression requests can be recorded and reviewed
- request state is tracked in a way that moderation can understand
- MVP fallback behavior is clear and implementable
- the system leaves room for stronger abuse-risk handling later
- the workflow is documented clearly enough for policy and moderation follow-on work

### Enforce public surfacing suppression across search, rosters, and event associations

Problem:

Opt-out and suppression only matter if they are applied consistently everywhere public identity can surface. VRDex needs one coherent enforcement layer across the public product.

Scope:

- suppress opted-out/suppressed identities from public search
- suppress them from public roster displays
- suppress them from public event participant references
- keep enforcement behavior consistent across public surfaces
- align enforcement with the distinction between field privacy and listing opt-out

Non-goals:

- internal moderation views
- private/internal references
- advanced abuse-risk decisioning
- analytics/reporting around suppression

Acceptance criteria:

- opted-out or suppressed identities do not appear on affected public surfaces
- search, roster, and event participant rendering use consistent enforcement behavior
- suppression logic does not get confused with normal field privacy
- the enforcement model is documented clearly enough for future API and moderation work

## EPIC-06 Search and discovery basics

### Implement public search across people and communities

Problem:

VRDex needs a real public directory experience, and that starts with search. Users need to be able to find people and communities by the most obvious fields without depending on manual URL sharing.

Scope:

- implement public search across people and communities
- support name and alias matching
- support profile type-aware results
- support tag/genre matching at a basic level
- make the search useful for the `v0.5` public product

Non-goals:

- advanced recommendations
- graph discovery
- analytics-driven ranking
- premium search features
- deep browse taxonomy

Acceptance criteria:

- users can search for people and communities from the public product
- search supports at least name, alias, profile type, and tags/genres
- results are good enough to make the directory meaningfully usable
- the search model is documented clearly enough for ranking/trust follow-ons

Follow-on direction worth preserving:

- stronger discoverability and graph-style exploration are important later
- future discovery may benefit from relationship/network intelligence such as co-bookings, shared events, community overlap, and repeated collaborations
- Discord-derived analytics or relationship signals may later deepen the discovery model, but should not expand the first search slice

### Add trust-aware search result cards and ranking

Problem:

Search results in VRDex need to communicate trust clearly. Users should be able to tell whether a result is claimed, community-submitted, verified, or suppressed, and ranking should reflect those trust differences.

Scope:

- add search result cards that show trust state clearly
- rank claimed/verified profiles above otherwise similar unclaimed/community-submitted profiles
- ensure trust labels are visible in search results
- align ranking behavior with opt-out/suppression rules

Non-goals:

- advanced recommendation systems
- graph-driven ranking
- premium search logic
- moderation dashboard
- partner-specific ranking boosts

Acceptance criteria:

- search results visibly communicate trust state
- claimed/verified profiles rank above similar unclaimed/community-submitted profiles
- opted-out or suppressed identities are not shown publicly
- ranking behavior is predictable enough to support user trust
- the result-card and ranking rules are documented clearly enough for future search improvements

### Add basic browse/discovery surfaces for people and communities

Problem:

Search is not the only way people discover profiles. VRDex should have a small set of basic browse/discovery surfaces so the directory feels explorable even before advanced graph discovery exists.

Scope:

- add a minimal browse/discovery surface for public profiles
- support simple exploration by profile type and/or tags
- keep discovery lightweight and useful without overbuilding taxonomy
- align discovery behavior with trust labels and opt-out rules

Non-goals:

- graph exploration
- advanced recommendation engine
- algorithmic feed design
- deep editorial curation
- premium discovery features

Acceptance criteria:

- users can browse beyond direct search
- browse surfaces remain simple and understandable
- trust labeling and suppression rules apply consistently
- the browse model is documented clearly enough for future graph/discovery expansion

## EPIC-07 Events and profile associations

### Add core event model and CRUD flows

Problem:

VRDex needs an event-first model so communities can publish events and the rest of the product can build person/community participation views from a stable primary record.

Scope:

- define the base event model
- support creating, reading, updating, and listing events
- support source attribution on events
- support core event fields for the first slice
- keep the event model stable enough for later participant, slot, and media extensions

Non-goals:

- slot templating
- AI extraction
- partner sync
- advanced dispute workflows
- full event operations suite

Acceptance criteria:

- the system has a canonical event record
- communities can create and update events
- event records support at least title, community, start time, optional end time, source, optional link, and optional notes
- event records are documented clearly enough for follow-on participant/media issues
- the event model does not force the whole future event platform into `v0.5`

### Add person-to-event associations and derived upcoming-events views

Problem:

Events alone are not enough for a person-facing experience. VRDex needs a clean way to associate people to events so person profiles can show upcoming events without making “appearance” the core object.

Scope:

- associate person profiles to event records
- support associations for claimed and unclaimed person profiles
- derive person-facing upcoming-events views from those associations
- preserve source attribution on event participation links
- keep the association model compatible with a later slot-based structure
- keep the model simple enough for `v0.5`

Non-goals:

- slot templating
- approval workflows
- dispute workflows
- notifications
- graph analytics

Acceptance criteria:

- a person profile can be associated with an event
- both claimed and unclaimed person profiles can be associated with events
- person profiles can render a derived `Upcoming events` view
- event associations preserve source/provenance information
- the model leaves room for a future slot layer between person and event

### Add event media links, poster image, and optional world linkage basics

Problem:

VRDex events need more than just a title and time. Even in the first slice, events should be able to carry structured media links, a primary poster image, and optional VRChat world context so the product can grow into better operational value later.

Scope:

- support typed event media links for common cases
- support generic/other media links as fallback
- allow multiple links per event
- support a primary event poster/image
- support optional manual VRChat world linkage
- render basic world/media/poster information on event displays
- keep the model ready for later compatibility hints and richer media normalization

Non-goals:

- automatic world inference
- world compatibility intelligence
- stream protocol optimization logic
- slot-level media links
- VRChat instance operations
- multi-image event galleries

Acceptance criteria:

- events can store typed media links for common cases
- events can store generic/other links when needed
- events can store multiple media links
- events can store a primary poster/image asset
- events can optionally link a VRChat world
- world/media/poster info can be shown in the basic event experience
- the model leaves room for richer world/media intelligence later

## EPIC-08 Open docs and platform foundation

### Scaffold Docusaurus docs structure for public and internal documentation

Problem:

VRDex is meant to be built in the open and used by both humans and agents. We need a docs structure from the start so product, engineering, moderation, and agent knowledge do not stay trapped in chat or scattered markdown.

Scope:

- scaffold a Docusaurus docs site in-repo
- create a clear structure for public docs
- create a clear structure for internal docs
- make the docs layout compatible with long-term product and engineering growth
- align the docs structure with the source-of-truth strategy already captured in planning

Non-goals:

- full content migration of every planning file
- auth-gated internal docs implementation
- polished external developer portal
- full API reference generation
- final information architecture for all future docs

Acceptance criteria:

- a Docusaurus docs structure exists in the repo
- public and internal docs have a clear home in that structure
- the structure is documented clearly enough for future content migration
- the scaffold supports the “human + agent source of truth” direction
- the initial docs setup does not block later private/internal deployment choices

### Seed core product and engineering docs into the Docusaurus structure

Problem:

A docs scaffold alone is not enough. VRDex needs the first real source-of-truth content migrated into the docs structure so product decisions, architecture, and engineering guidance are accessible and linkable.

Scope:

- seed core product docs
- seed core engineering/architecture docs
- seed trust/privacy/identity docs
- seed docs that are especially important for both humans and agents
- preserve a clear distinction between public-facing docs and internal docs

Non-goals:

- migrating every planning note immediately
- polished docs IA for every future feature
- full API reference docs
- full self-hosting guide
- final moderation handbook

Acceptance criteria:

- the first core product docs exist inside the Docusaurus structure
- the first core engineering docs exist inside the Docusaurus structure
- key trust/privacy/identity topics have a clear home
- the docs are useful enough to act as the beginning of the real source of truth
- the migration path from planning markdown into docs is clear

### Document public API posture, rate limiting, and open platform rules

Problem:

VRDex is explicitly meant to have a public API and an open, self-hostable posture. Those expectations need to be written down early so implementation does not drift into a closed or ambiguous model.

Scope:

- document public API expectations
- document first-party vs public rate-limiting posture
- document partner-aware limit concepts
- document open-source/self-hostable API philosophy
- define the baseline boundaries between internal server use and public consumer access

Non-goals:

- implementing the public API itself
- final auth strategy for every API consumer type
- final partner contracts
- full MCP implementation

Acceptance criteria:

- public API posture is documented clearly
- rate-limiting intent is documented clearly
- self-hostable/open platform expectations are documented clearly
- the distinction between internal use and public consumer access is clear enough to guide implementation
- the docs are specific enough to prevent accidental closed-system drift

### Document self-hosting and infrastructure-as-code direction

Problem:

VRDex is meant to be self-hostable and built in the open. We need an early written direction for infrastructure, deployment, and reproducibility so implementation does not become hosted-only by accident.

Scope:

- document self-hosting expectations
- document likely infrastructure components
- document IaC direction and accepted tooling choices
- define the early relationship between Vercel-hosted product deployment and self-hosted deployment goals
- make reproducibility expectations explicit

Non-goals:

- full production Terraform/CDK implementation
- full deployment automation
- one-click self-hosting
- final cloud-agnostic abstraction for everything

Acceptance criteria:

- self-hosting expectations are documented clearly
- IaC direction is documented clearly
- hosted vs self-hosted expectations are understandable
- the docs are specific enough to guide future infrastructure work
- implementation is less likely to drift into a non-reproducible hosted-only shape

### Document agent-first engineering workflows and software-factory conventions

Problem:

VRDex is not just a product; it is also intended to be built with a disciplined agent-first workflow. Those conventions need to be written down early so the repo can support long-running autonomous iteration without chaos.

Scope:

- document agent-first development expectations
- document how repo docs, `AGENTS.md`, issues, and source-of-truth material relate to each other
- document the intended use of Basic's agentic dogfooding concepts where relevant
- document software-factory expectations like review/recycle loops, visual verification, and disciplined issue sizing
- document when to prefer docs, skills, tools, plugins/hooks, or MCPs

Non-goals:

- implementing every automation immediately
- full plugin/hook rollout
- final AI operating handbook for every possible scenario
- replacing product docs with agent-only docs

Acceptance criteria:

- the repo has a clear engineering/workflow doc for agent-first development
- the relationship between docs, issues, AGENTS, and future skills/tools is explained clearly
- software-factory expectations are documented well enough to guide implementation behavior
- the guidance is practical enough to prevent process drift and tracking chaos

### Add Google Calendar sync/export direction for event workflows

Problem:

VRDex could become much more operationally useful if users can keep event data synced into their calendar workflow instead of treating the site as an isolated destination.

Scope:

- document a follow-on direction for both Google Calendar export and real Google Calendar sync
- support merged calendars and optionally split calendars by person/community later
- support synced updates when tracked events are added, changed, or removed
- leave room for a simpler service-account-managed shared-calendar approach in addition to direct per-user sync
- define the basic workflow value without forcing implementation into the first slice

Non-goals:

- implementing calendar sync now
- full multi-provider calendar support
- solving every event subscription/export edge case in v0.5

Current recommendation:

- support both export and real sync later
- real sync is more valuable than export alone
- a service-account-authored shared calendar may be a practical early path that is simpler than full per-user writeback

Acceptance criteria:

- the calendar integration idea is captured as an intentional follow-on workflow feature
- merged vs split calendar modes are called out as product choices to revisit later
- export and real-sync modes are both explicitly preserved
- the possibility of a service-account shared-calendar approach is documented
- the integration value is documented clearly enough to become a future issue/epic without relying on chat history

## EPIC-03 Public profile experience

### Build public person profile page

Problem:

VRDex needs a polished public person page that feels good enough to share as a canonical identity page, not just a data record.

Scope:

- build the public person profile route
- render core identity/presentation fields
- support mobile and desktop layouts
- display trust/claim state clearly
- support the current calm/minimal design direction

Non-goals:

- advanced analytics
- avatar viewer / 3D showcase
- raw HTML/CSS customization
- premium feature gating

Acceptance criteria:

- person profiles render as a polished public page
- the page works well on mobile and desktop
- trust/claim state is visible and understandable
- profile content is legible and shareable as a public identity page

### Build public community profile page

Problem:

Communities need a canonical public page that can serve as the public home for a community subtype such as a club, collective, venue, or other scene community.

Scope:

- build the public community profile route
- render community-specific presentation and identity fields
- support mobile and desktop layouts
- support public links, event-oriented context, and trust labeling
- preserve the calm/minimal design direction

Non-goals:

- full community operations dashboard
- advanced roster/role UI
- partner integration UI
- premium analytics

Acceptance criteria:

- community profiles render as polished public pages
- community pages work well on mobile and desktop
- community identity and trust state are clear
- the page is good enough to use as a canonical public home for a community

### Add profile presentation assets and owner-authored content sections

Problem:

Profiles need core visual identity and authored content to feel like real public pages instead of bare database entries.

Scope:

- support avatar/display image
- support banner image
- support short bio
- support longer about section
- render those elements consistently across person and community pages

Non-goals:

- gallery/media blocks
- advanced press kit downloads
- 3D avatar showcase
- arbitrary rich content embedding

Acceptance criteria:

- owners can present avatar and banner assets on public pages
- owners can author a short bio and longer about section
- these sections render cleanly on both person and community profiles
- the authored content model is clearly documented for follow-on issues

### Add bounded customization system and visual verification baseline

Problem:

VRDex needs expressive profile customization without turning into a fragile page builder, and UI work needs a reliable verification loop.

Scope:

- support theme presets
- support basic section ordering
- define public profile layout tokens or style system foundations
- add visual verification coverage for key public page states
- keep customization within bounded, safe constraints

Non-goals:

- arbitrary CSS
- arbitrary HTML
- full page-builder experience
- premium-only customization layers

Acceptance criteria:

- owners can change profile presentation through bounded presets/options
- customization still preserves readability and consistency
- key public page states have visual verification coverage
- the layout/token approach is documented well enough for future UI expansion

### Add premium animated profile effects and richer presentation customization

Problem:

VRDex can gain real premium appeal if profiles have tasteful, high-quality visual polish beyond static themes, while still preserving the calm/trustworthy baseline UX.

Scope:

- add premium animated profile effects
- add richer palette controls
- add link style variants
- add section style variants or decorative treatments
- define guardrails so premium customization does not damage readability or performance

Non-goals:

- arbitrary CSS
- arbitrary HTML
- chaotic MySpace-style profile freedom
- core profile identity features already covered by earlier issues

Acceptance criteria:

- premium visual customization options are defined as a follow-on system
- animated effects are framed as tasteful, bounded, and optional
- readability, performance, and mobile behavior are protected by design constraints
- the premium customization direction is documented clearly enough for later implementation

## EPIC-18 Software factory and agentic delivery

### Recommended first-wave issue order

Start with this slice so the repo gets better defaults quickly without overbuilding the whole engine first:

1. Separate repo-wide agent policy from local operator preference
2. Add repo onboarding skill and docs-backed onboarding flow
3. Define repo-level definition of ready for feature work
4. Choose and document product analytics plus feature-flagging direction
5. Define contributor-friendly, agent-compatible contribution workflow
6. Define agentic review-recycle loop and trigger model
7. Define orchestrator/supervisor loop and resumable-session policy

Why this order:

- the first three issues improve day-to-day execution immediately
- analytics/feature-flag direction should exist before feature implementation speeds up
- contributor workflow should land early because outside contribution is already a live concern
- review/recycle and orchestration design can then build on cleaner repo defaults

### Separate repo-wide agent policy from local operator preference

Problem:

VRDex is intentionally opinionated, but not every operator preference should become repo policy. The repo needs a clear split between global agent defaults and local personal context.

Scope:

- define what belongs in `AGENTS.md`
- define what belongs in `AGENTS.local.md`
- add a gitignored local-context path and example template
- document when a preference should be promoted from local to repo-wide

Non-goals:

- full onboarding playbook
- model-routing implementation
- plugin/tool implementation by itself

Acceptance criteria:

- repo-wide vs local operator context is clearly separated
- `AGENTS.local.md` is ignored by git and has a template/example
- the repo documents how to decide whether a rule is global or local

### Add repo onboarding skill and docs-backed onboarding flow

Problem:

New agents should align quickly with VRDex conventions, but onboarding-heavy instructions should not bloat every normal session prompt.

Scope:

- define the onboarding flow for new agents and maintainers
- add a repo onboarding skill
- point the skill at canonical docs instead of duplicating everything inline
- cover setup, supported agent roles, model preferences, documentation habits, and workflow expectations

Non-goals:

- final universal toolbox onboarding across every repo
- implementing every skill/tool/plugin immediately

Acceptance criteria:

- a new agent can follow one canonical onboarding path
- the onboarding flow is skill-backed and docs-backed
- onboarding-heavy guidance stays out of normal-session repo rules unless it must be durable there

### Reorganize repo docs into a Docusaurus-ready `docs/` structure

Problem:

Planning and workflow markdown is becoming too easy to lose in the repo root. VRDex needs a real docs structure early so artifacts stay discoverable and cross-linkable.

Scope:

- move durable markdown under `docs/`
- establish at least planning and agentic sections
- update indexes and references
- keep the structure compatible with future Docusaurus adoption

Non-goals:

- full Docusaurus app implementation
- perfect final information architecture on the first pass

Acceptance criteria:

- most durable markdown no longer lives at repo root
- docs have a clear sectioned structure
- the repo has an obvious starting point for both human and agent onboarding

### Define agentic review-recycle loop and trigger model

Problem:

VRDex wants automated multi-model review and recycle behavior, but the repo needs a concrete loop definition before implementation can be trusted.

Scope:

- define implementer, reviewer, and recycler roles
- define when recycler work should trigger
- define how reviewer feedback is triaged and recorded
- define the minimum gate before the next recycle push
- include GPT, Codex, GitHub Copilot, and Claude as candidate reviewer sources

Non-goals:

- implementing all reviewers immediately
- locking the repo to one review vendor
- full GitHub Actions implementation in one pass

Acceptance criteria:

- the role split is documented clearly
- trigger conditions are documented clearly
- the recycle gate is documented clearly
- the loop is concrete enough to become automation work instead of remaining just an idea

### Define orchestrator/supervisor loop and resumable-session policy

Problem:

Implementer agents naturally stop at turn boundaries. VRDex needs an explicit higher-level control loop that decides whether to continue work, ask the human one question, dispatch another agent, or mark a task done.

Scope:

- define orchestrator/supervisor responsibilities
- define what delta package should be passed upward from implementer sessions
- define resume-vs-new-session policy for recycler and follow-on work
- define how human attention is conserved

Non-goals:

- building the full orchestration runtime immediately
- final hard-coded arbitration DSL

Acceptance criteria:

- orchestrator responsibilities are documented clearly
- resumable-session policy is documented clearly
- the human attention policy is documented clearly
- the loop is specific enough to guide implementation experiments

### Define OpenCode task-pool/server direction for dispatched agent work

Problem:

VRDex wants to move toward pooled, dispatchable, resumable agent work instead of relying only on ad hoc interactive sessions.

Scope:

- define the desired OpenCode server/task-pool model
- define atomic jobs vs long-lived sessions as first-class concepts
- define agent roster/discoverability needs
- define how agents may request new work through an orchestrator path

Non-goals:

- shipping the hosted server immediately
- solving every cross-host scheduling concern in one pass

Acceptance criteria:

- the task-pool/server direction is documented clearly
- atomic jobs vs resumable sessions are differentiated clearly
- the idea is concrete enough to map into later implementation issues without relying on chat history

### Define layered verification loops and human validation package expectations

Problem:

VRDex wants code to move quickly without losing trust. The repo needs a clear model for how automated and human verification stack together across app code, scripts, UI work, and infrastructure.

Scope:

- define baseline verification layers across lint, types, tests, e2e, visual, and policy checks
- include scripts/ancillary code and infrastructure verification expectations
- define when VLM review and screenshot/video evidence are expected
- define the desired human validation handoff for a nearly mergeable feature

Non-goals:

- implementing every verification layer immediately
- forcing every feature to have the same heavyweight validation cost

Acceptance criteria:

- the verification stack is documented clearly
- UI evidence expectations are documented clearly
- human validation is framed as a final confidence layer, not a substitute for engineering checks

### Detect mergeability regressions and auto-dispatch recovery work

Problem:

PRs can become unmergeable after unrelated changes land. VRDex wants the same recycler logic to recover mergeability issues automatically when practical.

Scope:

- define mergeability-regression detection as an event source
- define how the original implementer session should be resumed when practical
- define the expected recovery loop for merge conflicts or stale-branch issues

Non-goals:

- implementing perfect conflict resolution immediately
- guaranteeing zero human review for risky merges

Acceptance criteria:

- mergeability regression is captured as a first-class trigger
- resume-the-original-implementer is the default recovery policy when practical
- the behavior is documented clearly enough to become future automation work

### Define repo-level definition of ready for feature work

Problem:

VRDex wants features to ship quickly, but not without thinking through rollout, verification, and success criteria first. The repo needs a concrete definition of ready so contributors and agents know what must be thought through before implementation starts.

Why now:

- feature work is about to accelerate
- outside contribution is already a live concern
- analytics, feature flags, review/recycle, and contributor expectations all depend on a shared readiness bar

Scope:

- define the repo's definition of ready for non-trivial features
- include verification, rollout, and success-signal expectations
- document when feature flags or analytics planning are required
- make the checklist usable by both humans and agents
- define a lightweight path for trivial fixes so the process does not become drag
- define where the checklist should live and how it should be referenced from issue workflows

Non-goals:

- final project-management process for every issue type
- forcing trivial fixes through heavyweight ceremony
- replacing implementation issue acceptance criteria

Current recommendation:

- use a short checklist that fits naturally into issue drafting and planning docs
- require the full checklist for non-trivial feature work, not for tiny typo or copy-only fixes
- explicitly cover verification plan, rollout/flag plan, and success-signal plan
- make the checklist part of contributor onboarding and agent workflow guidance

Acceptance criteria:

- the definition of ready is documented clearly
- contributors and agents can use the checklist before starting non-trivial work
- rollout and analytics thinking are explicitly part of feature readiness where appropriate
- the distinction between trivial work and non-trivial feature work is documented clearly
- the checklist is concise enough to be used consistently instead of ignored

Suggested checklist:

- problem statement is clear
- scope and non-goals are clear
- dependency position is clear
- verification plan is clear
- rollout or feature-flag plan is clear when appropriate
- analytics or success-signal plan is clear when appropriate
- reviewer/recycler expectations are clear when appropriate

Likely dependencies:

- soft dependency on `Add repo onboarding skill and docs-backed onboarding flow`
- soft dependency on `Choose and document product analytics plus feature-flagging direction`

Docs to update:

- `docs/planning/engineering-strategy.md`
- `docs/agentic/software-factory.md`
- future contributor/onboarding docs under `docs/agentic/`

Suggested labels:

- `phase:v0.5`
- `area:agentic`
- `area:docs`

### Choose and document product analytics plus feature-flagging direction

Problem:

VRDex wants to avoid shipping blind and wants to support controlled rollout and experimentation. The repo needs an intentional direction for analytics and feature flags before feature development accelerates.

Scope:

- evaluate integrated analytics/flagging candidates such as `PostHog`
- evaluate dedicated feature-flag alternatives such as `LaunchDarkly`
- define what good enough looks like for v0.5
- define how analytics and flags fit into agent-first feature delivery

Non-goals:

- implementing the full analytics stack immediately
- solving every experimentation problem on day one

Acceptance criteria:

- the repo has a documented first-pass analytics/flagging direction
- the tradeoffs between integrated and dedicated approaches are captured clearly
- the direction is concrete enough to guide future implementation issues

### Define contributor-friendly, agent-compatible contribution workflow

Problem:

VRDex wants to be rigorous without becoming tool-prescriptive. Contributors, especially newer programmers, need a workflow that is welcoming, quality-oriented, and compatible with different agent/tool choices.

Scope:

- define contribution expectations at a repo level
- define what contributors must satisfy regardless of which agent/tool they use
- define where reviewer/recycler automation helps maintain quality
- define when branch protection, contributor roles, and org-level controls should be introduced

Non-goals:

- forcing all contributors onto one specific agent stack
- building the full org governance model immediately

Acceptance criteria:

- the repo documents a rigorous but non-prescriptive contributor workflow
- compatibility with multiple agent/tool choices is explicit
- review/recycle automation is framed as quality support rather than tool lock-in
