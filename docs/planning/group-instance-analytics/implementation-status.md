# Club analytics and management implementation status

Goal: implement and verify the entire accepted first-release specification. A completed local slice is not completion of this goal. Source requirements are the [discovery decisions](../group-instance-analytics-discovery-2026-09-08.md), [staff design](2026-09-10-club-staff-and-visibility-design.md) and approved dashboard preview. Later locked decisions supersede earlier candidate text.

Updated September 23, 2026. Integration checkout: `codex/club-staff-workspace`. No hosted release or live provider proof has occurred in this program.

## PR review checkpoint, September 16, 2026

PR #341 is published and undergoing iterative review. The latest local fixes preserve distinct-club discovery with multiple roles, reject unavailable collectors, hide anonymous movement when analytics is disabled, and revalidate dependent invitation event associations. Malformed or inaccessible instance links retain a Back control; stale event suggestions can be dismissed but not confirmed. Reconnection retains supported saved group settings, and membership-history-only staff can discover Analytics. Review fixes remain subject to current-head CI and AI review. BASIC approved the edited exact copy on September 16, 2026. The live release evidence below remains outstanding.

September 23 local follow-up: the shared public telemetry projection now returns no telemetry while analytics is explicitly disabled, including retained history, member metrics, and event recaps. Public community and profile reads share the correction, while authorized private dashboard history remains available. Focused backend and profile/API contract checks are recorded in the Task 7 handoff. This local change has not been published or verified against a hosted deployment.

September 23 Task 8 local follow-up: suggestion confirmation and rejection now recheck current recap access. Independent minute-based bounded scans expire unsent work beyond its current 15-minute grace even without a collector, including preexisting rows. Private membership day and range charts use compact poll coverage and break across explicit or silent outages; legacy windows retain exact observations without inferred continuity. The Task 8 report records scoped backend/model checks, desktop/mobile segmentation and screenshots, types, lint and documentation checks. Hosted deployment, provider behavior and exact-head remote readiness remain unverified.

## Earlier implementation checkpoint

Local implementation is committed through `4cc95baf0`, following `dcdc0e044` for the complete workspace. The full backend suite passed again after the final security fixes on September 14. All provider-read caches now invalidate after bot reassignment or credential rotation and reject disabled/inactive accounts. Public membership history also respects profile publication visibility.

The recorded combined checkpoint includes full web and worker tests, backend/web typechecks, the production web build and documentation checks. The complete worker suite has 105 tests. Focused desktop/mobile browser checks cover Members, Connection, Instances, Posts, Invitations, Scheduled actions, notifications and event association.

Real Clerk sessions against isolated local Convex verified staff invitation sign-in return, acceptance, nonstaff denial and expired/revoked/consumed tokens. A separate real-route analytics run verified persisted range/layout, month/day/instance browser history, category filtering and preference isolation with synthetic observations. Disposable fixtures and accounts were cleaned up and their local processes stopped.

Earlier checkpoint defects are resolved locally: notification history pagination, bounded email draining, request-budget starvation, post-authorization execution deadlines, invitation dependency timing, batch cancellation visibility and event-hook pagination. The historical entries below do not represent current open defects.

The additional-group-link regression now exercises the actual browser-save mutation and public query for a community with one primary integration. Two ordinary links survive saves and reordering, private links are hidden, and the integration and collector leases remain unchanged. All 12 destination tests pass. A manual browser check of the existing DestinationEditor story added a fourth group URL, verified VRChat-group detection and a custom label, and visually inspected the rendered row. This verifies editor interaction separately from backend persistence; a single authenticated editor-to-public-page journey remains unverified.

Remaining evidence includes additional group links through browser editing, actual provider collection and management operations, scheduled execution against an approved group, real failure-email delivery, remote review and approved deployment. No live provider write or email delivery was performed in this program.

Q27 requires reconciliation before retrying an indeterminate write, and Q33 forbids duplicate retries without reconciliation. Current code stops uncertain writes and never automatically retries them. An evidence-backed resolution/recovery workflow is absent. Creating a new job is not reconciliation.

## Requirements and evidence, historical implementation checklist

| Requirement | Implementation state | Required completion evidence |
| --- | --- | --- |
| Permanent raw and aggregate retention | Local commit `c0f2e1c6d` | Retention tests pass; release removes deployed compaction job |
| Singleton owner, editable presets/custom roles, multi-role union | Local commit `f025200a1` | Backend tests, owner/delegate browser flows |
| Explicit delegated role assignments, no self-escalation | Local commit `f025200a1` | Cross-club, revoked authority and atomic invitation tests |
| Public/selected-staff/owner category visibility | Local commit `f025200a1` | Nested response filtering, legacy settings tests, hosted migration verification |
| Staff workspace, connection page, account discovery | Local commit `f025200a1` | Desktop/mobile fixtures checked; authenticated real-route verification outstanding |
| Single-use invitations with current inviter revalidation | Local commit `f025200a1`; real local Clerk browser flow passes | Genuine sign-in return, acceptance, access denial and expired/revoked/consumed tokens verified; hosted release remains |
| Last-30-days Home; activity bars and membership line | Range-backed Recharts views implemented locally | Backend/model and fixture browser checks pass; authenticated assembled view remains |
| Month/day/instance drill-down and browser history | Implemented; real local Clerk browser flow passes | Actual month/day and Home day-to-instance navigation with browser back/forward verified |
| Independent tooltips, local-day/DST semantics, missing-data gaps | Implemented locally with model/backend boundary tests | Final assembled chart interaction and visual review |
| Owner dashboard default and personal overrides/reset | Implemented; real authenticated personal persistence verified | Save/reload range/layout and staff isolation pass; owner default/reset covered by backend/fixture checks |
| Live/past instances, all recorded sessions, peak/time-weighted average | Paginated session summaries implemented locally | Backend range/gap math tests and population-first fixture checks pass |
| Instance detail curve, unknown closure, completeness | Detail queries and UI implemented locally | Fine-series tests and visual inspection; no Coverage/State list columns |
| Membership movement and identifiable membership activity | Backend, resumable worker collection and Analytics UI implemented locally | Integrated authenticated/provider proof remains; backend and desktop/mobile fixture tests pass |
| One primary group plus ordinary additional group links | Primary label and owner profile-editor link implemented; existing profile links reused | Six connection browser checks pass; multi-link editor/public projection proof remains |
| Bot onboarding and independent enabled features | Backend, worker refresh and Connection UI implemented locally | Guided flows visually tested; provider role picker and authenticated/provider proof remain |
| Search/filter/detail members; requests, invites, existing roles | Read backend/HTTP/worker and Members UI implemented locally | Focused desktop/mobile checks pass; authenticated/provider proofs remain |
| Individual removal and ban/unban with confirmation | Member UI, operation policy and provider adapter implemented locally | Focused browser and backend tests pass; live provider proof remains |
| Bulk selected requests and permitted role assignments | Member UI and bounded operation batches implemented locally | Exact-target confirmation and per-target outcomes tested locally; live provider proof remains |
| Owner-controlled grantable VRChat roles per staff role | Connection allowlist mutation and UI implemented locally | Owner-only and allowed-role backend tests; live role-picker verification remains |
| Modern Posts drafts/preview/publish/edit/delete | Draft backend and Posts UI implemented locally; integrated verification underway | Modern posts endpoint semantics, permissions, persistence and UI |
| Standalone/event instances and normal closure | Instance controls and provider adapter implemented locally | Provider create/close verification; event association; final visual evidence review |
| One-time fixed/event-relative scheduled jobs | Durable queue, event lifecycle hooks and Scheduled actions UI implemented locally | Changed-event time, cancellation, grace and missed-state tests pass; authenticated integrated proof remains |
| Bulk group and instance invites; reusable explicit lists | Backend and connected UI implemented and tested locally | Eight desktop/mobile checks cover lists, reviewed snapshots, outcomes, cancellation and eligibility; provider proof remains |
| Instance-invite dependencies and optional bot-friend flow | Dependency execution, bot link and explicit recipient eligibility implemented locally | No substitute destination; provider no-client sending proof remains |
| Execution-time human/feature/provider reauthorization | Policy, durable queue and worker dispatch wired locally | Final authorization follows budget reservation; authenticated/provider proof still required |
| Indeterminate writes and bounded retries | Adapter classifies uncertain writes without retry; reconciliation not implemented | Transport-failure reconciliation; no blind duplicate invites/posts/instances |
| Shared Scheduled actions and feature-local queues | Scheduled actions UI implemented and browser-tested locally | Permission-filtered edit/cancel screens and event-bound cancellation tests; remaining invitation UI integration |
| In-app/email actionable failures with owner fallback | Backend/component and disabled-by-default delivery cron added; integration underway | Batch email deduplication, recipient-access recheck and delivery tests |
| Event association and recaps | Deliberate association in current instance detail implemented and visually checked | Same-club/current-epoch/manage_events regression checks pass; no automatic or fabricated session matching |
| Full assembled experience working | Not achieved | Integrated tests, provider proofs, visual review, exact-copy approval and release checks |

## Historical work allocation

- Analytics backend: bounded aggregate buckets, fine queries, session metrics and persisted preferences.
- Analytics frontend: approved Recharts screens, URL state, customization and responsive verification.
- Invitation verification: a real Clerk/Convex route test with production-disabled disposable fixture support.
- Coordinator: provider capability/execution contracts, requirement tracking, integration and review.
- Membership ingestion: audit storage and range coverage implemented; authenticated resumable worker scans in progress.
- Connection readiness: independent feature settings, provider-role allowlists and current own-member evidence.
- Instance list: replacing raw lifetime downloads with bounded server summary pages; raw curves remain detail-only.

## Explicit deferrals

The September 14 source audit found richer comparative reports, exports and private staff API/MCP reads remain candidate or later-slice scope, not separately locked launch requirements. The dormant export permission is marked unavailable in the role editor. Existing public projections still require category enforcement. This does not defer the accepted event-instance association requirement.

Named instance attendance, member-versus-guest instance segmentation, opt-in personal listening/visit history, deletion workflows, ownership transfer, recurring schedules, role-definition editing in VRChat, arbitrary chart builders and unattended moderation rules are not first-release requirements.

## Historical verification checkpoints

The request-budget starvation and slow-authorization deadline defects are fixed.
The claimed operation exposes its exact execution deadline; the worker enforces
it after authorization as well as before provider requests. All 103 worker tests
and 15 focused operation tests pass at this checkpoint. Unsupported management
budgets reject explicitly without increasing configured limits. Actual provider
behavior still requires the bounded authorized integration proof.

Notification history now uses permission-filtered cursor pagination; older actionable notices remain reachable after empty filtered pages and all-read pages. Scheduled-action links avoid sending invitation-only staff to an inaccessible Members screen. Backend and desktop/mobile fixture regressions pass. Invitation dependency timing and batch cancellation visibility pass 21 focused backend tests: schedules remain explicit, conflicts after parent rescheduling reject rather than silently changing targets or times. Worker budget tests now cover supported minima and immediate explicit failure for insufficient budgets; a post-authorization grace-deadline guard is being added before final integrated verification.

Integration review identified two open defects: notification reads filter only the newest 100 community rows, potentially hiding an older recipient's actionable failure; and a one-request-per-minute budget can repeatedly age operation preflight evidence without reaching submission. Both have active fixes with pagination and fake-clock regression coverage planned. The real Clerk flow reached invitation sign-in; a test navigation race is being corrected before rerun. Cleanup succeeded. Neither partial browser progress nor dispatch review establishes complete end-to-end operation proof.

Notification delivery now drains at most 20 independently claimed messages per run, retains one transport attempt, and continues other recipients after uncertain transport/acknowledgement. Five focused notification/delivery tests pass. No email was sent. A fresh credential-name/mode-only check found Clerk development keys in the main checkout, so the previously unavailable real invitation journey is now under local setup investigation; matching JWT configuration and browser execution are not yet proven.

The latest isolated local Convex preparation, generated types and health execution pass. Instance scheduling now previews the exact offset execution time; all six desktop/mobile instance browser tests pass and the updated mobile screenshot was reviewed. Connection labels and owner-only additional-link navigation pass six desktop/mobile browser checks, with desktop screenshot review. These remain local fixture checks, not live provider proof.

September 14 combined checkpoint: the complete backend, web and group-telemetry worker test suites and backend/web TypeScript checks pass with dependent invitations, Posts, event hooks and notification transitions included. Web route type generation required a local filesystem permission retry. Members, Posts and Scheduled actions have focused desktop/mobile browser evidence, but this does not establish authenticated real-route or live provider behavior. Invitation backend tests pass; its UI is being assembled. The UI integration identified missing batch-history discovery and an instance destination picker independent of analytics access, which remain active work. Notification delivery also needs a bounded drain rather than one message per five-minute global tick.

Latest local provider verification: 17 existing worker tests and 14 adapter/transport tests pass. The transport accepts documented zero-byte success responses only with an explicit option and still bounds bodies and rejects malformed responses. Adapter regression tests cover owner invitation eligibility and nonadvancing pagination. These tests use fake transport and do not establish live provider behavior. The six operation-policy tests also pass; the policy is not yet connected to durable execution.

The real invitation Playwright test and disposable fixture support now exist. Authenticated execution still requires a matching Clerk development instance and Convex JWT template; test discovery and helper tests do not prove that journey.

Worker authority refresh now reserves two requests from the shared account/integration budget, sends only permission evidence and preserves a successfully recorded telemetry poll if the separate refresh fails. The analytics TypeScript compatibility issue is fixed. Isolated local Convex preparation/code generation and health execution pass; the full backend suite subsequently passed after membership worker authentication was integrated.

Audit collection resumes one persisted provider page per leased telemetry poll, reserves an additional request, and retains raw provider offsets when boundary rows are filtered. It uses fixed windows, a one-minute ingestion delay and five-minute overlap on completed windows; late provider events outside that overlap remain a provider-reconciliation limitation, not proof of exhaustive historical capture. Seven worker tests cover authority budgets, audit normalization and collection failure/boundary behavior. Provider errors never certify a scan as complete. No live provider data was fetched by these tests.

Feature-disable integration review added transactional guards against telemetry/audit ingestion after analytics is disabled. The worker skips those reads while continuing readiness refreshes. Public and staff current-population summaries stop presenting current values immediately; historical rows remain retained. Focused telemetry, membership and analytics regressions pass. `view_members` is an explicit staff capability, included in newly initialized Admin/Moderator presets; existing saved roles are not silently expanded.

Directory reads now run through the existing integration lease and authenticated HTTP channel. Per-request reservations allow multi-step queued reads and audit pages to cross budget windows without raising the default four-request integration limit. Waits keep heartbeats and stop at a bounded deadline/shutdown. Budget tests and read projection tests pass. The combined queue schema, functions and HTTP endpoints pass isolated local Convex preparation and health execution.

Operation dispatch is now wired locally: provider preflight, budget wait, stale-grant refresh, final server authorization and a single provider write attempt. If refresh crosses a budget window, the write obtains a new reservation before authorization. Worker tests cover revoked authority, delayed preflight, successful outcomes and indeterminate transport with no retry. The complete group-worker `.test.mjs` suite and worker syntax check pass. No actual provider write has been performed; event lifecycle hooks, transient preflight retry, notifications and dependent invitation batches remain open.

Transient preflight retry is now wired through a claimed-only defer endpoint, preserving the original due time and refusing to requeue submitted work. The accepted Q31-Q33 cutoff applies to remaining unsent recipients as well as other actions: after 15 minutes, mark them missed and require deliberate rescheduling. A batch-start exemption is not part of the accepted scope. Worker regression tests verify preflight timeouts use deferral before any authorization or provider write; uncertain submitted writes still receive no retry.

Latest combined verification: local Convex preparation/codegen/health passes with Posts, notifications and indexed operation readiness. The subsequent full backend suite found three local-fixture regressions: updating multiple events invokes multiple paginated event-hook queries in one mutation. That integrated runtime failure is open pending the event-hook fix. Operation-worker tests now also verify an instance closing during a budget wait prevents invitation submission.

The event-hook regression is fixed: synchronous event updates use bounded reads, while separate scheduled continuation mutations each use one paginated query. The full backend suite passed after this fix. The next local verification run refreshed generated types but overlapped active invitation-dependency edits and stopped on their unfinished helper; repeat combined verification after that lane stabilizes.

The staff foundation passed backend/web suites, typechecks, lint and documentation build. It loaded and generated types against an isolated anonymous local Convex instance. Storybook screenshots prove rendering only. They do not prove a hosted authentication journey or an actual VRChat operation. A provider capability remains unproven until a bounded authorized test establishes it; implementation can continue while these explicit proof items remain open.
