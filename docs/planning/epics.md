# VRDex Epics

## Status note

This is a planning document for turning the current PRD into executable work.

- epic names and scope are current recommendations
- acceptance criteria are intentionally product-facing, not implementation-task-level
- the next step after this doc is to split each epic into GitHub issues

## Phase framing

### v0.5

Goal: a demoable, polished proof of product value.

### v1

Goal: a real public release with stronger ownership, club operations basics, and platform foundations.

### v1.5

Goal: immediate follow-on improvements that make the system smarter, more integrated, and more operationally useful.

## v0.5 epics

### EPIC-01 Profile foundation

Purpose:

- establish first-class person and community profiles as independent records

Includes:

- person profiles
- community profiles
- slugs and profile identity
- basic field model
- owner-editable core fields

Current recommendation:

- profile slugs should be owner-settable, unique, and validated
- canonical URLs should not depend on raw VRChat display names

Acceptance criteria:

- a person profile can exist without a linked user
- a community profile can exist without a linked user
- profiles have stable URLs and core identity fields
- the system clearly distinguishes person vs community profiles
- owners can choose a valid custom slug when available

### EPIC-02 Claim and ownership

Purpose:

- let real people and communities take authority over existing profile records

Includes:

- Discord-based claim flow
- VRChat proof-code verification path
- basic claim state handling
- owner authority over profile fields

Current recommendation:

- Discord should be treated as the strongest early claim path, not the only login or identity source
- later work should leave room for additional account providers and trust signals

Locked v0.5 target:

- initial account access should support Discord, Google, and email/password

Acceptance criteria:

- an unclaimed profile can be claimed without creating a duplicate profile
- claim state is visible in the product
- claimed owners can control their profile fields and visibility

### EPIC-03 Public profile experience

Purpose:

- make the product feel real through polished public pages

Includes:

- calm, minimal public profile pages
- avatar/banner support
- short bio plus longer about section
- theme presets and section ordering basics

Acceptance criteria:

- person and community pages are mobile-friendly and visually polished
- claimed owners can customize their page within bounded rules
- the pages are good enough to share publicly as a canonical identity page

### EPIC-04 Community submissions and trust labeling

Purpose:

- let the directory grow before full adoption, without pretending community data is owner-endorsed

Includes:

- community-submitted unclaimed profiles
- narrow safe field set for community submissions
- trust labels and search labeling
- source attribution

Acceptance criteria:

- community-submitted profiles can exist and be searched
- they are clearly labeled as unverified/community-submitted
- public submitters cannot fill sensitive/private or too-authoritative fields

### EPIC-05 Privacy and opt-out controls

Purpose:

- give owners control over public exposure and allow unwanted public listing suppression

Includes:

- per-field visibility
- public/unlisted/private states
- claimed-owner opt-out
- pre-claim suppression moderation path

Acceptance criteria:

- claimed owners can hide individual fields
- valid opt-out prevents public surfacing across profiles, rosters, and event participant references
- pre-claim suppression can be tracked through moderation state even if MVP handling is simple

### EPIC-06 Search and discovery basics

Purpose:

- make profiles discoverable without overcomplicating ranking or graph logic

Includes:

- search by name, alias, profile type, tags
- trust-aware result presentation
- basic discovery surfaces

Acceptance criteria:

- users can find people and communities through search
- claimed/verified profiles rank above otherwise similar unclaimed entries
- valid opt-out entities do not appear publicly

### EPIC-07 Events and profile associations

Purpose:

- let communities host structured events and let people derive event participation views from those event records

Includes:

- basic event records
- person-to-event associations
- source attribution
- optional manual world selection
- typed media links plus generic links

Acceptance criteria:

- a community can create an event involving a claimed or unclaimed person profile
- a person profile can derive an upcoming-events view from event associations
- event records support at least title, community, time, source, link, and notes
- world linkage is optional, not required

### EPIC-08 Open docs and platform foundation

Purpose:

- establish the project's in-the-open posture from the start

Includes:

- Docusaurus docs structure
- public product docs seed
- internal docs seed
- public API posture planning
- self-hostable/system architecture notes

Acceptance criteria:

- docs structure exists in-repo
- core product decisions are documented in a human-readable way
- open-source and self-hostable posture is explicit

## v1 epics

### EPIC-09 Community management basics

Purpose:

- let communities actually operate in the system, not just exist as static pages

Includes:

- one owner model
- default non-owner roles
- delegated permissions for core actions
- ownership transfer with acceptance
- unclaimed roster entries

Acceptance criteria:

- a community owner can delegate profile/event/admin work
- ownership transfer is explicit and auditable
- communities can manage roster entries without requiring every person to sign up first

### EPIC-10 Concierge and onboarding wizard

Purpose:

- support higher-touch growth and a smoother first-run experience

Includes:

- concierge draft creation
- handoff invites
- guided onboarding wizard
- prefilled field confirmation

Acceptance criteria:

- a curator can create a richer draft for someone else
- the recipient can accept, edit, and publish through a guided flow
- concierge drafts stay private until accepted or explicitly published

### EPIC-11 Billing foundation

Purpose:

- add monetization infrastructure without prematurely overbuilding entitlements

Includes:

- Stripe customer creation
- subscription lifecycle
- billing portal access
- internal entitlement model
- webhook auditability

Acceptance criteria:

- the product can map subscriptions to internal entitlements
- billing state does not depend on reading Stripe directly at runtime everywhere
- webhook handling is idempotent and auditable

### EPIC-12 Public API foundation

Purpose:

- make VRDex useful beyond the web app

Includes:

- documented public read API
- first-party vs public rate-limiting strategy
- basic partner-aware limit posture
- profile and event endpoints

Acceptance criteria:

- external consumers can read profile and event data from a documented API
- rate limiting is explicit
- the product is still operable as a self-hosted/open platform

### EPIC-13 Notifications and consent basics

Purpose:

- let claimed users know when they are represented in the system

Includes:

- passive in-app notifications for event association additions
- basic notification settings
- claim-related awareness hooks

Acceptance criteria:

- a claimed person can be notified when added to an event association
- notification behavior is configurable at a basic level

## v1.5 epics

### EPIC-14 Partner integrations

Purpose:

- reduce manual entry and strengthen the moat through partnerships

Includes:

- Decked Out integration paths
- VRC Pop integration paths
- VRCLinking attestation paths
- event feed import/export

Acceptance criteria:

- at least one real partner integration path exists or is implementation-ready
- external systems can point to or enrich VRDex records cleanly

### EPIC-15 Event intelligence and slot modeling

Purpose:

- make events and participant modeling much more useful for actual VR event operations

Includes:

- DJ slot structure
- templated slot generation
- richer event-level records
- world-aware hints
- stream/media normalization

Acceptance criteria:

- multi-DJ events can be represented more accurately
- stream and world metadata can power better event presentation
- the data model supports common VR club operational patterns

### EPIC-16 AI-assisted extraction and matching

Purpose:

- use LLMs where they create leverage without becoming the authority layer

Includes:

- event description parsing
- set-time extraction
- entity matching suggestions
- moderation/confirmation workflow

Acceptance criteria:

- AI can propose useful matches and extracted structure
- uncertain AI output is never silently treated as verified fact

### EPIC-17 Insights and premium polish

Purpose:

- make paid tiers feel genuinely valuable without blocking core usage

Includes:

- richer event and participation insights
- premium profile presentation polish
- community-side intelligence improvements
- premium analytics direction

Acceptance criteria:

- the product has a clearer premium value story
- free usage still covers normal collaboration basics

### EPIC-18 Software factory and agentic delivery

Purpose:

- build the repo, tooling, and control loops that let VRDex move toward highly automated, agent-first software delivery

Includes:

- global vs local agent context conventions
- onboarding skill and repo setup flow
- review-recycle loop design
- orchestrator/supervisor loop design
- OpenCode task-pool/server direction
- layered verification and human validation package design
- mergeability and auto-recovery trigger design
- definition-of-ready and contributor workflow design
- product analytics and feature-flagging direction for controlled rollout

Acceptance criteria:

- repo-wide vs local operator context is clearly separated
- onboarding for new agents is documented and skill-backed
- software-factory loops are documented as concrete repo work, not just vision
- a first issue set exists for implementing the meta loop incrementally

## Suggested issue split strategy

For GitHub, each epic should be split into:

- one epic issue
- 4-10 scoped child issues
- a short acceptance checklist
- labels for phase, area, and risk

Suggested labels:

- `phase:v0.5`
- `phase:v1`
- `phase:v1.5`
- `area:profiles`
- `area:claims`
- `area:communities`
- `area:events`
- `area:api`
- `area:billing`
- `area:docs`
- `area:ux`
- `area:agentic`

## Recommended next step

Turn the `v0.5` epics into concrete GitHub issues first, while allowing the software-factory epic to start in parallel where it reduces future drag.

That will give you the first real build queue without prematurely exploding the later roadmap.
