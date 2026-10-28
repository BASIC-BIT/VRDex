# Task 7 report

Status: DONE_WITH_CONCERNS. Isolated disabled deployment, concrete provider bindings,
packaging, focused tests and actual-image proof are complete. Production capacity,
provider deployment, budget and physical-phone gates remain intentionally unmeasured.

## Delivered and controller decisions

- `infra/terraform/media-relay` is independent from event publishing and defaults
  to zero instances of every relay resource. Terraform1.10.5, aws5.100.0 pinned by
  the generated provider lockfile; only backend=false initialization and mock
  PLAN tests ran. No apply, hosted mutation, credentials, tunnel or paid resource.
- Controller-approved fixed worker slots: one ECS Fargate service/task per exact
  predeclared ID/epoch, maximum100/minimum0 deployment, equal warm minimum/maximum.
  This honors existing Convex authenticated bindings. Dynamic autoscale needs
  verified enrollment; source sharing remains per worker. Aggregate measured caps
  must exceed the global cap. No cold-start or uninterrupted-replacement claim.
- Private S3 with public blocking/encryption/ownership and lifecycle; CloudFront
  OAC, trusted public-key group and cache excluding signing query parameters;
  Dynamo native demand; Lambda HTTP API v2 manifest gateway. Access logs omit
  raw capability paths/signatures by being disabled; worker emits only event kinds.
- Per-slot worker roles permit media operations, own persisted retirement cursor,
  demand reads and worker-token secret. Gateway has read-only media plus native
  demand updates and separate gateway/signing secrets. Execution role has ECR/log
  access. No event output credentials, Python, renderer, or AWS CLI in the image.
- Version1 JSON environment schema defaults disabled and fails closed for missing
  release data. Terraform validates finite caps, evidence, unique IDs, warm bounds,
  valid Fargate allocation pairs, existing secret references and immutable image.
  `control_release` emits exact matching Convex variable names, including grant and
  admission limits; configuring that separate service remains an operator step.
- Focused server-only adapters bind the actual worker and gateway factories.
  Convex RPCs use abortable bounded fetch and authoritative commitSnapshot mutation.
  Direct SDK dependencies belong to media-relay. Single-attempt AWS calls have
  physical cancellation; response streams explicitly cancel after headers too.
  Secrets are fetched by reference, bounded and never logged.
- Immutable uploads have a32MiB segment/128KiB snapshot limit, conditional-create
  plus digest/length conflict checks, and bounded successful-upload LRU16,384
  entries/ten-minute expiry. Failed/uncertain writes are never cached. Cold retries
  still verify S3; rolling-window repeats skip remote calls after known success.
- Retirement is one bounded1000-key page/minute, ten-minute age eligibility, with
  durable per-worker S3 checkpoint and one-day lifecycle backstop. A scoped list
  probes checkpoint existence before GET, avoiding S3 missing-object403 under
  prefix-restricted ListBucket permissions. Fresh pages advance progress and a
  new adapter resumes the saved cursor. Gateway/CDN cannot access/sign checkpoints.
- Deployment docs include costs included/excluded, non-enforced CDN traffic
  estimate, per-slot drain/epoch replacement, exact rollback/deletion commands and
  environment/secret rotation ownership. Spec recommendation records fixed slots.

## RED/GREEN and self-review

Observed failing behavior before implementation for bounded streamed JSON,
composed cancellation, demand transport health/cancellation, retirement pagination,
disabled config, successful immutable-upload caching and cache capacity, durable
cursor reload, scoped checkpoint existence probe, and cancellation of an already
open response body. Terraform privacy test first failed against a false output.
RPC mapping and packaged entrypoint checks were integration verification, not
separately observed RED tests for every wiring helper.

Corrections during verification:

- Initial restricted tsx test emitted only sandbox failure; authorized additional
  network permission exposed expected RED assertions. No policy bypass used.
- Default Docker buildx state path was read-only. `BUILDX_CONFIG` now points to a
  task-specific `/tmp` directory; DOCKER_CONFIG, proxy, credentials and CA remain
  unchanged. The inherited local socket was healthy28.4.0/vfs. No daemon restart.
- First actual image exposed copied0600 bundles unreadable by `node`; Docker COPY
  now explicitly uses0444. ZIP entry uses0644 and normalized timestamp. Synthetic
  PID-recording wrapper needs executable scratch, supplied only in fixture run.
- Terraform HCL nested one-line syntax and computed-plan IAM assertion were fixed;
  secret policy is separately inspectable in the plan. All final tests are PLAN.
- Mock S3 streaming body was corrected to a real readable byte stream. A hanging
  regression was replaced by a bounded100ms assertion, observed RED, then fixed.
- pnpm initially re-resolved unrelated docs/agent peer graphs. Final lockfile
  preserves every original entry and adds only the relay importer and26 required
  snapshots plus metadata. Frozen offline install passed, with zero downloads.
  Two temporary merge-script formatting errors were corrected before that pass.
- Final self-review found S3 body cancellation after response headers and missing
  checkpoint403 behavior; both received focused regression coverage and rebuild.

A final wiring review removed an unnecessary boot comparison between per-slot
capacity and the smaller global admission cap. Spare measured slot capacity may
legitimately exceed admitted load; Convex still enforces the global cap. The image
was rebuilt and its complete synthetic proof repeated after this correction.

## Verification commands and results

All Node commands source `/workspace/vrdex-env.sh` (development Node24/pnpm10.15.1).
Docker and process/socket tests used supported additional network permission.

1. `/tmp/vrdex-relay-tools/terraform -chdir=infra/terraform/media-relay init -backend=false`:
   exit0, aws5.100.0 signed provider installed. Terraform binary was controller
   checksum-verified against the official1.10.5 release before this task.
2. Terraform `fmt -check -recursive`, `validate`, `test -no-color`: exit0;
   **6/6 mock plans** (disabled, missing release, enabled private/scoped, unequal
   warm bounds, duplicate identity, zero capacity).
3. `pnpm --filter @vrdex/media-relay test`: **70/70 passed**,23.8s. Existing
   registry/gateway/packager/publication/recovery suites plus provider tests.
   Later checkpoint scoping and stream cancellation changes reran the complete
   focused provider file: **9/9 passed**. No broad repo suite ran.
4. `pnpm --filter @vrdex/media-relay typecheck`: exit0, including final adapters.
5. `pnpm install --offline --frozen-lockfile --ignore-scripts`: exit0, no downloads.
6. `node scripts/package-media-relay.mjs /tmp/vrdex-relay-package`: exit0.
   Actual gateway bundle returned400 for malformed event and503 when disabled;
   actual worker image default command exited0 with `--network none`.
7. Docker build with explicit local socket, session combined CA build-secret and
   preserved proxy: exit0. Exact commands are in `docs/deployment/media-relay.md`.
8. Actual-image fixture command in that runbook: exit0. It generated only local
   synthetic MP4 and injected bounded control/object/demand fixtures into the
   exported factories from `/app/worker.mjs`. Maximum simultaneous upstreams2;
   **25 committed snapshots,52 stored objects**; third source refused after drain.
   Owned FFmpeg SIGKILL recovered with discontinuity; SIGTERM stopped the worker,
   **3 child PIDs reaped**, zero live upstreams and zero attempt directories.
9. Image inspected with no network: manifest SHA matched actual worker bytes,
   `/app` contains only `worker.mjs` and `manifest.json`, runtime Node22.23.4,
   no `/usr/bin/python3`, `/usr/bin/aws`, or build-secret CA file. Named fixture
   container absent after `--rm`. `git diff --check`: exit0 after EOF cleanup.

Actual image proof registered the declared synthetic1024CPU-unit/2048MiB allocation
under Docker `--cpus 1 --memory 2g`. Final real cgroup observation: sequence2,
window994.008894ms, age1006.283792ms, CPU47.9346817595%, memory71,479,296B. These
aggregate local readings are **not a measured production source cap**.

## Final artifacts

- Reviewed reused base: `node:22-bookworm-slim@sha256:de170b39439eb0e5a3444ad7d60b015614a381e10fecae2e30ec9e735122f38d`.
- Local image `vrdex-media-relay:task7`:
  `sha256:743a16151ad9009a6c6ab36b36a32e4d03364b1a14042f75b04cb09edb3ab26c`;
  size695,476,738 bytes; user`node`. No registry push/digest claim.
- Worker bundle SHA256:
  `f1ff67cf8649487ff42268df02a1bf436b2fb00cb36d5010f63cd671ab1857d5`;
  3,381,736 bytes,1149 inventoried source inputs.
- Gateway bundle SHA256:
  `74dc01d38f3268cd9ffd6d35769955d05c9c4f0aa76fed07d0e887c2d5056bc7`;
  3,341,039 bytes,1143 inventoried source inputs.
- Gateway ZIP base64 SHA256:
  `AYobdIyfb/DiKTNeG8OZ5r4TD9En1qiwpYtq9GN/07k=`.
- Generated local evidence: `/tmp/vrdex-relay-package/{manifest.json,worker.meta.json,gateway.meta.json,gateway.zip}`,
  `/tmp/vrdex-relay-image-proof.log`, `/tmp/vrdex-relay-package-tests.log`,
  `/tmp/vrdex-relay-build.log`, `/tmp/vrdex-relay-lock-install.log`.
  Source hashes cover all actual bundled inputs; packaging rejects event renderer,
  hosted event worker, Twitch/Python imports. Artifacts are not committed binaries.

## Limits and concerns

No production identity was available and none was assumed. Provider IAM/SDK behavior
is locally inspected/tested but not deployed. Secret retrieval and live enabled
Lambda+Convex integration still need an authorized staging release. Native phone
playback, production codec compatibility, per-worker capacity, global source cap,
spare ratio, operational cost and cleanup throughput remain measured release gates.
No fabricated caps or production tfvars were added.

API throttles constrain manifests, not CloudFront segment bytes/dollars; signed URL
replay remains possible through its validity window. The traffic ceiling is an
owner-reviewed estimate, not hard spending enforcement. Fixed slots keep idle
compute cost until explicitly stopped. Drain/stop-before-start replacement may
exceed30-second recovery. Existing ECR/network/state/secrets and Convex are external
cost/ownership inputs. The pinned Node base still installs distro FFmpeg at build
time; a release should retain its exact built image digest, not rebuild for rollback.

## Review fix round 1: I1, initialized non-root scratch volume

Base: `c9922a7`. Fixed Important I1 from `task-7-review.md`. The prior tmpfs
fixture did not establish ECS bind-volume ownership; its successful result did
not cover this deployment path. Minor M1 is explicitly deferred to Task 11 by
the controller and is unchanged in this round.

The Dockerfile now creates `/var/lib/media-relay`, sets owner `node:node` and
mode `0750`, and declares `VOLUME ["/var/lib/media-relay"]`. The ECS scratch
mount uses that exact initialized path. The enabled entrypoint and image fixture
share exported `WORKER_SCRATCH_DIRECTORY`. `USER node` and ECS
`readonlyRootFilesystem=true` remain in place. The fixture requires UID 1000,
volume owner 1000 and mode `0750` before creating source resources. Its documented
command now mounts a fresh anonymous volume, with no writable tmpfs.

### Observed RED

Against the original image, the following command exited 1. The fresh volume
had root ownership and Node could not create a directory:

```bash
source /workspace/vrdex-env.sh
env -u DOCKER_HOST -u DOCKER_CONTEXT -u DOCKER_TLS -u DOCKER_TLS_VERIFY -u DOCKER_CERT_PATH docker --host=unix:///var/run/docker.sock run --rm --read-only --mount type=volume,dst=/var/lib/media-relay vrdex-media-relay:task7 node --input-type=module -e 'import{mkdir,stat}from"node:fs/promises";const s=await stat("/var/lib/media-relay");console.log(JSON.stringify({uid:process.getuid(),owner:s.uid,mode:(s.mode&511).toString(8)}));await mkdir("/var/lib/media-relay/jobs");'
```

```text
{"uid":1000,"owner":0,"mode":"755"}
Error: EACCES: permission denied, mkdir '/var/lib/media-relay/jobs'
```

The focused Terraform assertion also observed RED (exit 1, 5 passed/1 failed):

```text
terraform -chdir=infra/terraform/media-relay test -no-color
local.worker_scratch_mount.containerPath is "/tmp"
Non-root workers require the initialized image scratch volume, with read-only root retained.
```

An initial attempt to inspect the entire JSON container definition in a mock plan
was unknown because it also contains computed provider outputs. The final
assertion checks the actual mount local consumed by that definition; it failed
on `/tmp` before changing it to the initialized volume path. No apply was used.

### Observed GREEN and actual image proof

After the fix, the identical volume-creation command exited 0 and printed:

```text
{"uid":1000,"owner":1000,"mode":"750"}
```

Commands below all exited 0. Socket/container commands used supported additional
network permission, retained Docker config/proxy, and used only the local daemon.
The same CA secret mount and pinned Node base were retained.

```bash
source /workspace/vrdex-env.sh
pnpm --filter @vrdex/media-relay typecheck
/tmp/vrdex-relay-tools/terraform -chdir=infra/terraform/media-relay fmt -check -recursive
/tmp/vrdex-relay-tools/terraform -chdir=infra/terraform/media-relay validate -no-color
/tmp/vrdex-relay-tools/terraform -chdir=infra/terraform/media-relay test -no-color
node scripts/package-media-relay.mjs /tmp/vrdex-relay-package
BUILDX_CONFIG=/tmp/vrdex-relay-buildx env -u DOCKER_HOST -u DOCKER_CONTEXT -u DOCKER_TLS -u DOCKER_TLS_VERIFY -u DOCKER_CERT_PATH docker --host=unix:///var/run/docker.sock build --secret id=proxy_ca,src=/etc/ssl/certs/ca-certificates.crt -f workers/media-relay/Dockerfile -t vrdex-media-relay:task7 /tmp/vrdex-relay-package
env -u DOCKER_HOST -u DOCKER_CONTEXT -u DOCKER_TLS -u DOCKER_TLS_VERIFY -u DOCKER_CERT_PATH docker --host=unix:///var/run/docker.sock run --rm --name vrdex-relay-task7-fix1-smoke --cpus 1 --memory 2g --pids-limit 128 --read-only --mount type=volume,dst=/var/lib/media-relay --mount type=bind,src=/workspace/VRDex/workers/media-relay/smoke.mjs,dst=/smoke.mjs,readonly vrdex-media-relay:task7 node /smoke.mjs
```

Terraform: **6 passed, 0 failed**, configuration valid, formatting clean.
Actual packaged-image proof output:

```json
{
  "proof": "actual-image",
  "scratch": { "path": "/var/lib/media-relay", "uid": 1000, "mode": "750" },
  "maximumSources": 2,
  "committedSnapshots": 32,
  "objects": 64,
  "allocation": {
    "cpuUnits": 1024,
    "memoryMiB": 2048,
    "evidenceId": "synthetic-image-only"
  },
  "resources": {
    "sampleSequence": 2,
    "windowMs": 1221.756104,
    "sampleAgeMs": 1000.9092039999998,
    "cpuUsagePercent": 40.898097285053545,
    "memoryUsedBytes": 73031680
  },
  "drain": true,
  "term": true,
  "killedChild": true,
  "reapedChildren": 3
}
```

This repeats real generated-MP4 packaging, two sources, drain refusal, owned-child
SIGKILL recovery, SIGTERM, zero attempt directories, zero live source connections
and three reaped child PIDs on the new volume. The named container was absent after
`--rm`. A separate no-network, read-only-root run confirmed disabled boot, volume
ownership and the bundled worker hash against `/app/manifest.json`:

```text
{"workerSha256":"263a22a2e6c56830c4064e0e1c91e7c0cbb4a607bcc9d0554a0d7f891daa403f","scratch":"/var/lib/media-relay","owner":1000,"disabled":true}
```

### Replacement artifact/source identities

These supersede the earlier image and worker identities above; gateway bytes are
unchanged. Fresh build/proof logs are `/tmp/vrdex-relay-fix1-build.log` and
`/tmp/vrdex-relay-fix1-image-proof.log`.

- Image: `sha256:b4e31094bf1667d871f43a92dca7e7a75c4fd81f03315df7e8d000d4573656b6`,
  695,476,823 bytes, user `node`, declared volume `/var/lib/media-relay`.
- Worker SHA256: `263a22a2e6c56830c4064e0e1c91e7c0cbb4a607bcc9d0554a0d7f891daa403f`,
  3,381,821 bytes.
- Gateway SHA256: `74dc01d38f3268cd9ffd6d35769955d05c9c4f0aa76fed07d0e887c2d5056bc7`.
- Gateway ZIP base64 SHA256: `AYobdIyfb/DiKTNeG8OZ5r4TD9En1qiwpYtq9GN/07k=`.
- Dockerfile SHA256: `c4971168f5002345208ad0a9fb1bd867e1324e08393451e59df894a5a195006a`.
- Terraform main SHA256: `efd518d26ecf1bb2ed79842c7317d0e6e498fec2a526e6ea32a6e636cd836950`.
- Worker entrypoint source SHA256: `78b6f3ea6e85561212305f3b2d45ffe7a50f14236287a1f182975ddf22e5056a`.
- Fixture source SHA256: `6004c36e7f6f573efc54e07ae1f7dc9031c9338ae39c2f685754bfcfbe440d73`.

Self-review: initialization precedes `VOLUME`, all three deployment paths match,
volume ownership is tested before media starts, and root stays read-only/non-root.
Only this deployment defect and its proof/docs changed. No broad suite, provider
mutation or apply ran. Local Docker copy-up behavior now matches the documented
ECS initialization mechanism; actual Fargate deployment remains untested. Prior
capacity/cost/live-provider/phone gates and deferred M1 remain unchanged.
