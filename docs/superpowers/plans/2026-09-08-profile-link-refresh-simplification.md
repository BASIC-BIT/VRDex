# Profile link refresh simplification implementation plan

> For agentic workers: use `superpowers:executing-plans` to implement this plan task by task. Keep this as one cohesive delivery slice; parallel agents are optional, not required.

**Status:** Shared understanding confirmed and implementation authorized by BASIC on 2026-09-08. Implemented in this change; merge and deployment remain separate steps.

**Goal:** Preserve destination names and artwork while removing recurring discovery, refresh, and retry work from this feature.

**Architecture:** Link changes and actual profile visits request deduplicated work. Discord uses a one-shot scheduled action for queued work; VRChat uses the existing authenticated collector, with a work hint carried in its existing assignment response. Cached metadata ages without creating work.

**Tech stack:** Existing Next.js, TypeScript, Convex scheduler/database, Node collector, and S3 thumbnail cache. No new service or dependency.

**Spec:** The locked decisions below supersede scheduling and discovery behavior in [the original design](../../planning/profile-link-display-names-design.md). Its presentation, custom-label, and artwork-safety requirements remain in force.

## Locked decisions

- Q1: A profile visit requests a background lookup for missing metadata or metadata at least 24 hours old. Render the cached result immediately.
- Q2: A failed lookup records a cooldown. The next eligible profile visit can request another attempt; no failure schedules its own retry.
- Q3: Search and lookup results only read cached metadata. They do not request work.
- Q4: Preserve existing cached results. Missing existing destinations resolve on a profile visit. No backfill.
- Q5: No manual-refresh control. Link additions and URL changes request lookups without waiting for a visit.
- Default failure cooldown is 15 minutes. Respect a provider retry delay, bounded to 1 minute through 24 hours. Preserve provider-wide rate limits.
- Temporary failures preserve last-known branding. Confirmed invalid/private destinations clear fetched branding as today. They also wait for a later eligible visit, rather than automatic daily rechecks.
- Keep current fallback labels and visual treatment. BASIC explicitly declined a separate fallback-prefix change.
- No recurring destination jobs, separate idle collector requests, or idle destination-table scans. Existing telemetry/proof/session work continues independently.
- A finite dispatcher wakeup for genuinely queued work or lease recovery is allowed. It must stop when the queue is empty. This is not permission for periodic discovery or automatic refresh/retry chains.
- BASIC subsequently authorized implementation via the implement skill. Production changes still require deployment authorization.

## Current evidence and deletion targets

`convex/crons.ts` registers discovery and Discord refresh every minute. Discovery scans 25 profiles, maintains references, and continually touches `lastReferencedAt`. `profileLinkDestinations.ts` skips references older than two days and deletes old metadata after seven days. Those timestamp rules depend on the sweep and must be removed with it.

`workers/group-telemetry/worker.mjs` calls `checkDestinationMetadata` each eligible loop. `destination-jobs.mjs` then sends a separate `destination_claim`, even when no work exists. Remove that idle call.

The current `nextAttemptAt` mixes queued work, refresh eligibility, retry eligibility, and lease expiry. Separate actual requested work from timestamps describing when a future view may request it. Otherwise existing rows silently keep refreshing themselves.

## Task 1: Separate eligibility from requested work

**Files:** `convex/schema.ts`, `convex/profileLinkDestinations.ts`, `convex/_profileLinkDestinationCache.ts`, `tests/backend/profile-link-destinations.test.ts`.

**Proposed interfaces:** Keep `requestDestinationRefresh` as a small shared transactional helper, taking the mutation context, current public profile, and server time. Return the destination keys newly queued by this transaction. Add an optional `workDueAt` timestamp for real queued work and an optional `retryEligibleAt` for failed lookups. Keep `observedAt` as the last accepted provider observation. These fields are separate from existing lease ownership fields.

- [ ] Add regression cases showing that advancing time alone creates no work, 100 simultaneous views enqueue one attempt, and a failed lookup cannot be claimed again without a new eligible request.
- [ ] Use this eligibility rule before inserting work, after checking current public visibility and URL membership:

```ts
function eligible(row: {
  workDueAt?: number;
  retryEligibleAt?: number;
  observedAt?: number;
}, now: number): boolean {
  if (row.workDueAt !== undefined) return false;
  if (row.retryEligibleAt !== undefined) return now >= row.retryEligibleAt;
  return row.observedAt === undefined || now - row.observedAt >= 86_400_000;
}
```

- [ ] Claims select only explicitly requested work. A successful completion clears `workDueAt` and `retryEligibleAt`, updates metadata, and schedules nothing. A provider failure clears requested work and writes the cooldown. Do not advance `observedAt` on a transient failure.
- [ ] Keep leases and worker credential checks. An expired lease may make the already-requested attempt available again; a completed provider failure may not. Return results only for the matching current lease.
- [ ] Keep global Discord and VRChat request budgets. A budget deferral before any provider attempt retains requested work; a provider failure ends that attempt.
- [ ] Add an index supporting bounded claims of defined, due `workDueAt` values. Exclude missing values explicitly so old rows cannot starve new queued rows.
- [ ] Remove the two-day reference guard and seven-day sweep expiration. Stop writing `lastReferencedAt`. Leave legacy optional fields temporarily readable for rollout compatibility, but do not use them to select work.
- [ ] Run the focused backend tests, confirm the new regressions fail before implementation and pass afterward, then commit this unit.

## Task 2: Request work at the actual lifecycle boundaries

**Files:** `convex/_profileUpdates.ts`, `convex/profiles.ts`, `convex/_profileClaimCreation.ts`, `convex/_profilePrivacy.ts`, `convex/profilePrivacy.ts`, `convex/profileArchival.ts`, `convex/suppressions.ts`, `convex/seedImports.ts`, `convex/migrations.ts`, `convex/_profileLinkDestinationCache.ts`, `apps/web/src/app/_components/profile-public-page.tsx`. Create `apps/web/src/app/_components/profile-link-refresh.tsx` for the small visit-trigger component if no existing lifecycle component fits.

**Interface:** Add a profile-scoped mutation `profileLinkDestinations.requestForProfile({ profileId })`. It derives keys from the currently public profile itself, never accepts an arbitrary provider URL, and returns no private metadata. The transactional helper from Task 1 performs deduplication. The client calls it once on an actual mounted profile visit and renders nothing.

- [ ] Test an actual profile visit requesting missing/stale metadata, with fresh metadata remaining untouched. Test that search, API lookup, prefetch, and editor preview do not invoke the visit trigger.
- [ ] Mount the trigger on the actual public profile surface, not its shared search projection. Keep names and click targets available without awaiting it. Avoid server-render side effects and rerender-triggered retry loops.
- [ ] Preserve current save hooks in `applyApiProfileUpdate` and profile creation. Only changed public destination membership should enqueue work on save; unrelated edits do not refresh every link.
- [ ] Cover the missing paths: claimed Discord profile creation; outbound-link privacy changes; archive/suppression and restoration; seed single/bulk publication, merge publication, bulk visibility/rederivation; and publication migrations. Keep fixture cleanup consistent in `convex/e2e.ts`, `convex/e2eMedia.ts`, and `convex/hostedSmokeFixtures.ts`.
- [ ] Maintain `profileLinkDestinationReferences` as membership, not periodically renewed liveness. Remove known detached references during lifecycle changes. Revalidate the exact public profile before provider work and artwork access. Do not scan old references merely to clean history.
- [ ] When the final known reference is removed, invalidate pending work and remove the metadata row. Late leased results must safely no-op. Historical orphan rows may remain inert; no migration/backfill sweep is required. A profile visit reconciles that profile's legacy references lazily.
- [ ] Avoid introducing the cycle `_profileSurfacing -> cache -> _profilePermissions -> _profileSurfacing`. Put hooks in callers or extract the existing pure visibility predicate only if necessary.
- [ ] Exercise public-to-private-to-public transitions and URL changes in backend tests. Confirm old names/artwork never attach to a new URL. Commit after focused checks pass.

## Task 3: Dispatch only queued work and delete the recurring machinery

**Files:** `convex/crons.ts`, `convex/profileLinkDestinationDelivery.ts`, `convex/profileLinkDestinations.ts`, `convex/communityTelemetry.ts`, `convex/http.ts`, `convex/schema.ts`, `workers/group-telemetry/worker.mjs`, `workers/group-telemetry/destination-jobs.mjs`, `workers/group-telemetry/destination-jobs.test.mjs`, `tests/backend/profile-link-destinations.test.ts`.

**Interfaces:** Add optional `destinationWorkDueAt` to the existing fleet settings row and existing assignment response. It represents actual queued VRChat work only. The fleet row is already read by `claimDueAssignments`. Update the hint transactionally on queue transitions; recompute from the bounded queue index during those transitions, never on every idle assignment request.

- [ ] Test an idle collector repeatedly receiving no hint: zero `destination_claim` requests. Test a due hint fetching one job and a completion clearing the hint. Cover stale hints across multiple workers without duplicate accepted results.
- [ ] Replace the unconditional metadata check with:

```js
if (destinationWorkDueAt !== undefined && destinationWorkDueAt <= Date.now()) {
  await checkDestinationMetadata(/* existing authenticated dependencies */);
}
```

Carry the refreshed hint in claim/result responses. A stale hint may cause a bounded empty claim under concurrency; clear it from the authoritative response. Do not create a second timer, service, subscription, or polling request.

- [ ] Schedule the existing Discord action only when work is enqueued. Retain one provider-wide queued dispatcher identity/deadline to coalesce requests and respect its one-request-per-minute budget. Continue only while requested work remains; cancel or naturally finish the dispatcher when empty.
- [ ] Distinguish a remaining queued destination from a failed destination. Draining other requested work is allowed; rescheduling the failed destination without another visit is not. Bound crash recovery using the existing lease deadline.
- [ ] Remove both destination cron registrations and delete `discover`, its cursor state usage, timestamp-touch logic, and obsolete tests. Do not delete unrelated telemetry crons.
- [ ] Test that reaching the 24-hour age or a 15-minute cooldown changes eligibility only. Verify no scheduler call or work hint appears at either boundary.
- [ ] Run worker tests and backend tests, including lease expiry and provider-budget cases, then commit.

## Task 4: Preserve artwork and verify the complete flow

**Files:** `apps/web/src/lib/server/profile-link-destination-artwork-cache.ts`, `tests/web/profile-link-destination-artwork-cache.test.ts`, `tests/web/profile-link-presentation.test.ts`, `docs/backend/profile-schema.md`, `docs/planning/profile-link-display-names-design.md`, and relevant collector deployment documentation.

- [ ] Keep the derived S3 thumbnail cache, current trusted-host checks, redirect validation, bounded downloads/decoding, and static WebP conversion. Do not restore brittle provider path restrictions.
- [ ] Keep artwork fetching demand-driven. The existing image cache already has a 24-hour success TTL and a one-hour failed-import cooldown; neither schedules work. Document that image-byte caching is separate from the metadata retry policy. This pass does not require a new image dispatch subsystem.
- [ ] Verify cached name/artwork display immediately while metadata refresh runs. Missing artwork retains the existing fixed-size icon fallback. If implementation changes layout or loading behavior, capture desktop/mobile screenshots and review them before completion.
- [ ] Run `pnpm exec tsx --test tests/web/profile-link-presentation.test.ts tests/web/profile-link-destination-artwork-cache.test.ts`, the focused backend suite through its existing harness, and `node --test workers/group-telemetry/destination-jobs.test.mjs`. Run backend/web typechecks and required repository checks once after integration.
- [ ] In a controlled test, advance the clock beyond 25 hours with no visits. Assert zero scheduled destination actions, zero destination table scans from idle collector passes, and zero destination-specific network requests. Then visit one stale profile and assert one lookup per shared destination, despite concurrent visits. Search must cause none.
- [ ] Verify failure, cooldown, later visit, and recovery; profile hiding during an in-flight lookup; removed links; shared destinations; worker restart; old saved metadata; and lost visit-trigger requests recovering on a later visit.
- [ ] Rewrite current behavior docs to match this plan. Mark historical polling descriptions as superseded rather than claiming already-deployed behavior has changed. Commit the final integrated documentation and verification changes.

## Rollout and completion

Deliver one PR. This document does not authorize merging or deploying it. Follow the repository's exact-head checks and 30-minute review window if asked to make it merge-ready.

Roll out additively: backend first with old optional fields accepted and only explicitly queued work claimable, then the collector with hint support, then the web visit trigger. Old cached rows are never automatically converted into queued work. Existing old-worker claim calls may occur during the brief overlap; the idle guarantee applies after the collector rollout completes. Do not remove legacy schema fields until old writers are gone.

After authorized deployment, verify the exact web/backend/collector versions, no registered destination crons, an empty queue producing no separate collector metadata requests, and one real stale-profile visit resolving its destinations. Read-only search must leave the queue unchanged. Preserve existing cached rows during rollout; there is no backfill, metadata wipe, or new infrastructure.

Completion means the agreed trigger behavior and the idle-work guarantee are demonstrated, not merely that fewer cron entries appear in the code.

## Implementation evidence

The implementation removes both destination crons and the discovery function. New queue eligibility and lifecycle hooks preserve cached rows without a backfill. VRChat work rides on the existing assignment response; Discord dispatches only requested work.

Local verification includes the full backend and web test suites, collector tests, backend/web typechecks, and Markdown/ESLint checks. Focused tests exercise 100 concurrent requests, 25 hours of idle time, failure cooldowns, scheduled Discord action execution, stale dispatcher tokens, archive/restore, private references, legacy leases, and authentication failure with a failed result write. A real Chromium harness mounts the actual visit component under React StrictMode: one request per visit, no same-slug rerender request, no rejected-request retries, and no DOM output.

Review corrections: compare actual before/after public membership rather than missing legacy bookkeeping; preserve active legacy leases; end failed authentication attempts before quarantine and attempt quarantine even when result persistence fails. Removed unused collector hint callback plumbing.

Ruling: use one integrated implementation commit because schema, queue dispatch, and mutation-context callsites change together. No intermediate partial state is intended for deployment. The original task checklists remain the planning record; this evidence section records the resulting implementation.
