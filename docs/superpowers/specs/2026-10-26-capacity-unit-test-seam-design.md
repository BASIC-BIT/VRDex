# Explicit capacity fixtures for PR #388 baseline failures

Recommendation: retain the empty production measured map. Supply a resolver through ordinary closure dependencies to scheduling and bridge entrypoints used by unit fixtures. Do not add environment-controlled capacity, module-global setters, a public mutation argument, database authority overrides, or special evidence-ID exceptions.

## Evidence and existing seams

- `workers/restream/broadcast-capacity.mjs` already exposes `createCapacityResolver(entries)` and `validateMeasuredSnapshot(snapshot, resolve)`. Its production resolver intentionally rejects all unmeasured configurations.
- `tests/scripts/event-broadcast-capacity.test.mjs` already uses a synthetic map for all six presets and both simulcast states, with a valid 4096 CPU / 8192 MiB allocation and `fixture-capacity-v1` evidence ID. It separately asserts production rejection. Reuse this fixture concept, not production resolver output.
- `scripts/event-media-ecs-bridge.mjs:taskDefinitionFor(command, config, resolve)` already accepts the right dependency. `registerTaskDefinition` drops that dependency, and `claimAndProcess`/`runBridge` cannot currently forward one.
- `convex/events.ts:scheduleEventMediaWorker` hardcodes the production resolver twice: initial allocation and validation of an existing/new snapshot. Both must use the same injected resolver. Supplying only the allocation would still fail revalidation.
- `tests/scripts/_event-allocation-fixture.mjs` currently calls the production resolver; it must instead own explicit synthetic allocations.
- `tests/backend/event-broadcast-control.test.ts` currently demonstrates direct seeding of an already-admitted session. This is appropriate for narrow control-only tests, but using that shortcut everywhere would erase scheduling/auth/snapshot coverage.
- Backend tests already use `convexTest({schema, modules})` with lazy module loaders. A per-fixture module map can substitute only the registered schedule mutation while retaining all real handlers, validators, DB operations, and other exports.

## Smallest concrete interface changes

1. `tests/scripts/_event-allocation-fixture.mjs`: export `fixtureCapacityResolver` constructed with `createCapacityResolver` and clearly synthetic entries for the exact preset/simulcast combinations tested; export `allocatedSession` using it. Start with the existing all-12-combination fixture shape, rather than inventing measured performance differences. Keep fixture data under tests. Update capacity tests to import this shared resolver, preserving their independent production rejection assertions.

2. `workers/restream/broadcast-capacity.mjs`: add JSDoc `CapacityInput = {videoPreset: import("./broadcast-profiles.mjs").VideoPreset, simulcastEnabled: boolean}` and `CapacityResolver = (input: CapacityInput) => import("./worker-allocation.mjs").WorkerAllocation`. Annotate `createCapacityResolver(entries)` with entries `Readonly<Record<string, import("./worker-allocation.mjs").WorkerAllocation>>` and return `CapacityResolver`; annotate the returned resolver input explicitly. Keep runtime validation and `MEASURED_ALLOCATIONS` unchanged. Then `typeof resolveWorkerAllocation` has a concrete input and result.

3. `convex/events.ts`: wrap the current schedule mutation registration in a factory requiring a resolver argument, e.g. `createScheduleEventMediaWorker(resolveAllocation: typeof resolveWorkerAllocation)`. Return the same `mutation({ args: eventMediaWorkerScheduleArgs, handler: ... })`; replace only the two capacity dependency uses. Register the deployed `scheduleEventMediaWorker` exactly once with `createScheduleEventMediaWorker(resolveWorkerAllocation)`. Keep the ordinary factory export in events.ts, consistent with existing utility exports. Convex filters API members by registration metadata (`isConvexFunction`); the factory itself receives no mutation registration metadata. Verify actual analyzed function names with the supported local dev/analysis and function-spec flow, plus API typing. A generated-file diff alone is insufficient. An underscore filename is not a deployment exclusion and is not a fallback. Preserve inferred context/validated args/return types by keeping the complete `mutation({args, handler})` registration inside the factory; no broad return annotation, `any`, or cast.

4. Add `tests/backend/_eventCapacityFixture.ts`: provide a lazy events module loader that imports real events and returns `{...events, scheduleEventMediaWorker: events.createScheduleEventMediaWorker(fixtureCapacityResolver)}`. Each relevant `convexTest` instance opts into this module loader. Do not patch ESM exports or change global resolver state. Avoid a full generic testing framework: this helper owns only the events module substitution. Script lifecycle tests import this TS helper, matching their existing TS fixture imports under tsx; do not add a fallback or generic module transformer.

5. `scripts/event-media-ecs-bridge.mjs`: add a closure dependency `resolveAllocation = resolveWorkerAllocation` to the existing `runBridge` options. Thread it through `claimAndProcess` -> `startCommand` -> `registerTaskDefinition` -> `taskDefinitionFor`. For direct `claimAndProcess` callers, append an optional dependency options object after its existing draining callback, preserving positional callers. Production defaults stay the production resolver. Do not put executable resolvers into parsed environment/config data. `runBridge` must explicitly forward the resolver, rather than relying on a singleton.

6. `tests/scripts/event-media-bridge-lifecycle.test.mjs`: its real Convex fixture opts into the schedule-module loader. Supply the fixture resolver to real bridge runs/direct claims that reach task definition construction. This keeps the drain, ownership, stop, cleanup and launch-fence code real. `tests/scripts/event-media-lambda-bridge.test.mjs` already injects a `runBridge` dependency; supply a wrapper of the real runBridge with fixture resolver to `createLambdaHandler({runBridge: ...})` for the launch test, rather than to the AWS runtime object, and use that same resolver in its `taskDefinitionFor` expectation. Keep existing HTTP/AWS fakes and mutation ordering assertions.

## Which tests use which authority

Use synthetic scheduling only for tests that need a successfully admitted session as a prerequisite or that specifically test scheduling behavior unrelated to measured capacity. This includes the failing cases in event-api-ownership, event-broadcast-worker, event-media-worker, event-broadcast-control, event-broadcast-settings, event-broadcast-output, event-broadcast-sources, event-corrections and event-output-authorization. Preserve pre-capacity negative assertions: unauthorized callers/accounts, missing output, changed destination, already claimed/open sessions, invalid time fields and resource limits should still reject for their intended reasons under the synthetic resolver.

In `event-broadcast-settings.test.ts`, replace the expectation importing production `resolveWorkerAllocation` with the explicit fixture resolver. Keep active snapshots immutable, simulcast membership frozen, and next-start settings assertions; do not replace these with direct DB seeds.

Keep production rejection tests on an unmodified module map/default entrypoints:

- Expand the existing capacity rejection test across six presets x both simulcast states, with production map empty.
- Add one real Convex scheduling rejection test with a ready authorized output: unproved error, no session/start command/audit scheduling side effects. Also cover a structurally valid synthetic persisted snapshot being rejected when re-entering production scheduling: compare complete relevant session/program/command/audit state before and after rejection, including existing-row contents. Include fixture and production convexTest instances in the same test: fixture scheduling succeeds and default still rejects; no shared authority.
- Add a default bridge-path rejection test using a structurally valid synthetic snapshot: RegisterTaskDefinition, RunTask and launch marker never occur; admission is safely released and the existing command-error reporting behavior runs. Keep synthetic resolver positive coverage separately.
- Preserve literal allocation assertions of 4096 CPU units and 8192 MiB in capacity and Lambda tests; agreement between two calls to one fixture resolver is insufficient.
- Retain strict snapshot/evidence-ID/profile mismatch tests using the fixture resolver. Explicit dependency injection must not bypass `validateAllocationSnapshot` or `validateMeasuredSnapshot`.

Do not guarantee all 192 cases pass before running them. Their recorded first failures share the resolver, but later failures may surface once scheduling progresses.

## Migration artifact changes the CI conclusion

The safe artifact is now verified: 12359 bytes, SHA256 `239c8a39b9140df75f53b2652a12fe50d1ca0d08ee809da5169c5bea02607cd7`. It confirms `failedStage=protocol-lifecycle`, with terminating `events:scheduleEventMediaWorker` RPC reason `unproved-broadcast-configuration`. Fourteen prior backfill RPC errors belong to expected rejection scenarios; the driver recorded historical-result after 162 migration calls. Cleanup deleted 47 records and passed; phase/recovery receipts confirm empty manifest, binding/private-file removal, and process/listener closure.

The existing migration contract is explicit and unchanged: `scripts/event-broadcast-migration-rehearsal.ts:119` requires actual admission for whole-flow evidence; `start` calls the real production schedule mutation and records `real-admission` only after acquisition/claiming. `tests/scripts/event-broadcast-migration-rehearsal.test.ts:132` expects whole-flow failure at protocol-lifecycle while the production map is empty, no real-admission evidence and successful cleanup. Preserve those exact assertions and receipt semantics. The existing local historical fixture grants no worker/publication authority and contains no synthetic admission operation. This unit-only change creates none. Positive actual production admission remains blocked on measurements; original CI migration gate remains red. Do not seed around it, change scope/status, remove scenarios, weaken admission, or describe unit success as whole-flow readiness. Any distinct synthetic protocol fixture would be a separately reviewed contract and is outside this design/plan.

## Focused verification plan

No tests or source edits were performed for this design.

After implementation:

1. Run capacity tests plus focused backend schedule/settings/output-authorization tests and a new production schedule-rejection test. Confirm generated public API unchanged and backend typecheck passes.
2. Run both script lifecycle/lambda test files, including the real bridge default rejection case and synthetic positive registration/RunTask checks.
3. Run the nine previously failing backend files, then the backend suite once; retain new failure summaries rather than repeatedly broad-running. Run scripts suite once to establish that the 20 failures are resolved without breaking 947 prior passes.
4. Run MCP verification to reach its previously blocked smoke/client-matrix stages; backend job must also reach previously skipped Temporal checks.
5. Keep the actual local migration gate unchanged and explicitly blocked on measured production allocations. Run its existing unit contract test, expecting the test to pass while the whole-flow receipt remains failed. Do not run or claim a successful whole-flow rehearsal for this unit-only change.
