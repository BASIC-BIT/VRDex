# Task 2 report: public playback admission

Status: DONE_WITH_CONCERNS. Implementation and focused validation complete; broader-run disposition below.

## Changed files

- `convex/_mediaRelayTables.ts`: source-session and context-grant storage fragment, indexed lookup, lifecycle-state capacity and bounded admission quota indexes.
- `convex/schema.ts`: includes the relay fragment.
- `convex/_mediaRelayAuthorization.ts`: existing public profile/event authorization and policy-only revision fingerprint; public artwork/name metadata.
- `convex/mediaRelayPlayback.ts`: public open/get/release handlers, internal grant resolution, off-by-default bounded configuration, opaque capabilities and two rendition URLs.
- `convex/_generated/api.d.ts`: CLI-generated module declarations; no handwritten generated changes.
- `tests/backend/media-relay-admission.test.ts`: 13 focused convex-test cases.
- `docs/engineering/media-relay-admission.md`: caller identifiers, lifecycle boundary, environment definitions/ownership and later-task integration contract.
- This report.

Existing public page projections remain read-only. Their existing IDs and parsed stream identities supply the context contract; no admission call was added to page reads.

## Wire decisions

Task 1 schemas and schema-derived `Admission`, `PublicContext`, `DjMetadata`, stream-key and grant contracts are consumed directly. Storage validators only represent database fields.

- Profile `linkId` is the canonical case-preserving stream ID of an actual link in `publicProfileOutboundLinks(profile, "profile_page")`; links have no persistent row IDs. Public unlisted profile-page links follow existing visibility semantics; private links deny.
- Event-stream `selectedSourceId` is the canonical stream ID of an authorized public watch/stream/vrcdn media link. Performer-sequence `selectedSourceId` is the projected slot's existing `playbackKey`, with its current resolved stream and public performer verified through the canonical projection.
- Grant IDs use server-generated `crypto.randomUUID()`, separate from database row IDs. Separate opens/contexts receive separate grants; the source row is deduplicated transactionally by case-preserving StreamKey.
- A grant permits video and audio for exactly `RELAY_POLICY.grantLifetimeMs` (43,200,000 ms). `preferredMode` validates user intent but does not narrow the capability or change client mode state.
- `getPlayback` polls the preparing grant ID; ready URLs are `<MEDIA_RELAY_PLAYBACK_ORIGIN>/p/<grantId>/video/index.m3u8` and `/p/<grantId>/audio/index.m3u8`. The following delivery task must implement this same route contract. Missing delivery origin stays preparing.
- New event opens must pass the established doors/start/end window, even if a shared source already exists. Server-issued in-window admission is continuation proof for an existing grant after the window; this is not evidence that the server observed audible/native playback start.
- Context revision fingerprints source and public authorization policy, excluding title/name/description/artwork/labels and schedule continuation. Stable ordered scalar arrays avoid changes from Convex object-key serialization. Every resolution independently reauthorizes the current projection; the numeric fingerprint is not a security substitute.
- Controller ruling: removing/hiding/changing a public source denies immediately; restoring exactly the same source/policy can validate an unexpired grant again. Explicit release is permanently latched for that grant. Tests document remove/restore and release/restore separately. No permanent revocation tombstone or broad mutator revision retrofit is implied.
- Metadata uses the selected public profile portrait/logo asset and its asset update revision; absent asset-backed artwork uses null handles. Event-stream mode without a selected performer uses the event title and null artwork. No original asset is changed. Later metadata presentation owns `<DJ display name> - VRDex` formatting.

## Configuration

Server-owned `MEDIA_RELAY_ENABLED` must equal `true`; positive bounded integers are also required for `MEDIA_RELAY_MAX_SOURCES` (max 1,000), `MEDIA_RELAY_MAX_GRANTS` (max 10,000), and `MEDIA_RELAY_ADMISSIONS_PER_MINUTE` (max 10,000). Missing/zero/invalid settings fail closed. Optional `MEDIA_RELAY_PLAYBACK_ORIGIN` must be HTTPS without embedded credentials/query/fragment. No production values were set.

Quota reads are bounded/indexed and occur inside the admission transaction. The per-minute quota counts successful opens in a rolling 60,000 ms global window. Grant capacity counts only unreleased/unexpired grants; release returns that capacity without erasing rate history. Source capacity counts queued, starting, ready, recovering and draining rows. Polling/release never sustains source activity; source idle lifecycle, native playlist activity and cleanup remain following tasks.

## RED/GREEN evidence

Tooling activated with `source /workspace/vrdex-env.sh` in every shell. Proxy/CA environment was preserved.

1. Created focused tests first. Required `node --conditions=import --import tsx --test tests/backend/media-relay-admission.test.ts` exited 1 before handlers existed. Because this environment's child test reporter gives file-level summaries, also ran the same file without `--test` to expose individual failures. After correcting the test module map to include `_generated/api.ts`, all six initial cases failed because the new handler module was absent (`ERR_MODULE_NOT_FOUND`).
2. Initial handler implementation produced actual assertion failures (`unavailable` instead of `preparing`): the revision serialized context object key order differently before and after database roundtrip. Fixed revision construction to ordered scalar arrays; the six initial behavioral cases passed.
3. Added artwork test before artwork implementation: RED (`artworkAssetId` null versus selected public asset ID); GREEN after using the existing public media-kit projection. It asserts original asset record remains byte-for-byte unchanged and hidden artwork becomes null without grant revocation.
4. Added release-capacity test before the capacity correction: RED (`capacityLimited` instead of `preparing` after release); GREEN after indexed unreleased/unexpired grant lookup. Rate history remains intact.
5. Final required focused command exited 0 with all 13 cases passing. Also ran without `--test` for individual-case reporting. Cases cover guest authorization/off/zero/invented/hidden, 20 concurrent opens creating one queued source, context-specific revocation, metadata, calendar continuation/new starts/cancellation, exact expiry/release, configured quotas, performer slot/public link visibility, both ready URLs, artwork, source capacity, future/date-only/unpublished contexts, release capacity, and restore/release latching.
6. `pnpm verify:backend:local`: initial sandbox attempt failed with network `EPERM`. Retried through supported additional network permissions, preserving proxy/CA. Canonical local CLI command succeeded (exit 0), generated API declarations, created local indexes and returned health `status: ok`. Repeated after the final grant index change: exit 0, health `ok`. No hosted backend mutation occurred. CLI reports its anonymous-agent beta notice, a Convex 1.32.0→1.48.0 update notice and a TypeScript 7 performance suggestion; these are tool notices, not backend typecheck failures.
7. `pnpm typecheck:backend`: passed, exit 0, including after final handler/schema changes.
8. `git diff --check`: passed.

The broad backend run began before final test additions/corrections and is not final-code verification. In particular, its admission failure captured a transient date-only fixture lacking the required eventDate; the final focused command passes. No broad web suite was run.

## Self-review

- Actual authorization is always checked against public context; neither ownership claims nor caller-provided stream identity establish authority.
- Page reads cannot enqueue source work. Mutation source uniqueness/capacity checks use the same transaction. Twenty concurrent opens assert one queued source and twenty opaque grants.
- An event's removed source affects its own context grant while the profile capability remains valid. Release touches only its grant, never shared source state.
- Expiry denies at the exact boundary and future timestamps before issuance deny. Public callers cannot choose the internal resolver timestamp.
- Disabled/missing/zero/bad capacity closes both new and existing capability resolution. Sources are queued only after authorization and quota checks.
- Readiness requires a ready source plus valid server-origin configuration. Both rendition URLs use the same capability. Worker readiness/freshness and HTTP enforcement are intentionally subsequent-task responsibilities.
- Public metadata uses existing visibility logic and never rewrites original images. Public UI copy and browser/mobile behavior were not changed or claimed.
- No hosted writes, deploy/resource apply, security posture changes, or subordinate reviewers were used. Only this task's two local generation backend processes were stopped with SIGTERM (23694 and 27243); they became defunct children of PID 1, which this non-parent cannot reap. No global kill was used.

## Remaining integration concerns

- Following tasks must enforce internal grant resolution on delivery, implement worker readiness/freshness/lifecycle and garbage-collect expired grant/history records. The disabled default remains until explicit release controls enable bounded production operation.
- Artifact-backed artwork is available; legacy remote/automatic avatar URLs without an asset ID retain null artwork handles for the later artwork resolver.
- Broader backend failures are recorded below as observed failures, not established pre-existing failures; Task 12 should investigate them without conflating the final focused green run with a green repository suite.

## Final verification and broader-run disposition

- Controller supplied Task 6's exact path after initial implementation: `/p/:grantId/:rendition/index.m3u8`. Updated the ready-URL assertion first and observed RED (old `/playback/.../video.m3u8` versus required `/p/.../video/index.m3u8`), then corrected the handler and docs. Final required focused command and individual-case reporter both exited 0: 13/13 cases GREEN. This was a literal route-string correction after the successful canonical generation/typecheck; it changes no generated signature or schema.
- Relevant existing projection regressions: `node --conditions=import --import tsx --test tests/backend/event-playback-projection.test.ts tests/backend/event-runtime-window.test.ts tests/backend/profile-image-projections.test.ts` exited 0, 3/3 files passing.
- Broader `pnpm test:backend` was bounded after approximately five minutes, with no log progress while pending child tests held the run open. Stopped only the process tree descended from this task's test runner PID 24002 (seven live processes in the snapshot). Runner produced exit 1 and its file-level summary: 133 tests, 122 passed, 9 failed, 2 cancelled, duration 317,419.941386 ms. It is not a final-code validation run because focused tests were edited during that run.
- Observed failing files: `event-broadcast-relay.test.ts`, `event-broadcast-sources.test.ts`, `event-broadcast-worker.test.ts`, `event-lineup-story.test.ts`, `event-twitch-input.test.ts`, `hosted-mcp-profile-media.test.ts`, `media-relay-admission.test.ts` (transient fixture under development, final focused run passes), `restream-vrcdn-poc-config.test.ts`, `restream-worker-config.test.ts`.
- Observed cancelled/pending files: `profile-preview-response.test.ts`, `public-media-details.test.ts`; reporter says promise resolution remained pending after the event loop resolved. The bounded termination affects interpretation of these two results.
- Reporter provides file-level failures only (`test failed`) for the nine files. They have not been reproduced without Task 2 and must not be described as established baseline failures. Deferred investigation belongs to Task 12; no unrelated broad web suite or repeat broad backend suite was run.
- Local backend processes 23694 and 27243 were terminated and observed as defunct, not live. Generated API diff contains only this task's three module declarations. Final `git diff --check` passed.

Final status: DONE_WITH_CONCERNS due to the explicitly incomplete/non-green broader backend evidence and deferred integration work described above. Task 2 focused behavior, canonical generation, backend typecheck and relevant existing projection regressions passed.
