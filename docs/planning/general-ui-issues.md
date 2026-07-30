# General UI issues

This is the working ledger for small, coherent account and interface polish that should ship as one focused PR rather than one PR per nitpick.

## Batch rules

- Keep changes narrow, independently testable, and grounded in shared design-system primitives.
- Coordinate overlapping files with the active profile-claim and unified-search lanes.
- Do not open the batch PR until BASIC says the feedback batch is ready.

## Issue ledger

| Area | Confirmed issue | State | Notes |
| --- | --- | --- | --- |
| Account | Sign out needs danger styling and explicit confirmation. | Implemented and verified locally | Account-specific native dialog, shared danger button variants, cancel/Escape/failure/loading coverage. |
| Profiles and search | Use the compact DJ-style verified mark consistently. | Implemented and verified locally | Shared verified-mark primitive across lookup, unified search, public profiles, and Account-owned profiles. |
| Account | Add a prominent action to view an owned public profile. | Implemented and verified locally | Primary `View profile` action appears only when the owned profile is publicly readable. |
| Search and profiles | Remove public provenance, review-state, and private-seed wording. | Implemented and verified locally | Presentation removed while backend provenance, access controls, ranking, and operator data remain intact. |
| Profiles and search | Apply saved avatar borders, colors, softness, and shape consistently. | Implemented and verified locally | Shared profile-avatar primitive now carries personalization through discovery, DJ lookup, events, and Claim. |
| Search | Replace text entity types with compact icons and icon-scoped tooltips. | Implemented and verified locally | Existing Lucide icons identify people, communities, worlds, and events; the tooltip activates only from the icon. |
| DJ links | Promote multiline entry into bulk lookup. | Implemented and verified locally | `Shift+Enter` inserts a newline and enters bulk mode; multiline paste follows the same path while preserving focus and selection. |
| Test fixtures | Use valid public VRCDN playback URLs. | Implemented and verified locally | DJ Aurora and event fixtures use the same public MPEG-TS shape as BASICBIT, with derived preview and PC links covered. |

## Coordination

- The profile-claim and unified-search work landed on `main` and was merged into this lane at `8c20e5a31`.
- Current `main` through `8016c3c13` was reconciled on 2026-07-30. Resolutions retain the newer authentication lifecycle, replay masking, Claim methods, and Media Kit metadata while applying this batch's presentation changes.
- Open PRs #222 and #223 do not duplicate this UI batch. PR #223 also touches Claim, so any later merge should preserve `ProfileAvatarImage` when resolving that file. Draft PR #213 changes deployment-health workflows only.
