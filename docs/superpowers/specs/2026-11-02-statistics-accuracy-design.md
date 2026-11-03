# Consistent community statistics and historical repair

Status: approved by BASIC on November 2, 2026. The implementation plan follows this design. Production deployment and backfill execution require separate approval.

## Outcome and decisions

Population charts, private summaries, instance summaries, and event recaps should apply the same rules to observed intervals. Hourly and daily totals should retain the time observed across bucket boundaries. Recorded outages must remain gaps. Successful quiet polls should tolerate the dispatch allowance already used for freshness.

The recommendation is to correct the shared interval calculations, then rebuild affected derived summaries from retained observations. This can repair calculation errors in historical player-hours and coverage. It cannot recover guests omitted by the old collector, and it must not change raw observations to imply otherwise.

The two decisions for review are:

| Proposed decision | Recommendation and tradeoff |
| --- | --- |
| Where the rules live | Reuse the existing pure analytics module for interval eligibility and clipped integration. Migrate every calculation caller. This touches more callers than three local patches, but removes the demonstrated source of disagreement. |
| Quiet-poll tolerance | Keep the current 3-to-5-minute quiet cadence and accept adjacent successful observations up to 6 minutes apart, inclusive. This adds no provider traffic and repairs historical cadence gaps. It allows one more minute of interpolation where no outage was recorded; it is a continuity inference, not proof of presence between samples. |

Current recommendation: include a bounded, resumable historical rebuild in the implementation. Run it only after a production dry run and explicit execution approval. Approval of this design covers the proposed behavior and engineering scope, not a production cutover.

## What users experience

Existing pages, controls, category permissions, and labels remain in place. Population history keeps genuine gaps. Hourly/day player-hours and coverage can increase when valid boundary intervals are restored. Coverage and player-hours can decrease when an outage previously bridged by private calculations is excluded. An empty but successfully observed interval contributes covered time and zero player-hours.

Corrected persisted buckets update in place. During the rebuild, some historical buckets will use the old calculation and others the new one. The internal progress report must distinguish those buckets; this design accepts gradual correction instead of making history unavailable during a global switch. No new public-facing copy is proposed.

## Approaches considered

1. Patch each calculator independently. Lowest initial code movement, but duplicates outage, boundary, and cadence rules across public, private, browser, and streaming calculations. Rejected as the recommendation because the current discrepancies come from that duplication.
2. Share the interval rules while retaining existing query adapters and chart reduction. Recommended. It fixes all three issues without replacing the analytics subsystem or adding a dependency.
3. Shorten quiet polling so samples usually remain under five minutes. Increases provider traffic and does not repair old cadence gaps. Keep as a future operational option if six-minute interpolation proves unsuitable.

The shared-policy approach and six-minute tolerance were approved by BASIC on November 2, 2026. The alternatives remain here to explain the tradeoffs.

## Calculation contract

### Window boundaries

- Ranges are half-open: `[startAt, endAt)`.
- Read one immediately preceding observation and one immediately following observation, within the six-minute bound and the same integration/presentation epoch. Read the first observation at `endAt` as an endpoint, without counting it as an in-range peak.
- For each eligible pair, clip its interval to the requested range and integrate the linear population change with the existing trapezoid calculation.
- Never extend the last observation to the end of the window without a real following observation. Never extend the first observation backward without a real preceding observation.
- Splitting a range into adjacent buckets must preserve total integrated area and observed duration, within numerical tolerance. A shared endpoint contributes no duration by itself.
- Peak remains an observed-sample statistic. Boundary samples can support integration but must not invent an observed in-range peak. Preserve existing public/private empty-result representations at their adapters; missing data must not become a fabricated observation of zero.

### Eligibility and outages

A pair is connected only when its timestamps increase, their difference is at most 360,000 ms, its endpoints satisfy the metric's existing observation-state eligibility, and no recorded `degraded`, `unknown`, or `stale` window overlaps the open interval between them. Reconnects, changed integration ownership, and presentation epochs are hard boundaries.

Any overlapping outage rejects the whole pair, matching the current public-series behavior. Do not split the pair around an outage and interpolate through the unobserved portion. An outage ending exactly at the first endpoint or starting exactly at the second endpoint does not break that pair. Missing legacy coverage rows supply no additional proof of continuity; the timestamp cap still applies.

This scope does not redefine how estimated samples are presented or admitted by metrics. Public and private adapters retain their existing estimated-sample eligibility. Shared observed-only inputs must produce identical interval totals across consumers. That distinction must be explicit in tests rather than hidden in a default flag.

### Quiet-poll allowance

Use one pure exported population continuity constant of 360,000 ms. The existing six-minute current-value freshness rule remains separate in purpose, even though its numeric value matches. Membership continuity retains its existing independent policy. Intervals of 360,001 ms or more remain gaps, regardless of the absence of recorded errors.

The provider observation time remains authoritative. Do not substitute request-completion time or renew cached snapshots to make intervals fit.

## Shared implementation boundary

Reuse `convex/_clubAnalyticsMath.ts`, which is already imported by browser code and has no Convex runtime dependency. Put the shared pair-eligibility and clipped-integration logic there. Keep database access and privacy decisions in existing backend adapters. `computePopulationMetrics` remains an adapter for its existing return shape and world accounting; remove its independent integration loop. Public series reduction retains its bounded chart representation and observed extrema, but uses the same interval rules.

Queries read coverage windows overlapping the endpoints they actually calculate, including the last window starting before the lower boundary. Use existing indexed access in `_collectionCoverage.ts`; do not reuse the longer membership-continuity allowance for population. A bounded reader must report an incomplete result when its cap is reached. Partial input must never be labeled a complete summary. Background jobs continue across observation pages rather than silently truncating. For coverage barriers, bounded existence probes through the existing state/time index may replace materializing every window; the same outage rule applies without an interactive window-count cap.

### Browser and pagination

Add an optional `breakBefore` flag to normalized series points and the matching validators. Backend series readers mark it when the preceding source sample is separated by an explicit outage or epoch boundary. Calculate that flag using the real indexed predecessor even for the first point of a new page. It is metadata, not a synthetic population sample.

The shared pair check refuses a bridge when its later endpoint has `breakBefore`. Paginated summary endpoints carry the flag on their first/last points so `mergeSeriesSegments` cannot reconnect an outage at a page boundary. The browser chart inserts a visual gap on the same flag. Do not send private coverage reasons or collector details to browser/public readers. Continue enforcing their existing category permissions.

### Event recaps

Retain the existing confirmed-association requirement and streaming job. Aggregate associated sessions by provider snapshot time as today, then apply the shared interval rule to adjacent aggregate timestamps. Obtain per-session boundary samples inside their valid session/epoch ranges before aggregation. Preserve pending timestamp totals and endpoint continuity across job pages so simultaneous instances are summed once, and cross-page intervals are counted once.

Coverage-window reads must also span the previous endpoint carried from the prior job page. Empty or failed association-filtered pages must not discard that endpoint or an outage break. Do not invent a session zero after its last observation. This scope does not redefine recap coverage as collection coverage for periods with no associated instance observations.

## Callers, tests, and documentation

| Area | Expected changes |
| --- | --- |
| Shared population math | `_clubAnalyticsMath.ts`, `_communityTelemetry.ts`: shared six-minute pair rule, outage breaks, clipped integration, segment merging; retain adapter return shapes. |
| Coverage reads | `_collectionCoverage.ts`: bounded population-gap projection alongside membership coverage. |
| Private analytics | `clubAnalytics.ts`: `getBucket`, `getSeries`, instance series and summary pages read adjacent observations and relevant gap evidence. |
| Public population series | `_groupPopulationSeries.ts`, `_communityTelemetryPublic.ts`: use shared rules; extend adjacent-sample reads from five to six minutes. Preserve chart limits and authorization. |
| Persisted summaries | `communityTelemetry.ts`: hourly/day recomputation, legacy dashboard summary, and streaming event recap. |
| Browser consumers | `club-instances.tsx`, shared chart/series consumers: honor `breakBefore` and the shared gap constant. Keep UI layout and copy unchanged. |
| Version and jobs | Rollup lookup/read helpers in `_groupObservationPolicy.ts`, recap job validation/schema, and bounded repair state where required. |
| Regression coverage | `club-analytics.test.ts`, `club-instance-summary.test.ts`, `group-population-series.test.ts`, `community-telemetry.test.ts`, and applicable web series/chart tests. |
| Durable docs | Backend/public community telemetry docs, deployment/recomputation instructions, and collector docs if they describe the calculation gap threshold. |

No provider endpoint, credential, membership collection, billing, or account-permission change is needed. Keep the v2 population collector's behavior from PR 414.

## Historical recomputation and rollout

1. Introduce calculation version `community-telemetry-v2`. This is distinct from the collector protocol version. Existing raw rows remain unchanged.
2. Persist one current rollup per stable bucket identity: integration, grain and bucket start; additionally event ID for event recaps. Update that row in place and stamp the new calculation version. Event lookup must find the prior-version row instead of inserting a second visible recap. If preexisting duplicate/ambiguous legacy identities are found, report them for resolution rather than guessing or deleting rows.
3. Fence streaming recap jobs by calculation version. Add version metadata compatibly for existing jobs. Cancel/restart a legacy job from current event boundaries and confirmed associations; an old continuation must not overwrite a corrected rollup. Recheck event schedule/association changes before committing each recap, preserving existing invalidation behavior.
4. Build a dry-run inventory of retained hourly/day buckets and confirmed event recaps, with their integration/epoch mapping, raw-data availability, version, and proposed numeric differences. Include historical scopes that remain unambiguously mapped. List ambiguous legacy/epoch boundaries as blocked, not repaired. Do not expose hidden historical scopes through current public readers.
5. After approved execution, process indexed work in bounded resumable batches. Use the installed `@convex-dev/migrations` runner in `convex/migrations.ts` to checkpoint the approved persisted-bucket target inventory, retaining its default batch size of 50. Reuse recomputation entry points and the event job machinery. Fix the integration/range/version in the approved inventory. Enqueuing a recap does not mark it repaired: completion requires a matching v2 rollup and no pending/failed job for that target. Retrying a bucket is idempotent; serialize or transactionally deduplicate competing work for the same identity. Normal cron recomputation must write the same version and calculation.
6. Canary BITRATE and Faceless first. Compare corrected rollups with an independent raw-observation calculation and confirm query/UI agreement. Expand to the remaining inventoried scopes only after the canary passes.

Do not reset a presentation epoch, change publication settings, overwrite raw counts, or reconstruct missing pre-414 guests. Rollback of calculations means replaying a specified prior calculation over retained raw data; it is not merely changing a version string. Keep the dry-run/change summary so that affected buckets are identifiable.

## Acceptance evidence

- Ten people observed continuously over an hour, with samples on both sides of each boundary, produce exactly ten player-hours. Adjacent bucket totals equal the whole-range total.
- A recorded outage between two observations breaks private summaries, public series and rollups identically for observed-only inputs. Cover outages beginning before the requested range and ending after it, exact endpoint boundaries, multiple overlapping windows, and coverage-read limits.
- Successful empty samples 301 seconds apart count as covered and contribute zero player-hours. Test 359,999, 360,000 and 360,001 ms; an explicit outage still breaks an otherwise eligible pair.
- Page sizes of one and realistic larger sizes produce the same totals. Place an outage at a page boundary, include empty filtered pages, and exercise simultaneous multi-instance event timestamps.
- Test reconnect/epoch boundaries, single/no samples, sparse history, cached/out-of-order provider observations, closed-but-occupied history, event edits, association removal, duplicate recomputation, and a legacy job continuing after deployment.
- Keep real zero, missing coverage, estimated presentation, and observed peaks distinct. Test DST day lengths with existing calendar bucketing.
- Backend/web typechecks and focused unit/integration tests pass. Browser/visual checks confirm gap rendering and private/public totals without new copy. CI selection follows the repo's browser/visual labels when UI logic changes.
- Production acceptance compares bounded provider/raw data, corrected persisted buckets and signed-in UI. A version marker or a green test run alone is insufficient.

## Review boundary and evidence

Design accepted November 2, 2026. The implementation plan must preserve the shared-policy approach, six-minute tolerance, and historical rebuild boundaries. Deployment and production rebuild execution remain separate decisions.

A fresh builder review found no planning-blocking questions. Its review was limited to the design and relevant source; it did not run tests or production checks.

Audit evidence: [findings](C:/Users/steve/.codex/visualizations/2026/10/31/01a19402-24c9-7090-9452-7eff0a8239a7/statistics-audit-findings.md), [three failing reproductions](C:/Users/steve/.codex/visualizations/2026/10/31/01a19402-24c9-7090-9452-7eff0a8239a7/statistics-audit-repro.mjs), and [bounded production comparison](C:/Users/steve/.codex/visualizations/2026/10/31/01a19402-24c9-7090-9452-7eff0a8239a7/statistics-audit-production.json). The production hourly boundary comparison was 54.8934 stored versus 56.1566 boundary-aware player-hours across 23 Faceless hours. That comparison did not yet apply the proposed six-minute policy.
