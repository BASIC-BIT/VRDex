# Relay verification and release controls

Status: local implementation verified; **hosted release blocked**. No production
region, budget, capacity, resource apply, credential creation or enablement is
approved. The default deployment and persisted operator gate are off.

## Run a bounded local proof

Activate the repository toolchain, then run:

```bash
node --import tsx scripts/media-relay-proof.ts --target local --sources 2 --bitrate 3000000 --duration 30 --deadline 45 --output /tmp/relay-proof
```

Omitting target selects local synthetic input. Unknown, duplicate, missing-value
or out-of-range options fail before acquisition. Sources are 1–8, video bitrate
64,000–8,000,000 bits/s, duration 12–120 seconds, deadline 1–180 seconds, keyframe
interval 2–120 seconds. Aggregate requested video payload is limited to 256 MiB.
AAC is 128 kbps; headers and audio are additional measured bytes. The child owns
its process group, has an independent deadline, and is forcibly killed if cleanup
exceeds deadline plus eight seconds. SIGTERM/SIGINT to the child requests cleanup.
Media cleanup ownership comes from proof-only executable wrappers recording PID
and start ticks before each generator/packager/probe exec, plus observed descendants.
The ledger fails closed above 1 MiB or 10,000 identities. Broad resource samples
(including loader services) do not confer media ownership; there is no process-name
filter. After the proof leader closes, the parent settles only its captured detached
group within the original cleanup deadline. Capture verifies direct-child parentage,
group leadership and start identity before retaining signal authority. Exited zombies
cannot execute; owned media identities still must disappear/reap for cleanup zero.

The real shared registry, lease watchdog, copy-only FFmpeg packager, publication
queues and immutable upload cache run against generated loopback H.264/AAC input.
The storage double sits below the production adapter's digest cache: PUT/GET/LIST
counts are actual calls reaching that double, **not AWS billed operations**.
HEAD/DELETE remain zero unless exercised. Successful callback count is separate
from actual PUT count. Audience bytes are fetched over loopback HTTP once per
new video/audio segment, followed by a separately counted replay. This models
transfer differences without claiming CloudFront hit ratios or native HLS cadence.
There are no AWS clients, provider stream requests or billing calls in this lane.

`evidence.json` records options, wall duration, actual source concurrency, cold
first-dual-rendition latency, warm dual-rendition recovery after a simultaneous
source disconnect, CPU/RSS, sampled scratch, literal `.tmp` and not-yet-playlisted segment peaks, pending publication
peak, transfer, operation/cache counts, failures and cleanup. CPU/RSS cover the
owned process tree **including synthetic encoders**, not an isolated Fargate
worker. CPU peak is a short sampling-window percentage of one core; it is not a
sustained capacity result. Kernel page/tick sizes come from `getconf`. Exited
children between samples can reduce observed totals. Filesystem samples can miss
short-lived writes. Initial segments may grow under `.ts` before a playlist
exists, so partial accounting includes both `.tmp` and segment files not yet
observed in any completed playlist. Timestamp warnings remain failures requiring investigation;
synthetic encoder termination logs are retained separately.

Pressure example (expected nonzero exit, readiness fails):

```bash
node --import tsx scripts/media-relay-proof.ts --target local --sources 2 --bitrate 8000000 --keyframe 60 --duration 12 --deadline 25 --output /tmp/relay-pressure
```

This measures input and resource use while completed video is withheld. Depending on FFmpeg buffering and sample timing, bytes may be held in memory and partial disk samples may be zero; a zero sample is not proof of a bound. The completed-object
32 MiB upload limit does not constrain `.tmp` growth. A 12-second run with a
60-second keyframe interval proves neither a 30-second bound nor arbitrary input
containment. Current `partialDiskBoundVerified` is always false. The worker now
samples its shared scratch root independently of playlist scanning every 100 ms.
The 256 MiB pressure threshold counts the larger of logical file length and
allocated blocks across up to 2048 entries, including unfinished `.tmp` files,
playlists, completed segments and concurrent attempts. A separate `statfs` sample
trips when the scratch filesystem reports 256 MiB or less in available blocks.
A threshold hit, scan
error, traversal overflow or filesystem `ENOSPC`, `EDQUOT` or `EFBIG` promptly
fences all active jobs, drains new admission and begins child teardown. The
`scratch_pressure` metric records this without media diagnostics. A stalled
cleanup remains quarantined and retains its lease until expiry; physical reaping
is confirmed only when cleanup succeeds. A stalled publication callback cannot
hold up this watchdog. Source metadata echoed in FFmpeg stderr cannot trigger
worker-wide pressure. Active attempts in one worker process share a single
sequential root scan, so the scan does not multiply with source count. Its
2048-entry traversal ceiling is an operational limit requiring scale evidence.

These are sampled pressure trips, not physical quotas: writes can exceed a
threshold between samples, and task image layers, filesystem metadata and other
task writes are outside the file accounting. `statfs` free blocks may reflect
the backing filesystem rather than an isolated attempt limit. The anonymous ECS scratch volume uses
Fargate task ephemeral storage. That task-level physical capacity includes image
and other task storage and offers no isolated per-attempt quota. No supported
nonprivileged per-volume hard quota was established offline. Hosted release
remains blocked until an enforceable physical containment design is selected and
verified for the actual ECS storage mode, absent keyframes, sustained maximum
bitrate and stalled uploads. Memory, inbound byte/rate containment and
shared-worker recovery margin and monitor cost also need isolated measurement.

`--target hosted` currently rejects before any I/O. No hosted resources have been
selected or authorized. Local evidence is deliberately ineligible for enablement.

## Operator authority and effective gates

`mediaRelayOperations:drainWorker({workerId})` and
`mediaRelayOperations:setRelayEnabled({enabled})` are **internal mutations**.
Only deployment-admin tooling may invoke them. They have no public owner role,
service credential argument or new operator token. Impersonated user identity
is rejected even on an internal invocation. Worker/gateway tokens cannot replace
deployment-admin authority. No operator route publishes event output.

```bash
node --import tsx scripts/media-relay-control.ts --target local disable
node --import tsx scripts/media-relay-control.ts --target dev drain slot-0
```

These examples select environments explicitly through the same `convexTargetEnv`
implementation as `pnpm cx`. Unknown targets, environment override flags, extra
credentials and missing targets are rejected. Commands resolve existing bindings;
they never create credentials. `enable` is deliberately unavailable through a checked-in release blocker. The operator CLI does not deploy/push functions.

Effective availability requires **both** `MEDIA_RELAY_ENABLED=true` and persisted
`mediaRelayOperations.enabled=true`. An empty database stays disabled even if
ENV is true. ENV false always wins. Admission, existing grant resolution/gateway,
worker discovery, claims/renewals and publication consult the persisted gate.
Disable is idempotent; lease expiry/watchdogs provide eventual source shutdown.
Previously issued CDN URLs can continue serving cached segments until expiry;
disable is not instantaneous CDN revocation or a byte/dollar stop.

Drain persists outside worker observations, denies new claims and preserves
existing valid renewals. It is one-way for that worker ID in this interface;
worker restart/epoch changes do not erase it. Restoring a drained ID requires a
separately reviewed operator-state migration, rather than a worker clearing its
own drain. Disable remains available without evidence or worker configuration.

Enable reads `MEDIA_RELAY_RELEASE_EVIDENCE` from server configuration, never from
the request. `HostedMeasurementsSchema` preserves future hosted measurement and
capacity validation: exact deployment, at most seven-day age, allocation evidence
IDs, CPU/memory headroom, disk/partial-disk physical bound, queue and traffic
measurements, startup/recovery, remote operations, cleanup and timestamp checks.
Global capacity must survive loss of the largest available slot; drained slots
contribute no recovery capacity and worker IDs must be unique across epochs.
Passing those checks still throws the checked-in `RELEASE_BLOCKER`.
`ReleaseEvidenceSchema` rejects every release record while implementation and
verification gates remain open. PAYG acceptance, a budget, an approval reference,
or a new schema field cannot lift this block. There is no environment or CLI
override. Release requires separately reviewed hard traffic/cost enforcement and
current-integration verification, followed by a reviewed code change to the gate.
The previous PAYG proposal was not approved and is not accepted release evidence.

The deployment operator owns this nonsecret JSON setting and the persisted state.
Recreation/rotation means review fresh evidence, set it through the selected
`pnpm cx <target> env` workflow, then separately review enablement; no secret value
or account identifier belongs in source control. There is no evidence or approval
configured by this change. The worker/gateway/signing secret owners and rotation
remain as documented in [deployment](../deployment/media-relay.md).

## Noncircular staging evidence path

First approve a **standalone staging benchmark task**, its region, allocation,
source fixture, private scratch/storage resources, finite lifetime and maximum
spend. Its local control fixture can exercise the real registry without opening
public admission or requiring the persisted production gate. Isolate source
encoding from the worker cgroup; run the same cases at increasing source counts,
then a recovery storm, failed storage and delayed/missing keyframes. Measure
worker cgroup CPU/memory, physical scratch quota, provider operations/retries,
network bytes and cleanup on the selected allocation. A separate gateway/native
playlist benchmark supplies real demand writes, Convex authorization calls,
cache hits and audience cadence. These hosted harness bindings are not implemented
or authorized here. Review the measured record and inventory before installing
release evidence. Public enablement is the last step, never a prerequisite to
collecting capacity evidence. Physical-phone acceptance remains separate.

## Owner-reviewable cost proposal

**Recommendation for review only:** us-east-1 Linux/x86, two fixed worker slots,
2 vCPU / 4 GiB each, one ECS task per slot, `warm_min=warm_max=2`,
stop-before-start max 100% / min 0%. Candidate global source cap 2 and per-slot cap
2 leave one-slot recovery space. These are proposed limits to validate, not a
capacity claim from the local host. A cheaper comparator is two 1-vCPU/2-GiB slots ($72.08/month compute). The isolated hosted benchmark must choose between these allocations; the generator-inclusive local peak does not establish that 2 vCPU is necessary. No dynamic enrollment/autoscaling exists;
cold ECS replacement has no measured 30-second or uninterrupted-release promise.

Candidate admission settings: 20 active grants, 10 admissions/minute, gateway
reserved concurrency 4, HTTP API rate 20/s and burst 40. The API limits are
best-effort load targets. Candidate traffic forecast 500 GiB/month is an estimate,
not an enforced allowance. Candidate budget **$300/month**, with delayed alerts
at $150/$225/$270 and an on-call disable review at $270. None are approved.

Official regional rates were retrieved 2026-10-29 from the public AWS Price List
(`AmazonECS`, `AWSLambda`, `AmazonApiGateway`, `AmazonDynamoDB`, `AmazonS3`,
`AmazonCloudWatch` us-east-1 offers; global `AmazonCloudFront` offer). Official sources: [ECS](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonECS/current/us-east-1/index.json), [Lambda](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSLambda/current/us-east-1/index.json), [API Gateway](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonApiGateway/current/us-east-1/index.json), [DynamoDB](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonDynamoDB/current/us-east-1/index.json), [S3](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonS3/current/us-east-1/index.json), [CloudWatch](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonCloudWatch/current/us-east-1/index.json), [CloudFront](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonCloudFront/current/index.json), [Secrets Manager](https://aws.amazon.com/secrets-manager/pricing/) and [VPC](https://aws.amazon.com/vpc/pricing/).
No authenticated account/pricing calls or free-tier assumptions were used.

| Item                        | Rate / illustrative monthly amount                                                                       |
| --------------------------- | -------------------------------------------------------------------------------------------------------- |
| Fargate x86                 | $0.04048/vCPU-hour + $0.004445/GiB-hour; two 2-vCPU/4-GiB tasks at 730 hours = $144.16                   |
| Extra ephemeral storage     | $0.000111/GB-hour above included 20 GB; none proposed yet                                                |
| Single-AZ NAT + public IPv4 | $32.85 + $3.65 = $36.50 fixed, plus $0.045/GB processing; not evidence that an existing NAT is suitable  |
| Secrets storage             | Three existing separately scoped secrets: up to $1.20/month fully allocated, plus $0.05/10,000 API reads |
| HTTP API                    | $1/million requests in first tier                                                                        |
| Lambda x86                  | $0.20/million + $0.0000166667/GB-second in first tier                                                    |
| DynamoDB on demand          | $0.625/million WRU, $0.125/million RRU, $0.25/GB-month; actual item size/consistency matters             |
| S3 Standard                 | $0.023/GB-month; PUT $0.005/1,000; GET/HEAD $0.0004/1,000; DELETE free                                   |
| CloudFront NA PAYG          | $0.085/GB first 10 TB; HTTPS $1/million; geography and later tiers change rates                          |
| CloudWatch                  | $0.50/GB log ingestion + $0.03/GB-month storage; alarms/metrics extra                                    |

Illustrative demand: 100 active source-hours/month, 1,000 viewer-hours comprising
100 hours video at 3 Mbps and 900 hours AAC at 128 kbps, two-second segments,
North American viewers. Audience media is 186.84 billion bytes = 174.01 GiB;
approximately 1.8 million segment requests gives **$16.59 CDN**. This excludes
replay, retries and prefetch. Audio-only still fetches full upstream input.

At one playlist request per two seconds, 1.8M gateway requests add $1.80 HTTP API.
Assumed 50 ms billed Lambda duration at 256 MiB adds about $0.74 including request
charges; this duration is an assumption awaiting measurement. A conservative
1.8M one-unit demand writes plus reads costs $1.35, before worker queries and
health reads. At two segment and two snapshot PUTs every two seconds, 100 source
hours imply 720,000 PUTs ($3.60); 1.8M snapshot GETs plus 360,000 segment origin
GETs add $0.864. These operation forecasts are distinct from measured local
adapter counts and must include retries, retirement checkpoints and actual native
cadence before release.

Private-subnet upstream plus S3 egress through NAT could process roughly 267.5
GiB at this duty cycle (~$12.04), before other API traffic/cross-AZ charges.
An existing S3 gateway endpoint could reduce this; no endpoint is assumed or
created. Fixed compute/NAT/secret storage is about USD 181.86 (144.16 + 36.50 +
1.20); the above illustrative variable items bring it to about USD 218.84, plus
logs/storage and unpriced account-specific services. Reserve $30 provisionally
for gateway outbound transfer, ECR, Convex, DNS, monitoring and state, then validate
those costs rather than treating the reserve as a rate. No taxes, discounts,
credits or account free-tier eligibility assumed. Calendar hours vary.

### Open traffic and budget decision

Current signed, cached CloudFront URLs can be replayed without gateway accounting.
Admission, source/object-size limits, Lambda concurrency and API throttles do not
provide a global CDN byte cap. Billing alarms/Budgets are delayed and are never a
hard dollar stop. No total-relay traffic/dollar ceiling is implemented.

The [candidate per-delivery reservation design](media-relay-traffic-ceiling.md)
has offline tests but is not connected to CloudFront. It would bound reserved
segment payloads, not total AWS charges.

The approved hard-ceiling requirement remains binding. The following historical
options are proposals only; neither is an accepted enable path:

1. Accept PAYG replay exposure explicitly, with the reviewed budget/alerts and
   incident response, and approve the resulting specification tradeoff. This is
   the only currently supported topology; it does not meet a strict hard ceiling.
2. Keep release blocked and commission enforceable viewer-delivery accounting or
   a separately reviewed flat-rate design. Current CloudFront Pro lists $15 per
   distribution, 50 TB and 10M requests/month with no included-service overage;
   allowances are soft and delivery may be adjusted. About 5,556 viewer-hours at
   one two-second segment request consumes 10M requests before extras. It excludes
   worker/gateway/DynamoDB/S3 request/NAT charges. Account eligibility is unknown.
   AWS provider 5.100 cannot represent its plan lifecycle. A separate documented
   PricingPlanManager workflow/provider review would be required; paid approval
   starts commitment, cancellation is effective next billing period, and deleting
   a distribution does not cancel a plan. No subscription, upgrade or workflow
   was added. This alternative still is not a hard total-relay dollar cap.

## Emergency stop, rollback and teardown proposal

After explicit target/resource approval, the deployment admin can execute
`node --import tsx scripts/media-relay-control.ts --target prod disable` and then
`pnpm cx prod env set MEDIA_RELAY_ENABLED false` as the independent deployment
kill switch. Preserve evidence and check leases/worker child cleanup. Request
CloudFront disable only against the inventoried distribution and current ETag;
propagation and existing signed URLs prevent an instantaneous traffic stop.

For staged releases, drain one known slot, wait for its source work to finish or
explicitly disable for interruption, then review the image-digest/binding change.
Stop-before-start can interrupt service. Roll back the image/config through the
same reviewed infrastructure pipeline while the gate remains off. Do not clear a
persisted drain or re-enable on worker restart alone. Validate fresh evidence
before a separately approved restoration.

For deletion, first disable admission and delivery, scale down the approved
worker slots through the reviewed configuration, and inventory S3 objects,
retirement backlog, ECR images, logs, DynamoDB, secrets and Terraform state.
Run `terraform -chdir=infra/terraform/media-relay plan -destroy` only with the
explicitly selected approved workspace/credentials. Review deletion scope before
execution; the bucket has `force_destroy=false` and may require an approved
bounded deletion after retention. Externally owned secrets/shared NAT/endpoints
must not be deleted with the relay. If a pricing plan is ever subscribed, cancel
it separately and account for its remaining billing period. No teardown or
provider mutation was performed in Task 11.

## Offline checks and transport handoff

```bash
node --conditions=import --import tsx --test tests/scripts/media-relay-proof.test.ts tests/backend/media-relay-operations.test.ts
node --conditions=import --import tsx --test tests/scripts/media-relay-config.test.ts tests/backend/media-relay-admission.test.ts tests/backend/media-relay-control.test.ts
pnpm --filter @vrdex/media-relay test
pnpm --filter @vrdex/media-relay typecheck
pnpm exec tsc --noEmit --project convex/tsconfig.json
terraform -chdir=infra/terraform/media-relay test -json -verbose > /tmp/relay-plan.jsonl
node --import tsx scripts/verify-media-relay-plan.ts /tmp/relay-plan.jsonl
```

Terraform uses the existing mock provider and **plan only**. Structured
`runtime_config_review` is the same producer passed to ECS/Lambda `jsonencode`.
The verifier fills only identified unknown bucket, distribution origin and
signing-key ID leaves with explicit fixtures. Unknown policy fields or binding
substitutions fail. Terraform and runtime both reject 21 origins and invalid
allocation evidence IDs. The checked-in plan fixture records those actual
producer values, not a separate hand-built deployment schema.

Canonical local generation and public HTTP invisibility are exercised by the
[complete-flow acceptance record](./evidence/media-relay-task12/README.md).
To reproduce against an isolated local backend, POST
`/api/mutation` with `{ "path": "mediaRelayOperations:setRelayEnabled",
"args": { "enabled": false }, "format": "json" }`, first anonymously and then
with synthetic worker/gateway service credential arguments (the relay RPC
credential channel); repeat for `drainWorker`.
Require an error response identifying absence of a public callable function and
no state mutation; record the backend's actual HTTP status/error code. Then verify
an explicitly selected local deployment-admin CLI can disable. `convex-test`
internal calls and metadata assertions do not establish this transport behavior.

## Complete-flow acceptance and evidence provenance

The [Task 12 evidence](./evidence/media-relay-task12/README.md) binds the composed
handlers, real media pipeline, browser observations and final packaged artifacts.
Task 11's archived capacity captures predate the three-target-duration readiness
policy. Their partial disk and transfer observations remain historical local
measurements; their cold/warm timings are not current playable-startup timings.
The proof now measures readiness only after both qualifying rendition windows;
the normal local run uses thirty seconds to allow cold startup and recovery.

## Remaining release actions

The local proof does not authorize deployment or enablement. Complete these
independent steps in order; each has a reviewable target and evidence record:

1. Owner chooses the [cost and deployment proposal](#owner-reviewable-cost-proposal)
   and explicitly resolves PAYG exposure versus enforceable delivery accounting
   or a separately approved flat-plan lifecycle. Forecasts and delayed alerts are
   not hard traffic or dollar limits.
2. Review a staging-only benchmark allocation with exact account, region, image
   digest, worker slots, source caps, storage quota, deadline and cleanup plan.
   Prove physical scratch/buffer limits, pressure behavior, remote operations,
   measured source capacity and one-slot recovery margin before public admission.
3. Run the physical-device matrix below using the selected staged targets and
   reviewed grants. Archive observed results before deciding on small-cap rollout.
4. Review enable evidence and rollback together. Keep independent persisted and
   environment kill switches, worker drain, stop-before-start image rollback and
   bounded CDN capability expiry. Eventual eligibility covers all VRCDN streams;
   it does not add owner opt-in or background lineup following.

### Physical-device run sheet

For each actual iPhone Safari and Android Chrome device, record model, OS/browser
build, network, start/end timestamps, source and worker epochs, grant expiry and
cleanup. Capture audible observations separately from screenshots and counters.

- [ ] Thirty-minute screen lock in Video and Audio only, with audible progress.
- [ ] PiP, video/audio toggles, hardware volume and headphones; lock-screen
      play/pause must control the retained current owner.
- [ ] Wi-Fi/cellular changes, source reconnect and worker takeover; metadata
      follows the current DJ and original profile images remain unchanged.
- [ ] Grant expiry, copied grants, event-only revocation and closed client cleanup.
- [ ] Healthy overtime, late next source, pause/mute, manual selection and blocked
      promotion preserve the existing foreground following and gesture policy.
- [ ] Final source/worker stop and resource inventory agree with the cleanup plan.

These boxes remain unchecked. Chromium viewport screenshots, MSE playback and
separate HTTP demand polling cannot complete physical-device acceptance.

## Independent review corrections and retained-state limit

See [independent review evidence](media-relay-independent-review.md) for six-section
and interface coverage, correction dispositions and remaining release gaps.
Terminal failure fences publication immediately. Ownership-clearing observation
waits for physical attempt setup and stop to succeed; pending or rejected cleanup
retains local quarantine and the backend lease until its natural expiry. Native
failure/retry remains fail-closed; no polling-based restart is added.

AUTH-02 is deferred maintenance: terminal sources retain their full last rendition
windows indefinitely. This grows with lifetime distinct sources, despite active
source and per-window bounds. Before raising release scale, implement bounded
retirement to compact durable epoch/sequence/discontinuity continuity tombstones.
Do not delete source rows or reset their fencing history as a shortcut.

Baseline CI now runs the relay package typecheck and full tests, plus Terraform
`init -backend=false`, `validate` and mock-provider `test`. These checks use no
provider credentials, plan/apply workflow or deployment authority. Terraform mock
runs contain synthetic plans; they do not exercise cloud providers.
