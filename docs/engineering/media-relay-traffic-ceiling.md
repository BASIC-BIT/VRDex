# Media relay delivery ceiling: offline design and reservation proof

Status: candidate direction, 2026-10-30. This document and its dormant code do not
authorize relay enablement, AWS changes, or a spending level. The checked-in
`RELEASE_BLOCKER` remains binding. The [verification record](media-relay-verification.md#open-traffic-and-budget-decision)
still describes the deployed topology accurately.

## What can be bounded

The current manifest gateway validates a grant and emits CloudFront signed URLs
for immutable `.ts` segments. Those URLs contain no grant or viewer identity and
remain usable for at least five minutes. CloudFront serves cache hits without
returning to the gateway. A gateway-only allowance cannot account for copied URLs,
parallel replays, or cache hits. The current `trafficGiBPerMonth` input is a
forecast, not a meter.

**Candidate guarantee:** for one explicitly identified relay delivery, the sum of
reserved segment **response body** bounds cannot exceed a configured byte
allowance, and the number of accepted segment requests cannot exceed a configured
request allowance. Every successful viewer request reserves before CloudFront
checks its cache. A reservation charges the full immutable object bound even if
the response fails, returns fewer bytes, or the viewer disconnects. This is a
conservative application media payload ceiling, not a measurement of actual
CloudFront billing bytes. Manifest bodies need their own reservation from the
same ledger before return if the intended ceiling includes playlist payloads.
CloudFront-generated error bodies, headers, TLS overhead, other app endpoints and
upstream/worker transfer are outside this guarantee.

AWS documents that a Lambda@Edge viewer-request function runs before the cache
lookup, including requests that hit the cache. Lambda@Edge can make network calls
to DynamoDB; CloudFront Functions cannot serve as the remote atomic meter here.
The exact ordering of CloudFront signed-URL validation relative to the
viewer-request function is not established by those documents and needs a hosted
test. [Viewer-request event definition](https://docs.aws.amazon.com/cloudfront/latest/APIReference/API_LambdaFunctionAssociation.html),
[Lambda@Edge network capability](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/cloudfront-limits.html),
[signed URL validation](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-signed-urls.html).

## Required request path

```text
viewer signed GET -> CloudFront viewer-request Lambda@Edge
  -> validate exact segment URI, query shape, GET and allowed headers
  -> conditional DynamoDB debit on this delivery's one ledger item
     -> success: continue through CloudFront authorization/cache/S3
     -> rejection, timeout or unknown outcome: empty 403/503, no media
```

The edge code must be associated with **every** behavior capable of reaching the
private media origin. The S3 bucket remains private behind origin access control;
no public S3 URL, second distribution, origin path, direct gateway segment route,
or alternate cache behavior may reach media without this gate. Signed URLs remain
exact-object, short-lived capabilities. Cache keys may still omit signed query
strings to share the immutable object cache; the viewer-request debit runs before
that cache lookup. The edge must not cache an allow decision, accept client-supplied
delivery IDs/byte counts, or serve stale media on a ledger error.

The first request-shape contract permits only an exact `.ts` path and full `GET`
with the signer's literal raw query form and order (`Expires`, `Signature`,
`Key-Pair-Id`). Percent-encoded or differently cased field names are rejected.
It rejects `HEAD`, `Range`, conditional headers, extra/duplicate query fields,
encoded path variants, and other methods. This eliminates multipart range
amplification and conditional/cache behavior from the initial payload proof.
Whether native Safari, Android and desktop HLS players can use this contract is
an explicit physical-device gate. CORS preflight and `OPTIONS` have no segment
body, but repeated rejected requests can still incur CloudFront/edge cost.

The current S3 adapter rejects a segment file larger than 32 MiB and uses
`IfNoneMatch: "*"` plus hash/length checks for immutable keys. The dormant
reservation proof separately declares and charges 32 MiB per accepted segment
GET; its constant is not linked to the uploader's literal today. A real edge
gate must pin and verify the immutable writer contract/version or use a shared
bound, and deny on version mismatch. The bound is safe only under a trusted
writer and the verified 32 MiB upload contract. A
different writer with `PutObject`, a mutable key, a behavior that transforms or
compresses content, or a response body larger than its stored object invalidates
the bound. The first release must prove the complete IAM/write path and immutable
cache behavior or enforce the size at a stronger boundary.

The fixed charge is too wasteful for a practical default. A two-second segment
at 2 Mbit/s is about 0.48 MiB, so 32 MiB charges roughly 67 times its body; at
5 Mbit/s it is about 1.19 MiB, roughly 27 times. A 128 kbit/s audio segment is
about 0.031 MiB, roughly 1,024 times. A 500 GiB allowance permits only 16,000
such reservations, about 8.9 viewer-hours at one request every two seconds.
The preferred optimization is exact immutable size metadata: publish and verify
the S3 object first, atomically insert an immutable key/size/digest catalog row,
and expose a signed URL only after that row exists. The edge reads the catalog
strongly and reserves that size plus a reviewed response-body overhead bound.
Catalog absence, mismatch, timeout, or mutation denies. This adds a read to every
request and still needs a hosted cache/object consistency proof.

## Ledger and closure semantics

One DynamoDB item is keyed by an operator-defined delivery ID, not a viewer ID or
URL. It is initialized out of band with `status=open`, a unique `generation`,
`remainingPayloadBytes`, and `remainingRequests`. The edge's generation is fixed
in its immutable function version. A single conditional `UpdateItem` checks
open status, generation and both remaining allowances, then decrements both. No
read-before-write or edge-local counter participates. DynamoDB serializes writes
to one item, so concurrent requests and repeated use of the same signed URL
cannot spend beyond the row's remaining allowance. Throughput throttling and
network failures deny delivery. The dormant command component passes an abort
signal to DynamoDB and returns denial after a finite deadline (default 1.5
seconds). A noncooperative client can still finish physically after the caller
has denied; any late debit is conservative overcount and must never become a
late allow. The single item may become a throughput/latency
bottleneck; sharding without an atomic parent ceiling would lose this guarantee.

The ledger row is never deleted or reset while any URL or in-flight request from
the delivery can exist. Closing it denies later reservations. A request that
reserved before closure may still finish; its full body bound was already
charged. If the write committed but its response was lost, or if the CDN/origin
subsequently failed, no refund occurs. SDK retries can conservatively double
charge; the edge should disable automatic retries or add a rigorously atomic
idempotency design, and always reject an unknown result. Old URLs crossing a
calendar boundary must continue charging the old delivery row or be denied; a
new monthly counter cannot silently inherit them. Delivery identity needs an
unambiguous path/distribution binding before any allowance reset or rollout.

Grant revocation stops new manifests but does not retract signed segment URLs.
The edge ledger can close a whole delivery; per-grant revocation needs a signed
grant/delivery binding visible at the segment gate or must wait for URL expiry.
If CloudFront validates signatures **after** the viewer-request function,
plausibly shaped but invalid signatures could consume allowance; even if it
validates first, replayed valid URLs can intentionally exhaust the allowance.
Both cases are availability and request-cost risks. A separate edge signature
verification would need exact CloudFront canonicalization and test vectors.

## Dollar exposure and release evidence

This payload reservation does not create a hard total AWS dollar ceiling. Costs
continue for warm ECS/Fargate, Lambda@Edge invocations (including denials),
DynamoDB attempts, CloudFront requests and error responses, S3 operations/storage,
origin transfer, API Gateway/Lambda manifests, logging, networking, and other
account resources. An attacker can make unlimited rejected/invalid requests; a
valid replay can burn the allowance early. CloudFront billing byte definitions,
regional rates, propagation and tax/discount effects also differ from this
body-count model. Budgets and alarms are delayed. Cost control remains a separate
owner-reviewed architecture/release decision; do not remove `RELEASE_BLOCKER`
on this prototype's evidence.

Before a staged enable, prove on an isolated distribution and actual devices:

1. Every cache hit/miss and allowed variant invokes the gate exactly once before
   a segment body, including signed-URL replay from different viewers/PoPs.
   Determine signature-validation ordering and handle malformed/expired URLs.
2. Exhaust and close the ledger under concurrent requests, retries, errors,
   revoked grants and propagated edge versions. Bound in-flight completion and
   verify all alternate methods, paths, behaviors and origin access are closed.
3. Measure player behavior without Range/HEAD/conditional requests; compare
   ledger reservations, CloudFront transfer/request metrics and billed usage.
   Verify production object-size metadata, cache behavior and immutable writes.
4. Review per-request edge/DynamoDB latency, hot-item throughput, regional
   failures, request-denial cost and the distinct total-dollar policy. Keep the
   existing physical-device, capacity and release gates.

`src/traffic-ceiling/request.ts` is an offline request-shape check and
`src/traffic-ceiling/reservation.ts` is a dormant DynamoDB command component.
Their tests exercise input rejection, the conditional command contract, a
linearizable concurrency model, finite abort deadline, and conservative unknown
outcomes. They do not
exercise CloudFront, DynamoDB's service implementation, S3, player cadence, or
real billing. No Terraform association, IAM grant, ledger table, deployment
entrypoint, or production call site was added.
