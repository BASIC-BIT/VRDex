# Issue Seeding

## Goal

Turn the current VRDex planning docs into a GitHub-native build queue.

## Recommended structure

For each epic:

- create one parent epic issue
- create child implementation issues
- link child issues back to the epic
- keep acceptance criteria in the epic issue body

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

## Suggested first v0.5 issue list

### EPIC-01 Profile foundation

- create base profile schema for people and clubs
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
- build club public profile page
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

- implement search across people and clubs
- add trust-aware ranking and cards
- exclude opt-out entities from public discovery

### EPIC-07 Appearances core

- add appearance schema and CRUD flows
- add person and club appearance sections
- support unclaimed person profiles in appearances
- add typed media links with generic fallback
- add optional world linkage field

### EPIC-08 Open docs and platform foundation

- scaffold Docusaurus docs structure
- publish product/docs seed pages
- write API posture doc
- write self-hosting and infra posture doc

## Practical recommendation

Seed issues in this order:

1. schema and authority model
2. public profile pages
3. claim flow
4. community submission + trust labels
5. privacy + opt-out
6. appearance core
7. search/discovery
8. docs foundation

That order keeps the product coherent while still giving you something demoable quickly.
