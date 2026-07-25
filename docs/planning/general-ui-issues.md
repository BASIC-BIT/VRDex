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

## Coordination

- `codex/claim-search-journey` also changes `apps/web/src/app/account/account-panel.tsx`; this lane keeps its integration there to one import and one rendered control.
- `codex/unified-search-views` does not currently overlap the sign-out implementation.
