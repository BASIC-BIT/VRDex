# Automatic group statistics implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Native execution is recommended for this plan because the tasks change the same assignment, authorization and projection contracts.

**Goal:** Automatically collect and publish safe group statistics for eligible linked VRChat groups, including members-only instance totals, without requiring verified operator onboarding.

**Architecture:** Reuse the existing account-scoped collector, integration IDs, leases, observations and rollups. Add a canonical group-level observation policy and an explicit aggregate-only assignment variant. Resolve public output through one policy boundary shared by profiles, membership snapshots, REST and MCP; preserve all existing managed privacy decisions.

**Tech Stack:** Existing Node 24, pnpm 10.15.1, TypeScript, Convex, Next.js, Recharts, Node test runner, convex-test and Playwright. No new dependencies or services.

**Spec:** [Approved automatic group statistics design](../specs/2026-10-25-automatic-group-statistics-design.md). BASIC approved the full design on October 25, 2026. This plan is awaiting review; implementation and live activation have not started.

## Global constraints

- "Individual users and private instance links must not be exposed."
- "Never automatically submit membership requests to request-to-join groups."
- "Removing the bot in VRChat is also honored as a stop. Do not rotate accounts to regain visibility."
- "Existing managed communities retain their current enabled features, category audiences, explicit analytics disablement and disconnect decisions."
- "Managed assignments have priority in queue ordering only; no immediate slot is guaranteed and neither mode evicts an active assignment."
- "Keep current freshness and gap rules: population expires after six minutes; player-time integrates only between observations at most five minutes apart; failures are gaps."
- "Return at most 720 chronological buckets with observed minima, maxima and last values; preserve missing positions and segment gaps before reducing points."
- "Keep the currently accepted permanent retention policy for existing aggregate observations."
- Automatic candidate limit: five new immutable groups per contributor per rolling 24 hours. Repeated saves and duplicate profiles for an already registered group do not spend another candidate.
- Automatic enrollment requires a public, unsuppressed community's active primary group link and provider-confirmed public/free-join eligibility. Additional group links do not trigger joining.
- Automatic mode never requests or stores rosters, named membership events, presence history or raw provider payloads. Worlds and per-instance breakdowns stay out of automatic public output.
- No new public prose ships without BASIC reviewing the exact wording. Prefer existing utility labels and controls.
- Rebase the implementation work on then-current `origin/main` without disturbing shared checkouts. Keep the approved spec beside this plan and inspect applicable repo/Convex/TypeScript skills before code changes.
- Default automatic admission is off. A reviewed implementation can be merged without joining groups; production migration, deployment, pilot group and activation require their own authorization.

## Review focus

1. A duplicate unclaimed profile must not publish a group's managed-private statistics. Pin this in Tasks 2 and 6.
2. A legacy worker or direct HTTP caller must not execute named collection or management for an automatic target. Pin this in Task 4.
3. Opt-out must beat an in-flight poll and the independent daily member sampler. Pin this in Tasks 3 and 5.
4. Relinking a profile, claim/adoption or bot reassignment must not attach old history to a different group or reset valid history. Pin this in Tasks 1, 5 and 6.
5. Dense observations surrounding a gap, daylight-saving changes or a short-lived peak must not become a continuous or falsely precise chart. Pin this in Tasks 6 and 7.

## Delivery sequence and file map

Tasks run sequentially. Every task must leave automatic enrollment disabled and existing managed functionality working. A task commit is a reviewable source milestone, not a deployable public feature on its own.

| Task | Main files and responsibility |
| --- | --- |
| 1. Collection identity | `convex/schema.ts`, `convex/_communityTelemetry.ts`, new `convex/_groupObservationPolicy.ts`, `convex/migrations.ts`; canonical group records, normalized assignment variants, backward-compatible storage |
| 2. Policy and public projection | `_groupObservationPolicy.ts`, `convex/_communityTelemetryPublic.ts`, `convex/profiles.ts`, `convex/communityTelemetry.ts`; one read policy and allow-listed automatic output |
| 3. Enrollment and metadata | New `convex/groupObservations.ts`, `_externalControl.ts`, `_profileUpdates.ts`, `_profileSubmissions.ts`, `profilePrivacy.ts`, `profileArchival.ts`, `crons.ts`, `groupMemberSnapshots.ts`, `workers/group-telemetry/group-member-jobs.mjs`; fair bounded enrollment and cleanup |
| 4. Worker isolation | `workers/group-telemetry/worker.mjs`, `vrchat-client.mjs`, `runtime.mjs`, `convex/http.ts`, `communityTelemetry.ts`, `clubMembership.ts`, `clubOperations.ts`, `clubProviderReads.ts`; explicit aggregate-only protocol |
| 5. Operator transitions | `groupObservations.ts`, `communityTelemetry.ts`, `profileConnections.ts`, `_externalControl.ts`, `clubConnection.ts`, `clubStaff.ts`; verified adoption, group stop and resume |
| 6. Range and public contracts | `_communityTelemetryPublic.ts`, `communityTelemetry.ts`, `profiles.ts`, `packages/api-contracts/src/schemas.ts`, `openapi.ts`, `apps/web/src/lib/server/api-v0.ts`, `vrdex-mcp.ts`, `packages/vrdex-mcp/src/api-client.ts`, `server.ts`; bounded series and consistent REST/MCP reads |
| 7. Existing community UI | `apps/web/src/app/_components/profile-public-page.tsx`, new sibling `public-group-population-chart.tsx`, new `apps/web/src/lib/public-group-statistics.ts`, existing Playwright fixture route; accessible graph with real gaps |
| 8. Release proof | `docs/public/community-telemetry.md`, `docs/backend/community-group-telemetry.md`, `docs/deployment/group-telemetry-collector.md`, `workers/group-telemetry/README.md`, Terraform collector files if an uncovered alarm is found; migration and pilot runbook |

New backend tests live in `tests/backend/automatic-group-statistics.test.ts`. Extend existing regression suites where they already own the behavior rather than copying their fixtures. Test snippets below show required assertions, not replacement implementations of the existing test harness.

## Task 1: Establish group identity without changing managed behavior

**Files:** Modify `convex/schema.ts`, `convex/_communityTelemetry.ts`, `convex/migrations.ts`, `convex/communityTelemetry.ts`; create `_groupObservationPolicy.ts` and `tests/backend/automatic-group-statistics.test.ts`. Audit every `communityProfileId` read on integrations, sessions and rollups with `rg` before changing optionality.

**Interfaces:**

- Add `vrchatGroupObservationPolicies`, indexed uniquely by application-enforced `vrchatGroupId`. It stores canonical `integrationId` when allocated, a discriminated enabled/stopped observation decision, queued admission metadata and `publicHistoryStartAt`. A stopped decision includes reason, actor class and time; it survives membership cleanup and profile deletion. No raw provider payload or person roster belongs here.
- Add `collectionScope` to integrations as `automatic` or `managed`. Managed scope names its managing `communityProfileId`; automatic scope has no managing profile. During migration, a missing scope means legacy managed. Retain the old top-level profile field temporarily for its existing index, make it optional for automatic records, and reject mismatches with the managed scope at every write boundary.
- `_groupObservationPolicy.ts` exports `readCollectionSubject(integration: Doc<"communityVrchatIntegrations">): CollectionSubject`, where the result is a schema-derived discriminated union. Managed results include a required managing profile; automatic results cannot expose one. No new code consumes the optional legacy field directly.
- Add internal paged migration `migrations.backfillGroupObservationPolicies` and its existing-pattern runner `runBackfillGroupObservationPolicies`. Batch size is 50. The migration registers existing managed records without changing settings, epochs, leases, account allocation or history.

- [ ] **1. Write schema and migration regressions.** Seed active, disconnected, analytics-disabled and private managed groups, plus two historical disconnected records for one group. Assert a second migration is a no-op, preserves all visibility/feature fields and leaves stopped/disconnected managed groups protected from automatic enrollment. Conflicting active records are reported for reconciliation rather than merged.

  ```ts
  assert.deepEqual(after.publicMetrics, before.publicMetrics);
  assert.equal(after.telemetryEpochStartedAt, before.telemetryEpochStartedAt);
  assert.equal(automaticSubject.kind, "automatic");
  assert.equal("communityProfileId" in automaticSubject, false);
  assert.equal(await canonicalCountForGroup(groupId), 1);
  ```

- [ ] **2. Run RED:** `node --conditions=import --import tsx --test --test-name-pattern="collection identity|legacy migration" tests/backend/automatic-group-statistics.test.ts`. Expect the new identity assertions to fail before implementation, not because dependencies are absent.
- [ ] **3. Implement the schema, normalizer and migration.** Reuse existing integration IDs. Sessions may omit a managing profile in automatic mode. Add integration-scoped indexes to rollups; store `integrationId` on new rollups and backfill old ones through the existing managed community mapping. Do not duplicate history or relabel another group's rows. Audit events already allow no community binding.
- [ ] **4. Run GREEN:** repeat the focused command, then `pnpm typecheck:backend` and the existing `community-telemetry.test.ts` and `club-connection.test.ts` suites. Repair every affected managed consumer using `readCollectionSubject` rather than non-null assertions.
- [ ] **5. Commit:** `feat(telemetry): add canonical group observation identity`.

## Task 2: Centralize policy and safe aggregate output

**Files:** `_groupObservationPolicy.ts`, `_communityTelemetryPublic.ts`, `profiles.ts`, `communityTelemetry.ts`; tests `automatic-group-statistics.test.ts`, `public-group-membership.test.ts`, `community-telemetry-review-regressions.test.ts`.

**Interfaces:**

- Export `resolveGroupObservationPolicy(db, { vrchatGroupId, profileId, now }): Promise<GroupObservationPolicy>`. Result variants are `hidden`, `member_metadata`, `automatic_aggregate` and `managed`; managed carries the authoritative managing community and its category policy. Resolve group stop first, then managed decisions, then automatic eligibility. Profile suppression can only restrict a result.
- Preserve existing `getPublicGroupMembership(db, communityProfileId)` and `getPublicCommunityTelemetry(db, communityProfileId, now)` entry points. Both call the shared resolver. Missing registry rows fall back only to existing managed rules during migration, never to automatic publication.
- Automatic output is constructed field by field. It contains current group population/instance count, observed member size/growth, safe history/peaks/player-hours and freshness/coverage. No spread of a dashboard, session or rollup containing private fields. Use `publicationPolicy: "automatic_aggregate"` to distinguish the safe result, including after management adoption. Persist the publication-policy variant independently from `collectionScope`; legacy managed records default to `managed_categories`.

- [ ] **1. Write policy regressions.** Cover a duplicate unclaimed profile pointing at a managed-private group, managed analytics off, disconnected groups, group-level stop with retained member snapshots, suppressed profiles and link replacement. Seed private locations, world IDs, internal session IDs and named records and assert they never occur in automatic JSON.

  ```ts
  assert.equal(duplicatePublicProfile.telemetry, undefined);
  assert.equal(stoppedPublicProfile.groupMembership, undefined);
  assert.equal(automatic.publicationPolicy, "automatic_aggregate");
  for (const forbidden of [privateLocation, worldId, sessionId, userId, displayName])
    assert.equal(JSON.stringify(automatic).includes(forbidden), false);
  ```

- [ ] **2. Run RED:** the new backend file with `--test-name-pattern="public policy|duplicate privacy|projection"`.
- [ ] **3. Implement the resolver and both projections.** Managed group privacy is authoritative across duplicate profiles. Preserve existing profile-publication and category checks in both public profile paths. Automatic history reads use canonical integration identity, not the contributing profile's identity. Do not enable broader categories as a shortcut.
- [ ] **4. Run GREEN:** focused new tests plus `node --conditions=import --import tsx --test tests/backend/public-group-membership.test.ts tests/backend/community-telemetry-review-regressions.test.ts`, then backend typecheck.
- [ ] **5. Commit:** `feat(telemetry): project safe automatic group aggregates`.

## Task 3: Queue eligible groups and coordinate member sampling

**Files:** Create `convex/groupObservations.ts`; modify `schema.ts`, `_externalControl.ts`, `_profileUpdates.ts`, `_profileSubmissions.ts`, `profilePrivacy.ts`, `profileArchival.ts`, `crons.ts`, `communityTelemetry.ts`, `groupMemberSnapshots.ts`, `workers/group-telemetry/group-member-jobs.mjs`; extend `automatic-group-statistics.test.ts`, `group-member-snapshots.test.ts`, `group-member-jobs.test.mjs`.

**Interfaces:**

- Internal `groupObservations.reconcileProfile({ profileId, affectedGroupIds, now? })` registers/rechecks current primary group references and retires orphan automatic assignments. Central link create/remove/promote helpers capture both old and new immutable group IDs before changing the link and schedule this function. Publication, suppression and deletion writers capture affected IDs before removing the profile. A bounded reconciliation cron covers missed/legacy rows. Reference checks use paginated indexed group-link queries; a truncated page cannot prove that no eligible references remain.
- Internal `groupObservations.admitQueued({ now? })` processes at most 50 due candidates per call, prioritizes managed admissions, and allocates only current healthy headroom. It returns counts of admitted, deferred and admission-required groups, not provider records. Allocation and canonical integration creation are one transaction.
- Attribute new candidates to the authenticated contributor captured by the source mutation, never a caller-supplied user ID. System backfill has its own bounded global admission and does not consume an arbitrary contributor's quota.
- Add fleet fields `automaticEnrollmentEnabled` default false, `automaticEnrollmentLimit` default zero and `automaticEnrollmentScope` as either `{ kind: "pilot", vrchatGroupId }` or `{ kind: "all_eligible" }`. A missing scope admits nothing. A future authorized pilot uses limit one and the exact approved group ID. Existing assignment capacity and reserved headroom are unchanged. A separate contributor candidate counter enforces five new groups per rolling 24 hours with a privileged audited override; use existing rate-limit storage/patterns.
- Member sampling and aggregate ingest both use existing `recordGroupMemberObservation`. The daily sampler skips a healthy active aggregate assignment only while its successful observation is within six minutes. Otherwise it can sample metadata, unless group stop/managed privacy prohibits it.

- [ ] **1. Write enrollment regressions.** Concurrent duplicate links allocate one assignment; repeat saves spend no quota; six distinct candidates hit the five-group contributor limit; full capacity queues without evicting; managed queue entries win only the next available slot. Orphan cleanup must wait for all eligible links and managed dependencies. A removed primary link followed by a stale queued job cannot re-enroll.

  ```ts
  assert.equal(assignmentsForGroup.length, 1);
  assert.equal(accountAfter.assignedGroupCount - accountBefore.assignedGroupCount, 1);
  assert.equal(sixthNewCandidate.reason, "contributor_limit");
  assert.equal(fullCapacityResult.state, "queued");
  assert.equal(await memberSamplerClaims(stoppedGroupId), 0);
  ```

- [ ] **2. Run RED:** new tests with `--test-name-pattern="enrollment|candidate limit|member sampler|orphan"`, plus the existing group-member snapshot suite.
- [ ] **3. Implement queue and hooks.** Use immutable group IDs; unverified contributors never set join policy or group privacy. An allocated automatic assignment may read provider metadata for eligibility, but must not join until Task 4 confirms public/free-join. Admission-required/invalid targets release unused account capacity and do not loop allocation. Keep public member metadata usable when no bot slot exists, subject to the shared policy. Reconcile cleanup with any managed dependency before leaving.
- [ ] **4. Run GREEN:** repeat focused backend tests and `node --test workers/group-telemetry/group-member-jobs.test.mjs`; confirm admission flags remain false/zero in fixtures unless explicitly enabled.
- [ ] **5. Commit:** `feat(telemetry): queue bounded automatic group enrollment`.

## Task 4: Enforce aggregate-only workers and server operations

**Files:** `worker.mjs`, `vrchat-client.mjs`, `runtime.mjs`, `convex/_communityTelemetry.ts`, `convex/_claimObservability.ts`, `communityTelemetry.ts`, `http.ts`, `clubMembership.ts`, `clubOperations.ts`, `clubProviderReads.ts`; extend existing worker/HTTP tests and create `workers/group-telemetry/automatic-group-collection.test.mjs`.

**Interfaces:**

- Automatic assignments carry `collectionMode: "automatic"`, the canonical integration/group/epoch and fencing token, never managing authority or named feature flags. Managed assignments carry the existing managed fields.
- Advertise capability `automatic_group_aggregates_v1`. Add the claiming worker's capabilities to the claim request and `claimDueAssignments` arguments; absent capabilities allow managed work only. Dispatch automatic work only when the current request and fresh heartbeat for that exact worker/account agree on the new capability. Another worker's account-level capability record is insufficient. Update `_claimObservability.ts`'s capability validator and deployment-readiness checks alongside runtime metadata.
- `VrchatClient.connectGroup(groupId, { admissionMode: "automatic" | "managed" })` defaults existing callers to managed behavior. Automatic mode checks fresh provider group visibility/join policy before any join, permits only public/free-join groups and confirms membership after joining. Existing invited/requested membership does not make an otherwise restricted group automatically eligible.
- `assertAutomaticOperationAllowed({ collectionMode, operation })` is enforced by the control plane and underlying mutations. Allowed target operations are budgeted metadata/admission, aggregate reads/ingest, heartbeat, membership result, failure, defer, lease release and leave cleanup. Proof/destination jobs remain separate account jobs and cannot inherit target authority.

- [ ] **1. Write worker and HTTP regressions.** A fake provider throws if roster, member audit, authority, club-read, readiness or management methods run for an automatic assignment. Include request/invite/unknown/private groups, lost membership after prior success, direct forged membership scans, a stale legacy worker claim and a stale fencing token after stop.

  ```js
  assert.deepEqual(namedAndManagementCalls, []);
  assert.equal(joinCallsForRequestGroup, 0);
  assert.equal(oldWorkerAutomaticClaims.length, 0);
  assert.equal(forgedMembershipScan.status, 403);
  assert.equal(stoppedPollAccepted, false);
  ```

- [ ] **2. Run RED:** `node --test workers/group-telemetry/automatic-group-collection.test.mjs`; run focused backend operation-denial tests and the existing `group-member-http.test.ts` suite.
- [ ] **3. Implement a distinct automatic branch before all worker management phases.** It must skip `checkClubOperations`, `checkClubReads`, readiness/authority refresh and `collectMembershipPage`. Validate mode again in named ingestion and management mutations, not only the HTTP router. A removal/kick or ambiguous loss after confirmed membership persists stop and fences pending requests; do not call join again or switch bot accounts. Preserve managed behavior and existing 401/429/backoff handling.
- [ ] **4. Run GREEN:** focused tests, `pnpm test:group-telemetry`, `pnpm typecheck:backend`, and existing club-operation/provider-read/membership backend suites. Verify real HTTP handlers reject automatic named-data writes even with an otherwise valid worker key.
- [ ] **5. Commit:** `feat(telemetry): isolate automatic aggregate collection`.

## Task 5: Verify adoption, opt-out and resume

**Files:** `groupObservations.ts`, `_groupObservationPolicy.ts`, `communityTelemetry.ts`, `profileConnections.ts`, `_externalControl.ts`, `clubConnection.ts`, `clubStaff.ts`, `groupMemberSnapshots.ts`, `apps/web/src/app/account/communities/[slug]/club-connection.tsx`; extend new backend tests, existing connection/staff/member suites and `apps/web/e2e/club-connection.storybook.spec.ts`.

**Interfaces:**

- Public authenticated mutation `groupObservations.setObservationDecision({ vrchatGroupId, decision: "stop" | "resume", republishRetainedHistory? })` requires an active existing external-control proof of at least manager for that exact group, or the existing audited VRDex moderation authority. Use `requireControlProof` and existing subject resolution; do not invent a new moderator role or trust a profile claim alone. Only resume accepts `republishRetainedHistory`; it defaults false and advances `publicHistoryStartAt` to now. Only an explicit true from the verified operator permits earlier retained history. Every history and membership projection honors that lower bound.
- Internal audited moderation pause uses the same persistent group decision. Stop suppresses public results and fences work immediately, then queues membership cleanup. Resume requires a fresh authorization check and does not republish previously suppressed history automatically.
- Extend existing `connectGroup` adoption: reuse the canonical automatic integration, account, epoch and observations after verified group-control checks. Record `publicationPolicy: "automatic_aggregate"` until the operator explicitly saves managed publication settings; adoption enables no named or management feature. Existing managed records use `managed_categories` unchanged.

- [ ] **1. Write transition regressions.** Wrong-group proof and unverified profile owners are denied. Adoption keeps the integration ID, account allocation, epoch and history. Stop racing with aggregate/member completion prevents both writes from restoring public results. Duplicate links cannot resume a stopped group. Resume omits pre-stop history unless the verified operator explicitly chooses to republish it. Existing managed analytics-off remains off.

  ```ts
  assert.equal(afterAdoption._id, beforeAdoption._id);
  assert.equal(afterAdoption.telemetryEpochStartedAt, beforeAdoption.telemetryEpochStartedAt);
  assert.equal(afterAdoption.publicationPolicy, "automatic_aggregate");
  assert.deepEqual(enabledNamedFeaturesAfterAdoption, []);
  assert.equal(await publicMemberCountAfterLateCompletion(), undefined);
  ```

- [ ] **2. Run RED:** new backend tests with `--test-name-pattern="adoption|stop race|resume|group proof"`.
- [ ] **3. Implement authorized transitions and reconciliation.** Preserve safe automatic history during adoption; apply authoritative managed privacy to every duplicate profile. Stopping observation must not silently disable unrelated explicitly configured group-management features; leave cleanup waits for their managed dependency to be resolved. Revoked claims never reset group policy. Route operator controls through existing Connection settings, using existing labels where possible; any new explanatory wording goes into the release packet for BASIC's review.
- [ ] **4. Run GREEN:** focused tests plus `club-connection.test.ts`, `club-staff.test.ts`, `public-group-membership.test.ts` and `group-member-snapshots.test.ts`. Check that no profile ownership/staff record was created by automatic enrollment. Extend the existing Connection story to exercise verified stop/resume, denied wrong-group proof, preserved publication on adoption and explicit retained-history choice; run its Storybook browser spec and inspect desktop/mobile output before calling the controls complete.
- [ ] **5. Commit:** `feat(telemetry): add verified group observation controls`.

## Task 6: Deliver bounded graph data across public protocols

**Files:** `_communityTelemetryPublic.ts`, `communityTelemetry.ts`, `profiles.ts`, new `convex/_groupPopulationSeries.ts`, `packages/api-contracts/src/schemas.ts`, `openapi.ts`, `apps/web/src/lib/server/api-v0.ts`, `vrdex-mcp.ts`, `packages/vrdex-mcp/src/api-client.ts`, `server.ts`; generated OpenAPI and Convex outputs through existing generators. Extend contract, backend, hosted MCP and stdio tests.

**Interfaces:**

- Export `buildGroupPopulationSeries({ observations, coverageWindows, startAt, endAt }): PopulationSeries` in `_groupPopulationSeries.ts`. Derive `PopulationSeries` from exported `PublicGroupPopulationSeriesSchema` in API contracts. Exact series fields are `startAt`, `endAt`, `coverageRatio`, `peakConcurrency`, `playerHours` and `buckets`. Each bucket has `startAt`, `endAt`, optional `populationMin`, `populationMax`, `populationLast`, `instanceCountMin`, `instanceCountMax`, `instanceCountLast`, `observedAt` and an array `observedSpans` of `{ startAt, endAt, points }`. Each point contains only `observedAt`, `population` and `instanceCount`. Within each span retain the first/last and population/instance extrema samples, deduplicated in time order. Return at most 720 ordered buckets. Missing buckets omit all count/observation values and have no spans. A bucket spanning an explicit gap cannot connect its spans or use a later span's count in an earlier one.
- Extend `getPublicCommunityTelemetry(db, profileId, now, range?)` with an optional `{ startAt, endAt }` range. Default to the last 24 hours; reject non-integer, future-ended, inverted or longer-than-24-hour explicit ranges. Existing longer-range hour/day rollups remain available. Fetch observations using indexed bounded pagination with a 5,000-row read ceiling and reject rather than silently truncate if exceeded. Include predecessor/successor samples only for bounded window integration, never as in-window observed peaks.
- Add paired optional `statisticsStartAt` and `statisticsEndAt` to `profiles.getPublicBySlug`, REST profile GET query parameters, hosted `vrdex_get_profile`, stdio tool input and `apiClient.getProfile`. Use one exported `PublicStatisticsRangeInputSchema` and refinement requiring both or neither. Do not create another telemetry API or tool name.
- Add `PublicAutomaticGroupStatisticsSchema` as a strict safe variant of public telemetry. Reuse the current managed telemetry schema as the other variant. Automatic rollups omit world distribution and session/event details entirely. Safe range output, field permissions and rejection behavior match every protocol. Keep default person-profile reads unchanged and reject statistics ranges for persons.

- [ ] **1. Write series and contract regressions.** Seed a narrow peak, explicit and silent gaps, a successful empty poll, stale current data, negative growth and two groups relinked through one profile. Use a 25-hour DST calendar day expressed as an invalid explicit elapsed range and a valid 24-hour elapsed range. Include a group with more than 5,000 in-range observations to prove rejection rather than truncated statistics.

  ```ts
  assert.ok(series.buckets.length <= 720);
  assert.equal(seriesPeak, observedPeak);
  assert.equal(gapBucket.populationLast, undefined);
  assert.equal(emptyPollBucket.populationLast, 0);
  assert.equal(staleTelemetry.currentPopulation, undefined);
  assert.deepEqual(restAutomatic, hostedMcpAutomatic);
  assert.deepEqual(hostedMcpAutomatic, stdioAutomatic);
  ```

- [ ] **2. Run RED:** backend tests matching `series|range|protocol parity`, `pnpm test:api-contracts`, and targeted hosted/stdio profile-read tests.
- [ ] **3. Implement the reducer, range validation and serializers.** Segment coverage before bucket reduction, integrate only adjacent observations within five minutes, and derive peaks from observed timestamps. Reuse current rollup integration helpers where possible. Update REST rate-limit/caching keys to include the range and shared group policy; prevent a pre-opt-out cached response from remaining public through existing invalidation/no-store behavior. Make schema descriptions truthful for both managed and automatic data.
- [ ] **4. Run GREEN:** `pnpm verify:api-contracts`, `pnpm test:vrdex-mcp`, `pnpm typecheck:vrdex-mcp`, focused backend tests and hosted profile-read tests. Generate OpenAPI with `pnpm generate:api-openapi`; regenerate local Convex types with the existing local backend workflow, then run `pnpm check:backend:generated`.
- [ ] **5. Commit:** `feat(telemetry): expose bounded safe population history`.

## Task 7: Add the night graph to the existing community page

**Files:** `profile-public-page.tsx`, create `public-group-population-chart.tsx`, create `apps/web/src/lib/public-group-statistics.ts`, existing public profile types, `apps/web/src/app/playwright/community-telemetry/page.tsx`; create `tests/web/public-group-statistics.test.ts` and `apps/web/e2e/automatic-group-statistics.fixture.spec.ts`.

**Interfaces:**

- `PublicGroupPopulationChart({ series, range, onRangeChange })` consumes only Task 6's safe `PopulationSeries`. It has no access to sessions, world identifiers, provider locations or private queries. Reuse installed Recharts and current theme/date controls.
- The existing `CommunityActivity` chooses the safe variant and renders observed population/instance totals and the chart. The current group-size chart remains reusable. Render successful zeros; do not use a numeric truthiness test to hide them.
- Range selection updates the current public profile request with the paired Task 6 arguments. Use omitted range arguments for the current last-24-hours view so client clock skew cannot create a future-ended request. Local labels use the viewer's timezone; historical requests use exact epoch endpoints. Preserve the existing page/claim flow and appearance controls. No new navigation or authentication step.

- [ ] **1. Write model and mounted-browser cases.** Test 720 buckets, separate spans in the same bucket, stale transitions, a real zero, local date boundaries, pointer/keyboard tooltip timestamps and a private-location sentinel injected into server fixtures. Assert public DOM, network JSON, links and browser history contain no private sentinel or user identifier.

  ```ts
  assert.equal(model.currentPopulation, 0);
  assert.equal(model.connectsAcrossGap, false);
  await expect(page.getByRole("img", { name: /population/i })).toBeVisible();
  expect(serializedBrowserEvidence).not.toContain(privateLocationSentinel);
  ```

- [ ] **2. Run RED:** `node --import tsx --test tests/web/public-group-statistics.test.ts`; run the new fixture spec through the existing local Playwright setup.
- [ ] **3. Implement the chart and range wiring.** Show population and instance counts with explicit units, actual observation times on hover, visible gaps and keyboard-accessible equivalents. Use existing utility labels; gather any necessary new public prose for exact-copy review rather than inventing release approval.
- [ ] **4. Run GREEN:** repeat model tests; run `pnpm --filter web exec playwright test automatic-group-statistics.fixture.spec.ts --project=desktop-chromium --project=mobile-chromium`, `pnpm typecheck:web` and `pnpm lint:web`. Inspect screenshots at ordinary desktop and mobile widths, including the empty/stale/gap cases. Screenshots alone do not prove payload privacy, so retain the network/DOM assertions.
- [ ] **5. Commit:** `feat(web): show safe group population history`.

## Task 8: Integrate source and prepare a gated release

**Files:** Public/backend/deployment telemetry docs, worker README, approved spec cross-links and tests. Modify `infra/terraform/group-telemetry-collector/main.tf` and `variables.tf` only if the existing alarms cannot detect a sustained enrollment/capacity failure. No Terraform apply or live group action belongs to source validation.

**Interfaces:** Existing collector deployment/readiness and migration runners. No additional public API. Record the exact release SHA, required worker capability and admission flag values in the deployment runbook.

- [ ] **1. Add mixed-version and rollback regressions** to `tests/scripts/group-telemetry-worker.test.ts`, `tests/scripts/group-telemetry-deployment.test.ts` and the automatic backend suite. Old workers cannot claim automatic assignments. Turning off automatic admission stops new joins; it does not reopen opt-outs or change managed settings. Cleanup retains existing group stops and history.
- [ ] **2. Run the focused tests before implementation**, then add the minimal readiness/configuration/runbook changes and rerun them. The source runbook must give the following release order:

  1. Deploy backward-compatible schema/control plane with admission false and limit zero, only after release authorization.
  2. Run the approved paged managed-record migration and inspect conflicts. Do not continue if conflicting active group bindings remain.
  3. Deploy capability-advertising workers, verify exact SHA and readiness, then deploy public contracts/web. No automatic target is dispatched to old workers.
  4. Verify the existing actionable alarm email path to `basic@basicbit.net`. If an additional backlog alarm is required, include its email action in the same reviewed infrastructure change.
  5. Obtain the exact approved free-join pilot group, set admission limit one and enable only that group's enrollment. Verify actual admission, non-empty aggregate collection, public web/REST/hosted MCP/stdio parity, opt-out and cleanup. Homie Hub is not pre-approved by this plan.
  6. Expand the bounded backfill only after separate activation authorization. No account creation, fleet expansion, quota increase or provider-policy change is implied.
  7. Rollback admission first, fence affected automatic leases, suppress automatic output if needed and clean up memberships. Retain canonical policies/history. Do not restore old worker dispatch or remove schema fields while automatic records remain.
- [ ] **3. Run final source checks once after integration:** `pnpm typecheck:backend`, `pnpm test:backend`, `pnpm test:group-telemetry`, `pnpm verify:api-contracts`, `pnpm typecheck:vrdex-mcp`, `pnpm test:vrdex-mcp`, `pnpm typecheck:web`, `pnpm test:web`, `pnpm lint:web`, the Task 7 Playwright spec, and `pnpm verify:docs`. Run affected script tests for capability/deployment changes. Broaden only for a new failure or unresolved concern.
- [ ] **4. Review the entire branch** for named-data collection, private output, managed regressions and migration safety. Compare implementation against every spec section and this plan's Review Focus. Preserve the exact public copy needing BASIC's review. Push the current implementation head and follow the existing PR review and 30-minute exact-head readiness procedure if asked to iterate a PR to merge-ready. Merge and deployment remain separate authorizations.
- [ ] **5. Commit:** `docs(telemetry): document automatic statistics rollout and proof`.

## Coverage and planning self-review

| Approved requirement | Owning task |
| --- | --- |
| Automatic enrollment, quota, fair queue, no account expansion | 1, 3, 4 |
| Canonical group identity and duplicate references | 1, 2, 3 |
| Public/free-join admission, restricted admission wait, no in-world bot | 3, 4 |
| Members-only aggregate counts, no named records or private links | 2, 4, 6, 7 |
| Stop includes daily metadata sampler, late writes and all public reads | 2, 3, 5 |
| Existing managed settings and group-wide privacy precedence | 1, 2, 5 |
| Adoption preserves history and safe publication; no feature escalation | 5 |
| Six-minute freshness, five-minute gaps, observed zeros, peaks/player-hours | 2, 6, 7 |
| Bounded night series and longer hour/day histories | 6, 7 |
| REST, hosted MCP, stdio, exports and website use one safe result | 2, 6, 7 |
| Permanent retention, separate deletion, no suppressed-history revival | 1, 5, 8 |
| Actual pilot, actionable alarm, rollout and rollback | 8 |
| Queue statistics and automatic official event attribution remain absent | 2, 6; existing managed recap behavior unchanged |

The plan was checked for spec coverage, step granularity, consistent interface names, failure-focused tests and proportion. No new independent subsystem is required. All code bodies remain implementation work; this document fixes the interfaces and acceptance checks.

## Evidence appendix

- Source inspected at `f6b0b95ef8e51e941951533034b8a8216151fd3e`; approved design branch contained `c243f01f6` before recording full approval. Reconcile with current main before execution, especially the separate person-proof work.
- Commands and test paths above were checked against repository scripts and source. No implementation tests or browser/provider experiments were run while writing this plan.
- The current main worker calls management phases and `collectMembershipPage` around aggregate polling. An analytics feature flag alone is insufficient isolation.
- `getPublicGroupMembership` reads group-keyed snapshots independently from integration telemetry. Both must honor group policy.
- Existing public profile reads are `profiles.getPublicBySlug`; both hosted and stdio MCP already expose `vrdex_get_profile`. The plan extends those reads instead of adding a parallel API.
- Existing migration runner uses batches of 50. Existing group rollups include world distributions, so automatic DTOs must be constructed separately rather than returning raw rollups.
