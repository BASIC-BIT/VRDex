# Task 6 report

Status: DONE_WITH_CONCERNS. Gateway implementation and its focused checks pass.
A pre-existing Task 5 registry regression was found and reproduced against an
untouched HEAD archive; it is described below and is not hidden by this status.

## Delivered

- Stable native `GET /p/:grantId/:rendition/index.m3u8` with no-store responses,
  explicit unsupported reason, exact HTTPS-origin CORS, signed immutable segment
  URLs and current grant/context/epoch/lease checks before storage lookup.
- Shared `GatewayAuthorizationSchema` validates the external control reply.
  Public service query `mediaRelayWorker:readGateway({credential,grantId,rendition})`
  is actually callable from an external Convex HTTP client. It uses server time
  and a distinct `MEDIA_RELAY_GATEWAY_TOKEN`. It cannot mutate admission or
  ownership. Worker and gateway scopes reject equal configured token values.
- Immutable snapshot bytes must equal the authoritative committed metadata.
  Freshness, grant/lease expiry and the <=2-second request budget are rechecked
  after awaited work and before response. No authorization cache exists.
- Bounded physical request concurrency, source/rendition continuity map,
  decreasing sequence/epoch rejection, and takeover discontinuity validation.
  A timed-out noncooperative operation retains its slot until real settlement.
- Concrete `createLambdaHandler` API Gateway HTTP API v2 / Function URL boundary
  composes with `createManifestHandler`; local tests invoke the actual event to
  response boundary. Task 7 binds provider SDKs, rather than replacing a stub.
- `createDemand` supplies native request accounting and the registry read
  adapter. Writes coalesce ten seconds per process/source; conditional DynamoDB
  max-time update specification prevents regression across processes. Demand
  remains separate from Convex ownership. Health probing happens even for empty
  discovery scans and is single-flight. All physical store operations/maps are
  bounded. Failed reads report unhealthy without inventing activity.
- Actual RSA CloudFront canned-policy signing, verified with an RSA public key;
  tampered resources fail verification. Minimum validity is five minutes.
- Real registry + demand-adapter test proves an outage denies additional jobs,
  preserves existing playback only through bounded 180-second idle grace, and
  stops despite continuously fresh media. Terminal polling cannot restart work.
- No browser heartbeat, page-mount source connection, new product prose, provider
  call, credentials, hosted configuration, resource apply or deployment.

## Actual APIs / Task 7 handoff

Full interfaces and operational constraints are in
`docs/engineering/media-relay-gateway.md`, cross-linked from runtime docs and
shared contracts. Server-only package exports are:

- `@vrdex/media-relay/gateway/handler`: `createManifestHandler(ManifestOptions)`
  and `createLambdaHandler(handler)`.
- `@vrdex/media-relay/gateway/demand`: `createDemand({store,clock,...bounds})`,
  `DemandStore`, `dynamoDemandUpdate({tableName,streamKey,at})`.
- `@vrdex/media-relay/gateway/signing`: `createSegmentSigner(...)` and `SignSegment`.
- `@vrdex/media-relay/gateway/playlist`: bounded metadata playlist rendering.

`DemandStore` requires `checkHealth():Promise<void>`,
`updateMax({streamKey,at}):Promise<void>` and
`read(streamKey):Promise<number|null>`. The concrete adapter must catch only
conditional-check failures as successful max-time races, use strongly consistent
reads, and bound retries/duration. Even an empty scan must execute a real store
health probe; a reserved GetItem sentinel can provide that probe. An absent row
is healthy, while transport failure is not. Task 7 must also scope private S3,
CloudFront trusted keys and cache policies, bound snapshot response bytes, bind
abort/deadlines where supported, and redact request paths/arguments in provider
logging. No credentials were provisioned here.

## RED/GREEN and self-review

Initial nine behavior tests failed against explicit unimplemented gateway,
accounting and signing boundaries, then passed. The first sandboxed tsx run
could not execute its process/socket machinery; rerunning with the authorized
additional network permission exposed the expected behavior failures. The
backend query test initially failed because the external export did not exist.

Additional self-review regressions were observed RED then fixed:

1. Empty demand reads reported healthy without touching an unavailable store.
   Required real probes now prevent unaccounted bootstrap admissions.
2. Concurrent empty scans competed for probe capacity. A single physical probe
   is now shared, including noncooperative cases.
3. Equal gateway/worker token configuration permitted worker registration with
   the gateway token. Both scopes now reject this misconfiguration.
4. An expired server lease still exposed its snapshot pointer. Server reads now
   return null media metadata for expired leases, before gateway clock checks.
5. An immediately resolving read advanced the injected clock beyond two seconds
   before the timer callback ran, yet returned 200. Explicit elapsed-budget
   checks now return unavailable even when the event loop has not run the timer.

Intermediate verification corrections: the new profile-revocation fixture used
`draft` instead of the repository's `draft_private` enum; corrected. DOM typings
omit iterable Headers, so the Lambda bridge now uses `Headers.forEach` with a
string-record result. Neither issue remains in final checks.

## Verification

Every command activated `/workspace/vrdex-env.sh`. Test commands used additional
network permission for local tsx/process machinery while preserving proxy/CA.
No test contacted a provider. Installed Prettier 3.8.1 formatted changed files.

- `node --import tsx --test packages/media-relay/tests/gateway.test.ts packages/media-relay/tests/demand.test.ts packages/media-relay/tests/signing.test.ts`:
  **16 tests, 16 pass, 0 fail**, exit 0.
- `node --conditions=import --import tsx --test tests/backend/media-relay-control.test.ts tests/backend/media-relay-admission.test.ts`:
  **28 tests, 28 pass, 0 fail**, exit 0.
- `pnpm --filter @vrdex/media-relay typecheck`: exit 0, no diagnostics.
- `pnpm exec tsc --noEmit --project convex/tsconfig.json`: exit 0, no diagnostics.
- `git diff --check`: exit 0.
- `node --import tsx --test packages/media-relay/tests/contracts.test.ts packages/media-relay/tests/registry.test.ts`:
  **20 tests, 19 pass, 1 fail**, exit 1. The inherited failure is detailed below.

No broad repository suite or real-media packaging suite was rerun. Existing
Convex module exports are picked up by the generic generated API module; no new
module/table required regeneration or hosted codegen.

## Inherited failure and remaining limits

`a terminal source now owned elsewhere frees its local slot after cleanup`
(`packages/media-relay/tests/registry.test.ts:285`) fails `1 !== 2`. The isolated
name-pattern command reproduces it in the working tree. An untouched `git archive
HEAD` of the package/runtime into `/tmp/vrdex-task6-baseline-ZViCHf`, with symlinks
to installed dependencies, reproduces the identical failure. The archive's first
run lacked the package-level zod dependency link; after adding that link the test
executed and failed identically. Task 6 does not modify registry or its fixture.
The likely interaction is Task 5's new `observe.isIdle()` removal guard with
repeated immediately-rejected observations. The coordinator was notified for a
focused Task 5 follow-up; this report does not claim the registry suite is green.

Provider SDK bindings/security policy remain Task 7. Local crypto verifies the
CloudFront signature algorithm, not deployed distribution policy. The gateway
continuity map conservatively denies new pairs when full until process recycle;
it does not silently evict safety watermarks. Coalescing is per gateway process,
so aggregate DynamoDB throughput depends on deployment concurrency. A lost
request or failed store never invents freshness. Existing signed segment URLs
retain their lifetime after grant revocation; future manifests are denied.
Physical-phone behavior and production capacity remain unverified.
