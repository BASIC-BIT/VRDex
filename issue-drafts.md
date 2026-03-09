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
