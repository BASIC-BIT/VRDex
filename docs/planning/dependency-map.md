# Backlog Dependency Map

## Status note

This file records the current hard and soft dependency assumptions across the draft issue backlog.

- `Hard dependency` means issue A should be complete before issue B can be considered complete
- `Soft dependency` means issue A should usually happen first because it improves sequencing, clarity, or implementation efficiency
- these links should be kept in sync with GitHub issue descriptions as the backlog evolves

## Epics

### #1 Profile foundation

- hard dependents: #9, #10, #11, #12

### #2 Claim and ownership

- soft dependencies: #1
- hard dependents: #13, #14, #15, #16, #17, #18

### #3 Community submissions and trust labeling

- soft dependencies: #1
- hard dependents: #23, #25, #26

### #4 Public profile experience

- soft dependencies: #1, #2
- hard dependents: #19, #20, #21, #22

### #5 Privacy and opt-out controls

- soft dependencies: #1, #2, #3
- hard dependents: #27, #28, #29, #30

### #6 Search and discovery basics

- soft dependencies: #1, #3, #5
- hard dependents: #31, #32, #33

### #7 Events and profile associations

- soft dependencies: #1, #4, #5
- hard dependents: #34, #35, #36

### #8 Open docs and platform foundation

- hard dependents: #37, #38, #39, #40, #42

## Core issues

### #9 Create base profile schema for people and communities

- hard dependents: #10, #11, #12, #13, #19, #21, #23, #27, #31, #34, #35

### #10 Add slug generation and uniqueness rules

- hard dependencies: #9
- soft dependents: #19, #21, #31

### #11 Add profile type-aware core fields

- hard dependencies: #9
- hard dependents: #12, #19, #21, #22, #23, #27, #31, #34

### #12 Add profile read/write permissions baseline

- hard dependencies: #9, #11
- soft dependencies: #13
- hard dependents: #23, #27, #28

### #13 Implement unclaimed vs claimed profile states

- hard dependencies: #9
- hard dependents: #14, #15, #16, #17, #19, #21, #25, #28, #31, #35

### #14 Implement Discord-based claim flow for community profiles

- hard dependencies: #13, #17, #18
- soft dependencies: #10, #11, #12

### #15 Implement Discord claim flow for person profiles

- hard dependencies: #13, #17, #18
- soft dependencies: #10, #11, #12

### #16 Add VRChat proof-code verification path

- hard dependencies: #13, #17, #18

### #17 Add authority transition from unclaimed to claimed profile

- hard dependencies: #9, #13
- hard dependents: #14, #15, #16
- soft dependencies: #12

### #18 Implement multi-provider account login for v0.5 (Discord, Google, email/password)

- hard dependents: #14, #15, #16

### #19 Build public person profile page

- hard dependencies: #9, #10, #11, #13
- soft dependencies: #22, #25, #27, #35
- hard dependents: #20

### #20 Add bounded customization system and visual verification baseline

- hard dependencies: #19, #21, #22
- soft dependents: #24

### #21 Build public community profile page

- hard dependencies: #9, #10, #11, #13
- soft dependencies: #22, #25, #27, #34, #35, #36
- hard dependents: #20

### #22 Add profile presentation assets and owner-authored content sections

- hard dependencies: #9, #11
- soft dependencies: #19, #21
- hard dependents: #20
- soft dependents: #24, #36

### #23 Build community profile submission flow

- hard dependencies: #9, #10, #11, #12, #13
- soft dependencies: #25, #26, #29
- hard dependents: #25, #26

### #24 Add premium animated profile effects and richer presentation customization

- soft dependencies: #19, #20, #21, #22

### #25 Add community-submitted / unverified trust labels across cards and pages

- hard dependencies: #13, #19, #21, #23
- soft dependents: #32

### #26 Add source attribution display and basic moderation rollback trail

- hard dependencies: #9, #23
- soft dependencies: #25
- soft dependents: #29

### #27 Add field-level visibility model and owner privacy controls

- hard dependencies: #9, #11, #12, #13
- soft dependencies: #19, #21, #22
- hard dependents: #28

### #28 Add claimed-owner listing opt-out flow

- hard dependencies: #12, #13
- soft dependencies: #27
- hard dependents: #30

### #29 Add pre-claim suppression moderation workflow

- hard dependencies: #23
- soft dependencies: #26
- hard dependents: #30

### #30 Enforce public surfacing suppression across search, rosters, and event associations

- hard dependencies: #28, #29
- soft dependencies: #31, #33, #35

### #31 Implement public search across people and communities

- hard dependencies: #9, #10, #11, #13
- soft dependencies: #23, #25, #30
- hard dependents: #32, #33

### #32 Add trust-aware search result cards and ranking

- hard dependencies: #25, #31
- soft dependencies: #30

### #33 Add basic browse/discovery surfaces for people and communities

- hard dependencies: #31
- soft dependencies: #25, #30, #32

### #34 Add core event model and CRUD flows

- hard dependencies: #9, #11
- soft dependencies: #21
- hard dependents: #35, #36

### #35 Add person-to-event associations and derived upcoming-events views

- hard dependencies: #9, #13, #34
- soft dependencies: #19, #21, #30, #36, #41

### #36 Add event media links, poster image, and optional world linkage basics

- hard dependencies: #34
- soft dependencies: #21, #22, #35, #41

### #37 Scaffold Docusaurus docs structure for public and internal documentation

- hard dependents: #38, #39, #40, #42

### #38 Seed core product and engineering docs into the Docusaurus structure

- hard dependencies: #37
- soft dependencies: #39, #40, #42

### #39 Document public API posture, rate limiting, and open platform rules

- hard dependencies: #37
- soft dependencies: #42, #41

### #40 Document agent-first engineering workflows and software-factory conventions

- hard dependencies: #37
- soft dependencies: #38

### #41 Add Google Calendar sync/export direction for event workflows

- soft dependencies: #34, #35, #36, #39, #42

### #42 Document self-hosting and infrastructure-as-code direction

- hard dependencies: #37
- soft dependencies: #39
