# Statistics accuracy implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Correct boundary integration, recorded-outage handling, and quiet-cadence coverage across community statistics, with a resumable historical rebuild.

**Architecture:** Reuse the existing pure analytics module for interval eligibility and integration. Backend readers supply bounded adjacent observations and outage metadata; existing adapters keep their response shapes and estimated-sample eligibility. Update persisted rollups in place, with version-fenced recap jobs and a separate dry-run/rebuild workflow.

**Tech stack:** TypeScript, Convex, Next.js/React, the installed `@convex-dev/migrations` component, Node test runner and existing browser tests. No new dependency.

**Spec:** [Approved design](../specs/2026-11-02-statistics-accuracy-design.md).

## Global constraints

- Ranges are half-open: `[startAt, endAt)`.
- Population continuity is at most 360,000 ms, inclusive. Do not change provider polling cadence, membership continuity, or current-value freshness.
- Any recorded degraded/unknown/stale window overlapping a pair's open interval rejects that entire pair. Never interpolate a tail without a real endpoint.
- Retain integration/epoch boundaries, category access checks, publication settings, raw observations, provider timestamps, and PR 414 collector behavior.
- Preserve each adapter's existing estimated-sample eligibility and missing-result representation. Peak uses actual in-range eligible observations.
- Calculation version is `community-telemetry-v2`, separate from the collector version.
- Interactive reads remain bounded and report incomplete/error on exhaustion; background work continues through pages. Existing migration batch size is 50.
- Production deployment and rebuild execution are separate approvals. A queued recap is not a completed repair.
- No new public prose or UI redesign. Add `ci:browsers` and `ci:visuals` before the normal PR run because chart gap logic changes.

## Review focus

1. Outage evidence starts before a requested page or range: it must still block a bridge. Covered in Tasks 1 and 2.
2. A first point on a new page loses `breakBefore`: totals and chart gaps must survive pagination. Covered in Tasks 1 and 2.
3. Missing or over-limit coverage input looks like an empty successful result: reject or mark incomplete. Covered in Task 2.
4. Old recap continuation races a corrected job: it must not overwrite v2 output or duplicate a recap. Covered in Task 3.
5. Repair enumeration finishes before asynchronous recaps: report pending until the v2 target exists and its job has finished. Covered in Task 4.

## File map

| Responsibility | Files |
| --- | --- |
| Pure interval math | `convex/_clubAnalyticsMath.ts`, `_communityTelemetry.ts`, `_groupPopulationSeries.ts` |
| Coverage projection and readers | `convex/_collectionCoverage.ts`, `clubAnalytics.ts`, `_communityTelemetryPublic.ts` |
| Rollup and recap calculation | `convex/communityTelemetry.ts`, `_groupObservationPolicy.ts`, `schema.ts` |
| Browser gaps | `apps/web/src/app/account/communities/[slug]/club-instances.tsx` and its existing chart consumers |
| Repair orchestration | `convex/migrations.ts`, `schema.ts`, new `convex/communityTelemetryRepair.ts`, new `scripts/repair-community-statistics.mjs` |
| Tests | Existing backend analytics/telemetry tests; new `tests/backend/community-telemetry-repair.test.ts`, `tests/scripts/community-statistics-repair.test.ts`; applicable web chart-model tests and browser fixture |
| Documentation | `docs/backend/community-group-telemetry.md`, `docs/public/community-telemetry.md`, `docs/deployment/group-telemetry-collector.md` |

New repair files hold operator orchestration, not another calculation engine. All changed generated contracts come from normal Convex code generation.

## Task 1: Establish one interval rule

**Files:** Modify the pure-math files above. Test in `tests/backend/club-instance-summary.test.ts` and `tests/backend/group-population-series.test.ts`.

**Interfaces produced in `_clubAnalyticsMath.ts`:**

```ts
type SeriesPoint = { at: number; value: number; coverage: string; breakBefore?: boolean };
type PopulationEndpoint = Pick<SeriesPoint, 'at' | 'value' | 'breakBefore'> & { eligible: boolean };
type PopulationGap = { startAt: number; endAt: number };
const MAX_OBSERVED_GAP_MS = 360_000;
function integratePopulationPair(input: {
  from: PopulationEndpoint; to: PopulationEndpoint; startAt: number; endAt: number;
}): { area: number; duration: number } | null;
function markPopulationBreaks(points: SeriesPoint[], gaps: PopulationGap[]): SeriesPoint[];
```

`area` is population multiplied by milliseconds; `duration` is milliseconds. Adapters explicitly decide eligibility, so estimated points retain their current behavior. Existing summary and segment function signatures remain valid. `_communityTelemetry.ts` exports its existing gap constant as an alias to this pure constant, without creating an import cycle.

- [ ] Add failing tests for the exact assertions below, using the existing test fixtures:

```ts
assert.equal(summarizeSeries(hourPointsWithAdjacentSamples, 0, 3_600_000).playerHours, 10);
assert.equal(summaryWith301SecondEmptyPair.coverageRatio, 1);
assert.equal(summaryWith301SecondEmptyPair.playerHours, 0);
assert.equal(summaryWith360000MsPair.coverageRatio, 1);
assert.equal(summaryWith360001MsPair.coverageRatio, 0);
assert.equal(summaryWithOutageMarkedSecondEndpoint.coverageRatio, 0);
assert.deepEqual(mergeSeriesSegments(onePointPages, startAt, endAt), wholeSummary);
```

Also pin 359,999 ms, no/single samples, decreasing/equal timestamps, duplicate points, finite nonnegative values, clipped endpoints with no invented peak, exact outage endpoints, and existing estimated behavior. Add a nonuniform population case proving adjacent-bucket areas and durations sum to the whole interval within `1e-9` relative tolerance.

- [ ] Run `node --conditions=import --import tsx --test tests/backend/club-instance-summary.test.ts tests/backend/group-population-series.test.ts`. Confirm new assertions fail for the intended reasons.
- [ ] Implement the interfaces and migrate `summarizeSeries`, segment bridging, `computePopulationMetrics`, and public-series integration to the shared pair function. Remove independent trapezoid/gap logic. Preserve world accounting and chart reduction. Do not filter away adjacent samples before clipped integration.
- [ ] Rerun the same command. Require zero failures, then commit the focused math change.

## Task 2: Supply boundary samples and outage breaks to every reader

**Files:** Coverage/read adapters and browser gap files from the file map; relevant tests in `club-analytics.test.ts`, `club-instance-summary.test.ts`, public telemetry tests, and `tests/web/club-analytics-model.test.ts`.

**Interfaces consumed:** Task 1's `SeriesPoint`, `PopulationGap`, `markPopulationBreaks` and gap constant.

**Interface produced in `_collectionCoverage.ts`:**

```ts
function readPopulationGaps(ctx: QueryCtx | MutationCtx, input: {
  integrationId: Id<'communityVrchatIntegrations'>;
  epochStartedAt: number; startAt: number; endAt: number;
}): Promise<{ complete: true; gaps: PopulationGap[] } | { complete: false }>;
```

Use an indexed predecessor plus at most 1,001 in-range windows to enforce a 1,000-window interactive limit. Merge overlapping gaps after clipping to the endpoint span. Legacy missing windows add no inferred proof. Queries with a `complete` field return incomplete/no summary; other queries throw a structured range-limit error rather than return partial successful data.

- [ ] Add query tests asserting ten player-hours for a one-hour bucket with samples immediately outside both edges; no bridge over an outage beginning before the range; an exact-end sample supports area but not the observed peak; and no cross-epoch sample is admitted. Repeat with population/instance pages of size one and normal sizes.
- [ ] Add tests asserting over-limit coverage produces incomplete/error, a first point on page two retains `breakBefore: true`, and a denied category still cannot read points or gap reasons. Test an interval with an observed zero and a distinct interval with missing data.
- [ ] Run `node --conditions=import --import tsx --test tests/backend/club-analytics.test.ts tests/backend/club-instance-summary.test.ts tests/backend/group-population-series.test.ts` and confirm the new cases fail.
- [ ] Implement the coverage projection. Update `getBucket`, `getSeries`, `getInstanceSeries`, `getInstanceSummaryPage`, public population-series reads, and the legacy dashboard summary. Use one real predecessor and successor within 360,000 ms; annotate each page using its real predecessor. Extend the point validators with optional `breakBefore`. Mark an epoch boundary explicitly; preserve the original observations and their timestamps.
- [ ] Move the already-used pure `observedChartPoints(points: SeriesPoint[]): ClubChartPoint[]` mapper into the existing `club-analytics-model.ts` and keep its callers importing the same function. Insert a null-valued visual break when `breakBefore` is set, as well as for intervals beyond the shared gap constant. Test in `tests/web/club-analytics-model.test.ts`; assert that no population-zero point is synthesized by the break.
- [ ] Rerun the focused backend command and `node --import tsx --test tests/web/club-analytics-model.test.ts`; require zero failures. Verify current-value, membership and collector tests remain unchanged, then commit the reader/browser change.

## Task 3: Correct persisted rollups and fence event jobs

**Files:** `convex/communityTelemetry.ts`, `_groupObservationPolicy.ts`, `schema.ts`; tests in `tests/backend/community-telemetry.test.ts` and `community-telemetry-review-regressions.test.ts`.

**Interfaces consumed:** Shared pair rule and bounded coverage reader. Existing `recomputeRollup` and `continueEventRecapJob` references remain the entry points.

**Contract produced:** Every successful persisted recomputation stamps `community-telemetry-v2` and updates exactly one stable bucket identity in place. Recap jobs add optional `calculationVersion` for schema compatibility. Existing absent-version jobs restart under v2; stale continuations cannot publish.

- [ ] Add integration tests asserting a full-hour ten-person rollup has `playerMinutes === 600`, `coverageRatio === 1`, and the same row ID after two recomputations. Assert a preexisting v1 event recap is updated in place with no extra visible row.
- [ ] Add recap tests for simultaneous associated sessions, per-session adjacent samples, outage breaks crossing a page boundary, empty association-filtered pages, no extrapolated final zero, event edits/removal, and a legacy continuation arriving after v2 completion. Assert one-point pagination equals a whole-input reference result.
- [ ] Run `node --conditions=import --import tsx --test tests/backend/community-telemetry.test.ts tests/backend/community-telemetry-review-regressions.test.ts`; confirm new regressions fail.
- [ ] Update hourly/day input reads and streaming event aggregation to include bounded adjacent samples and pass all eligible pairs through Task 1's rule. Read coverage across the carried previous endpoint. Keep one pending aggregate per snapshot time and preserve it across pages. Use indexed per-state barrier-existence probes for background intervals so coverage-window volume does not inherit the interactive cap. Continue paging observation input and never commit a partially read summary.
- [ ] Find existing event rows independently of calculation version while respecting integration/legacy mapping. Reject ambiguous identities rather than delete or duplicate them. Version-fence job writes and preserve existing schedule/association revalidation. Change the calculation version only after all consumers use the corrected rules.
- [ ] Rerun the focused telemetry command and the Task 2 tests. Require zero failures, then commit the persisted-calculation change.

## Task 4: Add a dry run and resumable historical repair

**Files:** `convex/communityTelemetryRepair.ts`, `convex/migrations.ts`, `convex/schema.ts`, `scripts/repair-community-statistics.mjs`, their new tests and telemetry docs from the file map.

**Interfaces:** Expose internal-only inventory/dry-run queries with indexed pagination, and a migration runner named `runRepairCommunityStatisticsV2` over persisted approved repair targets. Keep calculations in the shared implementation. The operator script accepts `--target`, `--integration`, `--start`, `--end`, `--mode inventory|dry-run|status|apply`, and `--inventory` for the reviewed manifest; `apply` requires that manifest and cannot widen it. Use `scripts/convex-target.ts` for exact deployment selection. Never print credentials or raw provider payloads.

Inventory records the fixed integration/range/version, bucket identity and mapping status. Dry-run results include previous/proposed numeric values and completeness. Stream large event input pages without mutating published rollups. Completion status distinguishes inventoried, blocked, pending, corrected and failed. For a queued event, require both a matching v2 target and no pending/failed recap job before reporting corrected.

The installed migration runner does not accept arbitrary per-run integration/range parameters. Materialize the approved manifest into `communityTelemetryRepairRuns` and indexed `communityTelemetryRepairTargets` only on apply, then migrate that target table in batches of 50. Runs hold immutable scope/version and state; targets hold run ID, stable bucket identity, optional existing rollup/job ID and status/error. Enforce one active run for this calculation version. Every worker validates the target against its run and skips completed targets. This prevents the canary from becoming an unscoped migration over all published statistics. Local inventory/dry-run operations do not create these rows.

- [ ] Add tests asserting dry run leaves raw observations and published rollups byte-for-byte unchanged, ambiguous mapping is blocked, missing raw input is reported, and the target/range cannot widen between dry run and apply.
- [ ] Add tests asserting default migration batch size 50, interrupted/resumed execution does not duplicate rows, repeat apply is idempotent, concurrent cron recomputation produces one stable target, and queued-but-unfinished recap work remains pending. Verify current visibility/epoch settings and raw observations never change.
- [ ] Run `node --conditions=import --import tsx --test tests/backend/community-telemetry-repair.test.ts` and `node --import tsx --test tests/scripts/community-statistics-repair.test.ts`; confirm new cases fail before implementation.
- [ ] Implement the bounded internal orchestration using the installed migration runner, the two repair-state tables, and existing recomputation/job entry points. Inventory already-confirmed recaps missing a persisted row using the confirmed-association index and the same stable identity. Keep raw calculation state in the existing recap jobs. Do not add this targeted repair automatically to `runAll` or startup.
- [ ] Update the backend/public/deployment docs together. Explain six-minute inference, explicit outage breaks, observed peaks, gradual v1/v2 correction, bounded dry run, target identity checks, canary/status commands, and replay-based rollback. State that missing old guests remain unrecoverable from these calculations.
- [ ] Rerun both commands and the complete Task 3 test set. Require zero failures, then commit repair tooling and docs.

## Task 5: Validate and prepare delivery

- [ ] Run `pnpm typecheck:backend`, `pnpm typecheck:web`, `pnpm test:backend`, and `pnpm test:web`. Classify platform-only failures separately and do not claim them fixed. Run collector tests once to confirm no PR 414 regression.
- [ ] Add a browser regression to the existing club analytics fixture for an explicit outage between nearby observations. Run the repository's browser/visual checks with `ci:browsers` and `ci:visuals`. Visually confirm a chart gap and matching private/public observed-only totals; no new copy or layout is required.
- [ ] Freshly review the branch against the approved spec. Confirm every integration loop now uses the shared pair function, all five-minute boundary reads/chart literals were migrated where relevant, and membership/poll scheduling constants were preserved.
- [ ] Commit/push final changes and create the PR with the problem, behavior and relevant validation. Follow repo review rules and the exact-head 30-minute completion window if tasked with making it merge-ready. Do not merge or deploy under this planning approval.
- [ ] Prepare the production dry-run command and exact targets for BASIC's execution approval. Canary BITRATE and Faceless, compare corrected persisted/raw/UI results, then request expansion only after those checks pass. No production dry run, apply or deployment runs as part of the implementation tests above.

## Self-review and execution choice

Spec coverage maps to Tasks 1 through 5, including boundary samples, whole-pair outage rejection, 360,000 ms tolerance, estimated eligibility, pagination, version fencing, historical repair, permissions and runtime evidence. The five review-focus cases have tests in their owning tasks. Interfaces above are the shared contracts; implementation may choose internal helper names not exposed across tasks.

Recommendation: native execution in this session, in task order, followed by one independent whole-branch review. These tasks share interfaces and have little benefit from concurrent file edits. A subagent-driven sequence remains available if BASIC prefers a separate implementer/reviewer per task. The plan requires human review before implementation under the writing-plans workflow.

## Execution rulings

- Native PowerShell maintains the ledger because the Bash bookkeeping helper could not create its Windows path under the sandbox. No product behavior changes.
- Restore unrelated README/config/line-ending defaults written by local Convex initialization; retain the generated API declaration for the new module.
- Independent review reproduced background coverage exhaustion. Use the existing state/time indexes to answer whether a pair crosses any outage, instead of storing and paging all coverage rows. This preserves the approved interval contract and avoids a coverage cursor/table; it adds up to four bounded indexed probes per candidate interval. Observation jobs still paginate. Regression coverage includes more than 1,000 windows and a real outage among them.
