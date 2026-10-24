# Event worker diagnostics and compute estimates

The authorized media-control query exposes latest worker diagnostics to both
managers and operations readers. Public event, host and share-card projections
contain no resource readings or compute estimates. Diagnostics do not affect
media intent, publication health, dispatch admission or worker sizing.

## Collection and freshness

`createResourceSampler({allocation, readCounters, clock})` uses the immutable
allocation validated against ECS task and container metadata before publication.
Its asynchronous `sample()` never rejects. Synchronous `latest()` returns the
last completed observation with its current monotonic age. `reset()` invalidates
in-flight completion, sequence and baseline when a worker stops or changes epoch.
Only one counter read can be pending, including across reset.

The worker checks the ten-second sampling deadline through its existing watchdog
and control ticks. Collection never joins startup, renewal, renderer or control
promise chains. Only the existing ten-second `renewSession` request carries the
latest optional sample. There is no extra RPC, timer, frontend poll, AWS metrics
request, billing API call, resource history table or per-sample audit event.

The reader uses container cgroup totals, including Node, Python, decoders,
remuxers, encoder and senders. cgroup v2 `cpu.stat` `usage_usec` is converted to
nanoseconds; v1 uses `cpuacct.usage` nanoseconds. Memory is `memory.current` or
`memory.usage_in_bytes`, in bytes including page cache. Each measurement can be
unavailable independently. Unsupported reads, resets and malformed counters
remain nonfatal. Initial CPU is unknown; initial memory and actual zero values
can be known. CPU divides cumulative usage by the actual monotonic elapsed
measurement window and allocated vCPUs. One core on four allocated cores is 25%.

Sample age starts when collection begins, so delayed IO does not make old data
look new. CPU windows use collection completion times. The server derives
`resourceObservedAt = receiptTime - sampleAgeMs - 3000` using the conservative
three-second request allowance. It discards samples already 30 seconds old,
invalid values, unsafe or non-increasing sequences, backward observation times
and reports from the wrong worker, session, program, event or epoch. New epochs
clear observations. Ordinary heartbeats and repeated reports cannot refresh them.
Malformed optional telemetry is parsed inside renewal after core authentication,
so it cannot reject a valid lease through strict argument validation.

The operator projection includes `observedAt`, `sampleSequence`, `windowMs`,
`sampleAgeMs`, `staleAfterMs` and `fresh`. At 30 seconds, CPU and memory become
unknown; immutable allocation, destination formats and compute pricing remain
available. Consumers must advance age from `serverNow` plus local monotonic
elapsed time even without a reactive query update. The three encoded identity
fields are exact stored observations: `observedSourceRevision`,
`observedSlotKey` and `observedOutputMs`.

## Trusted price provenance

The authenticated dispatch registration records `computeRuntime` only when its
region matches both actual returned task ARN and registered definition ARN,
including their account. The bridge owns the underlying configuration:
`taskDefinitionFor` registers Linux `X86_64`; `runTask` explicitly selects
`--launch-type FARGATE` with no capacity-provider strategy, which selects
On-Demand. Generic Fargate runtime metadata alone does not establish a purchase
model. Legacy sessions without these explicit facts keep an unknown estimate.
Worker allocation is the immutable session/task/container shape, never host CPU
count, utilization or a client-supplied resource override.

Terraform owns the existing `VRDEX_EVENT_MEDIA_ECS_REGION` and worker `AWS_REGION`
values in `infra/terraform/restream-worker/bridge.tf`; deployment operators
recreate those through the stack. The checked-in bridge owns OS, architecture and
launch type. Recreating a dispatch records provenance through the same handshake;
there are no new environment variables or dashboard-only settings. A future
Spot, ARM, Windows or regional deployment must add explicit provenance and a
reviewed dated rate before an estimate becomes available.

`broadcast-rates.mjs` is pure and uses the October 22, 2026
[AWS Fargate pricing reference](https://aws.amazon.com/fargate/pricing/):
Linux/x86, us-east-1, On-Demand, USD 0.04048 per vCPU-hour and USD 0.004445 per
GiB-hour. Four vCPUs/eight GiB cost approximately USD 0.19748/hour;
eight vCPUs/sixteen GiB cost USD 0.39496/hour. Equal allocations have equal
estimates at 0% and 100% utilization. The returned object contains only
`usdPerHour`, `rateDate`, `currency: "USD"` and `scope: "cpu_memory"`.

Estimates exclude transfer, IPv4, logs, extra storage, provider subscriptions,
taxes and discounts. They are compute estimates, not account invoices or budget
stops. Unknown region, OS, architecture, purchase model or allocation returns
no estimate. No invoice, account identifier, credential or secret is returned.

## Verification and actual-image handoff

The resource and pricing backend tests use explicit trusted unit allocation
shapes and fake IO boundaries, without changing the empty production capacity
map. They exercise real Convex renewal/query mutations and the production worker
controller with fake media. Deferred and rejected counter reads must preserve
renewal, encoded progress, Cut acknowledgement and terminal Stop. The packaging
manifest includes sampler and timing policy plus relative import closure. The
pure rates module is bundled by its Convex consumer, not copied unused into the
worker image.

The actual final-image counter-failure proof remains a separate required gate.
The owner can inject `readCounters: async () => { throw Error("counter failure"); }`
into `runEventWorker`, leaving the real renderer, input and output implementations
intact. A direct `createEventWorker` harness must also pass the existing
`createManagedAllocationValidator({expected, metadata})` as
`validateConfiguration`; its returned validated allocation enables sampling.
Synthetic fixtures without that validator do not collect host counters. Start from the final reviewed packaged image and
actual validated allocation; retain continuous output evidence, successful
manual Take/Cut receipts, encoded progress and Stop publication fencing while
counter reads fail. Retain exact image inventory, source commit and command logs.
There is no production failure-toggle environment variable. Host tests do not
establish media, task-capacity or final-image acceptance, and changed worker bytes
require repeating affected exact-image proofs.
