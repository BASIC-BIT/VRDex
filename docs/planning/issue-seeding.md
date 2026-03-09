# Issue Seeding

## Goal

Turn the current VRDex planning docs into a GitHub-native build queue.

## Recommended structure

For each epic:

- create one parent epic issue
- create child implementation issues
- link child issues back to the epic
- keep acceptance criteria in the epic issue body

Issue sizing rule:

- prefer larger, independently testable vertical slices over many tiny bookkeeping issues
- avoid excessive nesting and tracking overhead
- an issue can be fairly long if it still represents one coherent, shippable chunk of work
- only split further when a slice becomes hard to reason about, hard to review, or blocked by clear dependencies

## Suggested milestone structure

- `v0.5`
- `v1`
- `v1.5`

## Suggested issue template shape

### Title

- concise and implementation-facing
- example: `Add claim state and owner authority model`

### Body sections

- problem
- scope
- non-goals
- acceptance criteria
- dependencies
- docs to update

## Deferred-but-important issue policy

If something is explicitly out of scope for the current slice but clearly valuable, prefer filing it as a follow-on issue rather than letting it disappear into a non-goals list.

Good examples for VRDex:

- custom domains
- slug history redirects
- SEO optimization for public profiles
- LLM-assisted moderation and scanning

## Suggested first v0.5 issue list

### EPIC-01 Profile foundation

- create base profile schema for people and communities
- add stable slug generation and uniqueness rules
- add profile type-aware core fields
- add profile read/write permissions baseline

### EPIC-02 Claim and ownership

- implement unclaimed vs claimed profile states
- add Discord claim flow for person profiles
- add VRChat proof-code verification skeleton
- add authority handoff from unclaimed to claimed profile

### EPIC-03 Public profile experience

- build person public profile page
- build community public profile page
- add avatar/banner asset support
- add short bio and about section UI
- add theme preset and section ordering basics

### EPIC-04 Community submissions and trust labeling

- build community profile submission flow
- enforce schema-limited community field set
- add community-submitted/unverified badges
- add source attribution display

### EPIC-05 Privacy and opt-out controls

- add field-level visibility model
- add profile visibility UI
- add claimed-owner opt-out flow
- add moderation path for pre-claim suppression

### EPIC-06 Search and discovery basics

- implement search across people and communities
- add trust-aware ranking and cards
- exclude opt-out entities from public discovery

### EPIC-07 Events and profile associations

- add event schema and CRUD flows
- add community event sections and person event views
- support unclaimed person profiles in event associations
- add typed media links with generic fallback
- add optional world linkage field

### EPIC-08 Open docs and platform foundation

- scaffold Docusaurus docs structure
- publish product/docs seed pages
- write API posture doc
- write self-hosting and infra posture doc

### EPIC-18 Software factory and agentic delivery

- separate global repo agent policy from local operator preference
- add repo onboarding skill and docs-backed onboarding flow
- define review-recycle workflow and trigger model
- define orchestrator/supervisor loop and resume semantics
- define verification stack and human validation package expectations
- define OpenCode task-pool/server direction
- define repo-level definition of ready
- choose product analytics and feature-flagging direction
- define contributor-friendly, agent-compatible contribution workflow

## Practical recommendation

Seed issues in this order:

1. schema and authority model
2. public profile pages
3. claim flow
4. community submission + trust labels
5. privacy + opt-out
6. event core and profile associations
7. search/discovery
8. docs foundation
9. software-factory/meta-loop foundations in parallel where they unblock faster coding

That order keeps the product coherent while still giving you something demoable quickly.

## Suggested follow-on issue bucket

- add custom domain support for profiles
- add slug history and redirect behavior
- improve public profile SEO and metadata strategy
- add LLM-assisted moderation and abuse scanning layer
