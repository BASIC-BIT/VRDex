# Shared media relay deployment

Status: off by default. This module is an isolated release candidate, not spending
or production enablement approval. Local image tests do not establish measured
Fargate source capacity, live VRCDN compatibility, or physical-phone playback.

## Topology and release gate

`infra/terraform/media-relay` has independent state and no event-publishing
switch, resource reference, renderer, Python package, or output ingest credential.
With `enabled=false` all relay resources have zero instances, including compute,
storage, logs, roles, HTTP API and CDN. There is no default release configuration.
Do not point its backend at the event worker state. The operator must provision
an independently reviewed backend key, for example `media-relay/terraform.tfstate`.
The checked-in module intentionally does not initialize a remote backend.

Current recommendation, controller approved: fixed slots, each an ECS Fargate
service with exactly one shared worker and a distinct predeclared worker ID and
epoch. Each worker handles multiple admitted sources. Convex authenticates against
`MEDIA_RELAY_WORKERS`, so interchangeable replicas cannot share an identity.
`warm_min == warm_max == workers.length` is mandatory. Each service uses deployment
maximum 100/minimum 0, bounding RUNNING/PENDING replacement capacity. STOPPING
tasks can retain processes during stop grace; physical cleanup and lease fences
remain necessary. Hosted replacement must measure duplicate-acquisition duration
and stale-publication rejection. This is not a physical zero-overlap guarantee. No dynamic
autoscaler is supplied until verified task enrollment exists. Provisioned aggregate
source capacity must exceed the global admitted-source cap to leave recovery room;
the precise spare fraction and warm count remain measured release inputs.

Private S3 stores immutable epoch objects. CloudFront OAC signs origin requests;
a trusted public-key group requires valid viewer signatures before serving cached
segments. Query strings, cookies and headers are absent from the segment cache
key. Gateway Lambda serves HTTP API v2 manifests, separately authenticates each
grant against Convex, checks committed snapshot bytes, and signs segment URLs.
DynamoDB stores native demand, not ownership. A missing health sentinel proves a
successful strongly consistent transport probe; transport failure denies new jobs.

Enabling requires the typed `release` object in `variables.tf`: immutable ECR image
digest, packaged gateway ZIP and base64 SHA256, control URL, separate existing worker
and gateway secret ARNs, signing secret ARN/public key, region, existing private
subnets/security groups with appropriate egress, allowed HTTPS origins, measured
allocation/evidence and per-slot caps, global source/grant/admission bounds,
gateway concurrency/request throttles, warm bounds and owner-reviewed traffic
estimate. Example values in mock tests are synthetic and are not release defaults.
No secret values, signing keys, credentials, network or paid services are created
by the packaging workflow. This module expects default AWS-managed Secrets Manager
encryption; customer-managed KMS keys need a separately reviewed scoped policy.

## Versioned environment contract

Worker and gateway consume `MEDIA_RELAY_CONFIG`, a JSON version-1 discriminated
contract in `providers/config.ts`. Absence means `{version:1,enabled:false}`.
Enabled configuration must contain all release fields. `credentialRef` is a
Secrets Manager ARN, never the credential itself. Only workers receive `binding`.
Secret retrieval is bounded and uses the task/Lambda role. Rotate the worker or
gateway token in its existing Secrets Manager value and matching Convex variable,
then restart the corresponding processes. Rotate CloudFront public key/key group
and signing-secret version together; allow the old five-minute URL window when
planning a compatible rotation. Lambda caches secrets for its process lifetime.

The Terraform `control_release` output names the exact separately applied Convex
variables: `MEDIA_RELAY_ENABLED`, `MEDIA_RELAY_MAX_SOURCES`,
`MEDIA_RELAY_MAX_GRANTS`, `MEDIA_RELAY_ADMISSIONS_PER_MINUTE`,
`MEDIA_RELAY_PLAYBACK_ORIGIN`, and `MEDIA_RELAY_WORKERS`.
The deployment owner additionally supplies distinct `MEDIA_RELAY_WORKER_TOKEN`
and `MEDIA_RELAY_GATEWAY_TOKEN` secret values to Convex. Terraform does not mutate
Convex. Keep Convex disabled until matching measured bindings and limits, packaged
artifacts, IAM, demand health, signatures and the release checks pass. Missing or
zero capacity never means unlimited. This switch is independent of event output.

## Provider and resource boundaries

- Direct owning-package AWS SDK dependencies use one attempt. Convex uses abortable
  fetch with bounded JSON; credentials, URLs, provider errors and request bodies
  never enter application logs. RPC publication uses the actual Convex transaction.
- Control/demand/snapshot reads have 1.5-second physical cancellation deadlines;
  storage writes/sweeps and initial secret reads have 4.5-second deadlines.
  Gateway responses retain their existing `<=2`-second budget. DynamoDB's store
  interface has no caller signal, so each actual transport has its own finite
  abort deadline. It does not detach an uncancelled promise.
- Uploads stream files, cap each segment at 32 MiB and snapshots at 128 KiB, and
  use conditional create. A cold repeated object checks stored digest and length;
  different bytes reject. A successful-upload LRU holds at most 16,384 digests
  (hard configurable maximum 32,768), expires entries after ten minutes, and
  never caches failed or uncertain writes. Rolling-window repeats avoid S3 calls.
- Retirement scans at most 1,000 objects each minute, deletes only objects older
  than ten minutes, and persists its continuation token after successful work
  in `_relay/retirement/<workerId>.json`. Each slot's role can touch only its own
  checkpoint. Young pages advance the cursor. Crash replay is safe. Multiple
  workers can harmlessly attempt the same expired deletes; lifecycle expires
  `vrcdn/` objects after one day as a longer backstop. Measure backlog and cost
  before raising caps; a sweep cannot promise ten-minute deletion completion.
- Worker IAM covers its media namespace, own checkpoint, demand reads and worker
  token. Gateway IAM covers media reads, demand reads/conditional updates, its
  own token and signing key. CDN can read only `vrcdn/`; checkpoints are neither
  signable nor accessible through the CDN. Execution roles have scoped ECR pull
  and log writes. No event credentials or wildcard secret access exist.
- CloudFront and HTTP API access logs are absent because they would include
  bearer paths/signatures. Lambda logs no event, and worker logs only bounded
  event kinds. Provider metrics remain available; log retention is seven days.

API Gateway throttles and Lambda reserved concurrency bound manifest load. They
**do not cap CloudFront bytes or dollars**, including replay of valid signed URLs
for at least five minutes. `trafficGiBPerMonth` is a reviewed estimate/gate, not
runtime egress enforcement. Already-issued URLs survive grant revocation for their
signed lifetime. Costs include fixed warm Fargate CPU/RAM, ephemeral storage,
Lambda requests/duration, HTTP API, DynamoDB operations, S3 objects/requests,
CloudFront requests/transfer, secret reads/storage and logs. Existing VPC/NAT or
endpoints, ECR, state backend, Convex usage, DNS, taxes and operational monitoring
are additional costs outside this module. No numeric production budget is claimed.

## Local packaging and checks

Use the repo's prepared Node 24/pnpm tools. Runtime reuses the reviewed Node 22
bookworm digest from the event worker; the new image installs only FFmpeg and CA
certificates. It runs as `node`, keeps the root filesystem read-only under ECS,
and mounts `/var/lib/media-relay` scratch storage. The Dockerfile initializes that
directory as `node:node` with mode `0750`, then declares the matching `VOLUME`.
The ECS mount uses the same path so volume initialization retains ownership. No event sources are copied. Build source hashes and
bundle hashes are recorded in `manifest.json`; esbuild metadata inventories imports.

```bash
source /workspace/vrdex-env.sh
node scripts/package-media-relay.mjs /tmp/vrdex-relay-package
/tmp/vrdex-relay-tools/terraform -chdir=infra/terraform/media-relay init -backend=false
/tmp/vrdex-relay-tools/terraform -chdir=infra/terraform/media-relay fmt -check -recursive
/tmp/vrdex-relay-tools/terraform -chdir=infra/terraform/media-relay validate
/tmp/vrdex-relay-tools/terraform -chdir=infra/terraform/media-relay test
BUILDX_CONFIG=/tmp/vrdex-relay-buildx env -u DOCKER_HOST -u DOCKER_CONTEXT -u DOCKER_TLS -u DOCKER_TLS_VERIFY -u DOCKER_CERT_PATH docker --host=unix:///var/run/docker.sock build --secret id=proxy_ca,src=/etc/ssl/certs/ca-certificates.crt -f workers/media-relay/Dockerfile -t vrdex-media-relay:task7 /tmp/vrdex-relay-package
env -u DOCKER_HOST -u DOCKER_CONTEXT -u DOCKER_TLS -u DOCKER_TLS_VERIFY -u DOCKER_CERT_PATH docker --host=unix:///var/run/docker.sock run --rm --name vrdex-relay-task7-smoke --cpus 1 --memory 2g --pids-limit 128 --read-only --mount type=volume,dst=/var/lib/media-relay --mount type=bind,src=/workspace/VRDex/workers/media-relay/smoke.mjs,dst=/smoke.mjs,readonly vrdex-media-relay:task7 node /smoke.mjs
```

The synthetic fixture mounts separately and exercises exports from the actual
image bundle. It generates local MP4, uses bounded control/object/demand fixtures,
checks two simultaneous sources, real aggregate cgroup observations, publication,
drain refusal, killed-child recovery, SIGTERM and owned-child cleanup. The fixture
uses a fresh anonymous volume with image-initialized ownership, asserts UID 1000
and mode `0750`, and uses the same exported scratch path as the enabled entrypoint.
It keeps the root filesystem read-only and supplies no writable tmpfs. No provider
credentials or source are used. `BUILDX_CONFIG` redirects only local buildx state;
Docker config/registry credentials/proxy remain unchanged and the CA is a build
secret mount, never an image layer. Use supported additional network permission
for Docker/socket tests; never switch to host networking or disable TLS.

## Rollback and eventual deletion

These are operator commands for a separately authorized release, **not executed
by Task 7**. Use the dedicated state/profile and reviewed release file. Never
reuse the event worker backend. To stop admissions, first set the chosen Convex
`MEDIA_RELAY_ENABLED=false` using its documented deployment wrapper. Explicitly
set each affected worker binding `draining=true` before planned replacement;
existing jobs need time to finish or reach idle grace. Local SIGUSR1 also drains,
but no remote exec channel is provisioned. Staged per-slot replacement stops old
before new and advances its configured epoch with matching Convex binding.
Cold start and takeover may exceed 30 seconds; uninterrupted replacement is not
claimed. Roll back image digest with a new epoch, not an old identity epoch.

For an authorized immediate compute stop, set each fixed service's desired count
to zero (record the drift until the next reviewed plan):

```bash
aws ecs update-service --cluster "$RELAY_CLUSTER" --service "$RELAY_SERVICE" --desired-count 0
```

For a reviewed image rollback, restore the previous image digest and gateway ZIP
hash in the release file, advance binding epochs, and review/apply only the relay
plan with matching Convex bindings. Full disable plans remove all module resources;
S3 deliberately refuses deletion while nonempty. After admissions/workers are
stopped, the URL grace has elapsed and deletion is explicitly authorized:

```bash
aws s3 rm "s3://$RELAY_BUCKET/vrcdn/" --recursive
aws s3 rm "s3://$RELAY_BUCKET/_relay/retirement/" --recursive
terraform -chdir=infra/terraform/media-relay plan -var-file=release.tfvars -var=enabled=false -out=relay-disable.tfplan
terraform -chdir=infra/terraform/media-relay apply relay-disable.tfplan
```

These delete commands are intentionally narrow to the relay bucket namespaces.
Review the plan's dedicated state and account before approval; never use targeted
destroy to bypass dependencies. Existing secret values, ECR image, network and
state backend are externally owned and require their separate retention/deletion
procedures. Local-only cleanup: `docker --host=unix:///var/run/docker.sock image rm
vrdex-media-relay:task7` after the named fixture container is absent, then remove
only the generated `/tmp/vrdex-relay-package` directory if no longer needed.

## Browser rollout and retained playback

`NEXT_PUBLIC_MEDIA_RELAY_ENABLED=false` is the web build default. Only an explicit
`true` build selects relay admission; deploy the backend functions and gateway
before enabling it. No relay RPC runs on page mount. A viewer's Play opens a
profile or event capability, polling the returned grant only during startup.
Both renditions use that same grant. All eligible VRCDN sources use this transport
when released; there is no owner opt-in. Native performer-sequence integration
retains the existing foreground following policy and current metadata authority.
Physical-device, hosted containment, capacity and traffic-budget acceptance remain
independent release gates.

The single root `EventPlaybackOwner` retains profile/event playback across routes.
The default mode is video. Audio preference uses `vrdex.playback-mode` in local
storage, with a memory fallback when storage is denied. Restoring preference never
autoplays. Native HLS is preferred; browsers without native HLS use the directly
declared, lazily imported `hls.js` MSE adapter. Neither native current rendition
connects to Web Audio. Switching unloads the inactive playlist, preserves the
media nodes and grant, and closes PiP when selecting audio. Returning to video
does not request PiP. Physical-phone behavior remains a release gate.

Rollback to the disabled client retains the saved preference. Audio selection is
blocked without loading full video; the viewer can deliberately select Video and
Play to use legacy foreground playback. Legacy playback has no background support
guarantee. Utility controls use existing approved labels. See the
[composed acceptance evidence](../engineering/evidence/media-relay-task12/README.md)
and [release proposal](../engineering/media-relay-verification.md).

`mediaRelayPlayback:refreshPlayback({grantId})` only renews an existing, unexpired,
unreleased, still-authorized capability. Server time governs expiry. The mutation
is an indexed bounded read and extends to twelve hours only within the last hour;
concurrent refreshes serialize and subsequent calls are no-ops for eleven hours.
It preserves the grant ID and playlist URLs and never creates or restarts a
source. The browser invokes it once per minute while visible and on foreground
return, with a single in-flight request. Native playlist activity, not this timer,
sustains worker demand. Context revocation is still enforced by the gateway.

Expiry is exact: a grant cannot refresh at or after `expiresAt`. A deliberate new
Play then uses ordinary admission rules. Valid grants may continue an event after
its start window, but an expired background session may be unable to start that
event again after its window closes. An independently public profile can still
admit its stream. No unconditional Resume guarantee is implied.

Deliberate Retry of an unexpired event capability uses
`mediaRelayPlayback:restartPlayback({grantId})`. It reauthorizes that exact grant
and context, retaining ID, issue time and playlist URLs across native-player
recreation. A healthy source needs no restart charge; a stopped/unavailable source
can be queued only under the existing source and admission limits. Terminal
unsupported remains Unsupported. Released/revoked capabilities cannot restart;
actual expiry sends deliberate Play back through ordinary new-start admission.
Neither playlist/read polling nor foreground refresh invokes this operation.

Successful terminal restarts share the rolling admission-per-minute budget with
new grants. A single indexed `mediaRelayRestartRate` row stores their timestamps,
prunes entries outside sixty seconds on the next successful restart, and is
bounded by the configured maximum of 10,000 admissions. Both new admission and
restart check recent issued grants plus this history transactionally. Concurrent
retries of an already-queued source do not consume another restart or grant slot.

## Persisted operator gate

The environment flag alone no longer enables relay work. The deployment-admin enable operation is checked-in blocked pending separately reviewed hard traffic/cost enforcement and current-integration release verification. Complete hosted measurements alone cannot enable it; PAYG acceptance and budget strings are rejected. Disable remains available without evidence. Empty operator state is disabled. See [verification and release controls](../engineering/media-relay-verification.md) for measured local evidence, the unapproved cost proposal, independent emergency stop, staging bootstrap and open disk/traffic gates.
