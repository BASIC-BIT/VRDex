# Current VRChat icon support

## Approved outcome

Restore automatic person pictures for current VRChat `iconUrl` responses while preserving custom-picture-only selection. BASIC authorized implementation after the field-shape investigation. Authored media, visibility, source precedence, and existing cache behavior stay in force.

Use the existing resolver and request-budget path. Legacy `userIcon` retains its explicit custom-icon behavior. A modern `iconUrl` requires an exact provider file reference, matching file owner, unambiguous `icon` purpose, and a complete matching version. Missing or unsupported provenance resolves the name without artwork. Temporary file-read failures preserve cached results; account authentication, rate limits, and budget errors retain existing handling.

The tradeoff is one additional budgeted provider GET for a modern icon. Unsupported URL layouts fail closed until their file identity can be established. No public prose or visual layout changes are proposed.

## Implementation and verification

- [x] Add a failing current-response regression through `VrchatClient` and the destination-job boundary. Cover file ownership/purpose/version rejection and the second request's budget/error behavior.
- [x] Add the smallest resolver change in `workers/group-telemetry/profile-link-destination.mjs`. Reuse the existing `user_icon` result contract, bounded HTTP parser, and per-request reservation. The five-minute job lease already bounds two provider requests of at most 15 seconds each.
- [x] Run the complete collector suite and relevant existing backend/web projection coverage. Update `docs/backend/profile-schema.md`, collector operating documentation, and the historical research correction.
- [ ] Request independent code review, address valid findings, then commit, push, and open a PR. Report source/CI evidence separately from deployment and production refresh.

## Scope boundary

No production cache sweep, manual image replacement, provider credential access, or deployment is included in this implementation. The collector account's exact-target file visibility and default/migrated icon controls remain runtime verification requirements. A later bounded rollout should verify those before refreshing affected rows through the existing queue.

## Verification evidence

The modern-response regression and its second-request budget/authentication tests failed before the selector change and passed afterward. The complete collector suite passed 182 tests. Existing backend destination/fallback/projection tests passed 18 tests; artwork/import/cache tests passed 13 tests. Markdown lint passed across 213 files. Independent review found no actionable defects. These checks establish local behavior, not production deployment or a refreshed picture.
