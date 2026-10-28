# Native playlist gateway

The gateway serves `GET /p/:grantId/:rendition/index.m3u8`, where rendition is
`video` or `audio`. A grant is an opaque playback capability. The route is stable
across worker ownership epochs. Native playlist requests sustain demand; segment
cache reads and browser JavaScript timers do not.

## Control boundary

`mediaRelayWorker:readGateway` is a public Convex **query**, callable by an
external `ConvexHttpClient.query` using `{credential, grantId, rendition}`.
`credential` is the separately scoped `MEDIA_RELAY_GATEWAY_TOKEN`. Configure this
secret independently in Convex and the gateway runtime; the deployment owner
rotates both together. No value is checked in or provisioned by this change.
Both gateway reads and worker mutations reject an equal gateway/worker token.
Gateway credentials confer no worker registration, ownership, publication,
operator or event-management authority.

The query resolves the current public context, revision, release and expiry
using server time before reading source metadata. It never creates a source or
changes admission revision. `GatewayAuthorizationSchema` in the shared package
is the external schema:

- `{kind: "denied"}` for invalid, released, expired or context-revoked grants.
- `{kind: "unavailable", reason: "unsupported" | "unavailable"}` for terminal or
  absent sources, preserving unsupported input explicitly.
- `{kind: "active", grant, state, epoch, leaseExpiresAt, snapshot}` for admitted
  queued, starting, ready or recovering sources. Epoch, lease expiry and snapshot
  can be null while preparing. An expired server lease always returns a null
  snapshot. Snapshot is the authoritative committed metadata, never an S3 list
  result or mutable current-object lookup.

## Gateway runtime

Import server-only `@vrdex/media-relay/gateway/handler`:

```ts
const handleRequest = createManifestHandler({
  authorize,
  readSnapshot,
  demand,
  signSegment,
  clock: Date.now,
  origins: ["https://vrdex.example", "https://approved-preview.example"],
});
export const handler = createLambdaHandler(handleRequest);
```

`createLambdaHandler` is the actual API Gateway HTTP API payload v2 / Lambda
Function URL adapter: it accepts unknown events, validates the boundary and
returns `{statusCode, headers, body, isBase64Encoded:false}`. Task 7 supplies
provider SDK bindings; the factory contains no permissive/default production
adapter. Dependencies are explicit:

- `authorize({grantId,rendition,signal}): Promise<unknown>` calls the scoped query.
- `readSnapshot({objectKey,signal}): Promise<unknown>` reads the immutable JSON
  object at `snapshotObjectKey(pointer)`; bound object bytes/retries in the SDK
  adapter. It may cache immutable bytes, but must never bypass authorization.
- `demand.recordDemand({streamKey,at})` accounts native requests on admitted
  nonterminal sources. Failed accounting returns unavailable.
- `signSegment({objectKey,expiresAt}): string` signs immutable segment keys.

There is zero authorization caching. The request budget defaults to 1500 ms and
cannot exceed 2000 ms. Every request validates the shared response before media
lookup, compares parsed immutable metadata exactly with the committed pointer,
and rechecks grant expiry, lease expiry and snapshot freshness after awaited
work and before serving. Unsupported, denied, stale and malformed results never
become a healthy 200. All responses, including errors, use `Cache-Control:
no-store`. Exact configured HTTPS origins receive CORS; others are denied.
Credentialed wildcard CORS is never emitted. The API accepts GET and OPTIONS.

Defaults bound physically outstanding requests to 32 and continuity watermarks
to 2000 source/rendition pairs (`maxSources * 2`). A timeout responds unavailable
and aborts the signal but holds its capacity until actual adapter settlement.
The watermark rejects decreasing sequences/epochs and invalid takeover
continuity; it is not a per-viewer cache. It conservatively refuses new pairs
once full until process recycling rather than forgetting continuity silently.
A process restart relies on the transactional monotonic control pointer.

Do not log incoming capability paths, raw events, query arguments or signed
URLs. This code emits no such logs. Task 7 must also configure access logging and
error instrumentation to redact them. Gateways require synchronized clocks;
server query validation and local expiry/freshness checks both fail closed.

## Demand store

`@vrdex/media-relay/gateway/demand` exports `createDemand`, `DemandStore` and
`dynamoDemandUpdate`. `createDemand` returns `recordDemand({streamKey,at})`,
`lastDemand(streamKey)` and the registry adapter
`read({streamKeys,signal}) -> {healthy,activity:[{streamKey,lastActivityAt}]}`.

The DynamoDB document update returned by `dynamoDemandUpdate` is:

```text
Key: {streamKey}
UpdateExpression: SET lastActivityAt = :at
ConditionExpression: attribute_not_exists(lastActivityAt) OR lastActivityAt < :at
```

This table stores activity only, never ownership or admission. The provider
adapter must map **only** `ConditionalCheckFailedException` to success (a newer
observation won), use strongly consistent reads, and reject other errors. The
clock is gateway server time. Coalescing is ten seconds per process/source;
concurrent writes share the pending operation and timestamps never decrease.
There are at most 1000 source entries and 32 physical store operations by
default. Inactive settled entries retire after the 180-second grace; pending
entries retain their slots. Read-only activity does not write demand.

`DemandStore.checkHealth(): Promise<void>` is mandatory, even when the registry
has no keys. Task 7 can implement a strongly consistent GetItem of a reserved
health sentinel (absence is healthy; transport failure is not). Concurrent scans
share one physical probe. `updateMax(observation)` and `read(streamKey)` are the
other methods. SDK adapters must bound retries and operation duration. Core
capacity remains occupied while noncooperative operations are pending.

On a failed probe/read, the registry receives `{healthy:false,activity:[]}`.
It denies new starts, keeps existing jobs only within the last known 180-second
idle grace, and never converts failure into invented activity. Terminal sources
cannot restart from playlist polling; a fresh explicit Play changes admission
revision. Tests compose this demand adapter with the real registry to prove
continued fresh media cannot prolong outage grace or restart another source.

## Segment signing

`createSegmentSigner({origin,keyPairId,privateKey,clock})` from
`@vrdex/media-relay/gateway/signing` implements CloudFront RSA-SHA1 canned-policy
signed URLs with a minimum 2048-bit RSA key. It accepts only epoch-scoped relay
segment keys and an HTTPS origin without path/query credentials. Expiry is
rounded up to seconds and must be at least five minutes from signing. The
manifest gives a one-second additional margin. Signature tests use an actual
RSA public-key verifier and reject tampered resource URLs.

Segment URLs contain no grant/viewer identity and can be reused. Task 7 binds
private S3 origin access, CloudFront trusted keys and cache behavior excluding
signing parameters from the object cache key. Those provider security settings
and deployment are not performed here. Revoking a grant stops future playlist
access; already-issued segment URLs retain their signed lifetime.

Local verification does not establish deployed provider behavior, capacity or
physical-phone playback.

## Deployment binding

Concrete abortable Convex, S3, DynamoDB and secret adapters, runnable worker and
Lambda entrypoints, packaging and disabled infrastructure are documented in
[relay deployment](../deployment/media-relay.md). Provider capacity and physical-phone
release checks remain unmeasured; local fixtures are not production approval.
