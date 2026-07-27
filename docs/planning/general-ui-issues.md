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

## Coordination

- The profile-claim and unified-search work landed on `main` and was merged into this lane at `8c20e5a31`.
- The only merge conflict was the Account toolbar; the resolved version retains claim/media controls and the confirmed sign-out control.
