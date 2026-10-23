# Restream Worker Packaging

## Status

Current recommendation: this is a hosted-worker packaging and benchmark scaffold, not a production media worker.

The container shape is intentionally small so ECS/Fargate infrastructure can be validated before VRDex claims hosted restreaming. It installs FFmpeg and AWS CLI, runs a Node entrypoint, refuses to start unless the non-secret benchmark contract is present, and writes a synthetic `1080p60` HLS artifact plus HTML/JSON reports.

## Build Shape

The intended image build context is the repository root:

```powershell
docker build -f workers/restream/Dockerfile -t vrdex-restream-worker:local .
```

The image must be published to the ECR repository defined by `infra/terraform/restream-worker` only after local media-pipeline evidence exists. Do not publish images or run ECS tasks from this scaffold without explicit operator approval.

## Runtime Configuration

The ECS task definition injects non-secret environment values and secret references. Secret values belong in AWS Secrets Manager or the equivalent provider secret store, never in git, Terraform variables, logs, or Convex event records.

Expected non-secret values:

- `VRDEX_RESTREAM_QUALITY_GATE`, default `1080p60`; supported ladder is `1080p60`, `1080p30`, `720p60`, and `720p30`
- `VRDEX_RESTREAM_BENCHMARK_MODE`
- `VRDEX_RESTREAM_MAX_CONCURRENT_WORKERS`
- `VRDEX_RESTREAM_MAX_SESSION_SECONDS`
- `VRDEX_RESTREAM_KILL_SWITCH_SSM_PARAMETER`
- `VRDEX_RESTREAM_SECRET_REF_NAMES`
- `VRDEX_RESTREAM_SYNTHETIC_VARIANT`, default `static-transition`; use `live-control` for FFmpeg runtime command proof in the worker container
- `VRDEX_RESTREAM_LIVE_CONTROL_SCHEDULE`, default `output-timeline`; use `wall-clock` only to compare old timing behavior
- `VRDEX_RESTREAM_LIVE_CONTROL_MODE`, default `overlay-alpha-volume-fade`; use `hard-switch` for the simple source-selection baseline
- `VRDEX_RESTREAM_X264_PRESET`, default `veryfast`
- `VRDEX_RESTREAM_SYNTHETIC_DURATION_SECONDS`, default `12`; use longer live-control runs to expose sustained delay drift
- `VRDEX_RESTREAM_MAX_LIVE_DELAY_MS`, default `10000`; the synthetic live-control SLA for max observed output delay
- `VRDEX_RESTREAM_TRANSITION_FADE_MS`, default `500`
- `VRDEX_RESTREAM_HOLD_SLATE_AUDIO_DELAY_MS`, default `750`
- `CONVEX_URL`

Expected secret-reference names are supplied by Terraform through the `secret_arns` map. The worker treats those names as operationally sensitive and logs only their count. Synthetic benchmark runs use `VRDEX_RESTREAM_SYNTHETIC_ONLY=true`, so they can prove the media pipeline without provider credentials. Non-synthetic runs must use event-scoped output credential references, not raw ingest URLs or stream keys in plain environment variables.

Useful local proof command:

```powershell
pnpm proof:restream:worker
```

That command writes a playable artifact tree under `artifacts/restream-worker-benchmark/` with `program.mp4`, `hls/program.m3u8`, transition frames, `benchmark-report.json`, and `report.html`. The hold slate is rendered once as static artwork, then looped through the timed fade section so the `1080p60` gate measures the live encode path instead of repeated slate drawing. Open `report.html` through a local static server to watch the embedded `program.mp4` preview in the browser.

Container-shaped live-control proof command:

```powershell
pnpm proof:restream:worker:live-control
```

That command runs the hosted worker contract with `VRDEX_RESTREAM_SYNTHETIC_VARIANT=live-control`, starts FFmpeg once, and drives source/hold/source switching through the reusable controller instead of pre-rendering the transitions.
The live-control variant schedules runtime commands against FFmpeg output progress by default and gates on timed frame samples at the expected source, hold-slate, and source-B positions. It also records FFmpeg progress samples and reports max, average, and final live delay against `VRDEX_RESTREAM_MAX_LIVE_DELAY_MS`. Near-real-time pace remains a diagnostic because live-control inputs are intentionally `-re` paced; the default `static-transition` variant remains the throughput gate. The optional `wall-clock` schedule is a diagnostic comparison mode for proving why output-progress scheduling matters when encoding falls behind real time.

Sustained local live-control probe example:

```powershell
pnpm proof:restream:worker:live-control hard-switch ultrafast 1080p60 180 10000
```

That runs a 180-second synthetic program and fails if observed max live delay exceeds 10 seconds.

Benchmark matrix command:

```powershell
pnpm proof:restream:worker:matrix
```

That command compares the richer fade mode against the simple `hard-switch` mode and selected x264 presets. The current hosted evidence says `hard-switch` is the right baseline for a reliable first restreamer: it reduces runtime commands from 194 to 8. A 180-second hosted `1080p60` live-control probe failed the 10-second delay SLA on `4096` CPU / `8192` MiB but passed on `8192` CPU / `16384` MiB with max observed delay under 300ms. Treat fade/slate polish as optional until the source-selection pipeline has live-delay headroom.

The historical benchmark ladder evaluated `1080p60`, `1080p30`, `720p60`, then `720p30`. The current Twitch/operator design requires capacity proof for all six offered presets, including both 480p presets and dual 1080p60 inputs; an unsuccessful capacity proof blocks shipping that design rather than silently removing an offered preset.

Runtime command proof:

```powershell
pnpm proof:restream:live-control
```

That command starts FFmpeg once, then sends live ZeroMQ commands to filter instances. It requires local Python with `pyzmq` for the command sender. The working fade approach uses `streamselect` for base and next video layers, commandable `colorchannelmixer` alpha for video fades, and commandable `volume` filters into a fixed `amix` for audio fades. The controller expands one semantic operator command into eased, frame-ish transition steps, so callers do not send individual fade ticks. The proof validates source-to-hold-to-source switching, blended transition frames, and the delayed hold-slate audio path without rebuilding or restarting the FFmpeg process.

Do not drive live fades by changing `mix` or `amix` `weights`; this FFmpeg build returned `Function not implemented` for runtime weight commands. Use overlay alpha and per-source volume commands instead.

## Benchmark Gate

The benchmark profile in `benchmark-profile.1080p60.json` records the first hosted acceptance target:

- `1920x1080`
- `60 fps`
- H.264 `yuv420p`
- AAC-LC stereo at `48kHz`
- 1-second keyframe interval
- `3500`, `5000`, and `5800` Kbps video bitrate cases
- 10 concurrent workers for capacity evidence
- 12-hour maximum session cap

ECS on EC2 with GPU/NVENC stays a measured fallback. Do not promote GPU-backed hosting until Fargate CPU evidence fails the target or cost headroom.

## Artifact Uploads

If `VRDEX_RESTREAM_ARTIFACT_S3_URI` is set, the worker runs `aws s3 sync` after local artifact generation. Terraform sets this to the private benchmark artifact bucket prefix for ECS tasks. Do not make this bucket public; inspect artifacts through authenticated S3 access or short-lived presigned URLs only.

## Explicit isolated proof commands

The image also packages `scripts/event-proof-runner.mjs synthetic` and
`scripts/event-vrcdn-rehearsal.mjs`. These require explicit commands; the default
entrypoint remains the benchmark. See [the bounded rehearsal procedure](../../docs/engineering/event-broadcast-rehearsal.md)
for fixed endpoints, operator attestations, dedicated switch, artifacts and limits.

## Anonymous Twitch input

`createTwitchInput` in `twitch-input.mjs` returns immediately with
`transportReady` and idempotent asynchronous `dispose()`. Supply a canonical
`{kind: "twitch", channel}` input, the session media settings, an AbortSignal,
and `preparationExpiresAt` from the original persisted preparation receipt.
The handle clamps its local preparation window to 15 seconds and never renews
that original expiry on retry. `sessionExpiresAt` bounds ongoing recovery and
is capped at 12 hours. The caller still owns the same preparation expiry during
initial decoding and promotion. Transport readiness only means normalized
bytes are retained on a random private loopback GET endpoint. Start the
five-second decoder guard after that promise resolves; decoded A/V freshness
and promotion remain the input manager's responsibility.

Each fresh process runs:

```sh
python3 -m workers.restream.twitch_input --channel channel_login --video-preset 720p30
```

Streamlink resolves a fresh anonymous channel rendition; a sequential reader
then fetches its HLS playlist, init data, AES-128 key and media through the
installed HTTPS boundary. H264/AAC TS and MP4-family media are copied through a
paced pipe-only FFmpeg remux. Both manifest selection and codec-specific
bitstream filters reject unsupported codecs. Supported renditions include
1080p60-only channels for all six output presets. The renderer owns output
scaling, frame rate and audio encoding.

Relative segment, key and init-map references use the final validated playlist
response URL after redirects. Ad ranges use inferred program timestamps within
each continuous sequence and bounded reload overlap. Cache reuse and inference
require matching media sequence and effective discontinuity identity, including
playlist sequence advances when discontinuity tags leave the window. The reader
retains only the latest playlist's 2,048 timestamp/duration records and at most 128 compact ad
range records with IDs capped at 256 characters. Ambiguous timing or exhausted
metadata capacity ends the attempt without fetching unclassified media. Planned
ad duration alone does not prove the ad ended. This metadata does not add a
compressed-payload queue or change the buffer bound below.

The boundary permits `gql.twitch.tv` and valid subdomains of `.ttvnw.net`, on
HTTPS/443 only. Every new connection resolves all IPv4 answers within two
seconds, rejects non-public answers, and connects to a validated numeric IP
with the original TLS hostname and certificate verification. HTTP requests
have a five-second wall deadline, including streamed bodies. Redirects are
bounded; nested unsupported schemes and arbitrary domains fail closed. The
adapter uses private urllib3 pool classes. Streamlink itself modifies some
urllib3 URL/socket helpers at import time; this adapter never changes the
global pool mapping or address-family helper.

No browser, cookies, authentication, cached client-integrity tokens or signed
locator storage is supported. Dependency/library diagnostics and FFmpeg stderr
are suppressed; only fixed structured reason codes and bounded local numeric
facts cross stderr. Configured managed proxies are refused without changing
the environment. Run direct public-provider verification in the isolated worker,
not by removing a development executor's proxy or CA settings.

An attempt ends after 15 seconds without normalized output, including blocked
resolution and advertisement waits. The Node owner terminates the entire group,
schedules SIGKILL after 500 ms, within the one-second grace bound, even if its
leader already exited, then verifies no live group members and closed child pipes
before retrying fresh resolution after 1/2/4/8/10 seconds, capped thereafter.
Zombies awaiting init reaping do not own live resources. Disposal returns a
promise immediately so control processing can continue during cleanup. Failed
termination rejects with `process_failed`, stops retries and requires the caller
to retain the occupied capacity slot; fulfillment alone proves release.
Only one loopback consumer is accepted; backpressure stops upstream reads.

### Compressed buffer accounting

The source reservoir is capped at 2,097,152 bytes. Sequential fetching avoids
Streamlink's media rings, executor futures, map cache and parallel prefetch.
Two bounded response copies (524,288 bytes) plus twelve 16 KiB staging allowances
(196,608 bytes) cover manifest/API materialization, HTTP read, AES pending/output,
source-feed and normalized-output chunks. Node reserves 524,288 bytes: its
262,144-byte backlog plus bounded readable/socket/writable chunks. Thus the
conservative application compressed-payload bound is **3,342,336 bytes**, below
4 MiB across both processes, including replay/backlog. No separate replay or
per-reconnect fanout queue exists.

Structured buffer events expose the measured reservoir and Node backlog high
water marks, actual kernel capacities of both remux pipes, and the conservative
combined upper bound. The upper bound sums
component peaks and reserved staging; it is deliberately not described as a
simultaneously sampled process heap measurement. Kernel socket/pipe buffers,
TLS record buffers, FFmpeg's bounded 1,000,000-byte probe and demux/mux internals,
Python objects and allocator overhead are outside that compressed application
reservoir metric. They count in the task's cgroup memory and exact-image
capacity measurements. A two-second warmup starts only after source bytes
arrive; it is a target, not a guarantee of two seconds of media.

### Packaging and reproducible checks

The Dockerfile retains its existing APT prefix and uses one final read-only
source-bind RUN. `install_twitch.py` downloads the exact public wheel URLs in
`twitch-wheels.lock.json` with inherited proxy settings and verified system CA
trust, optionally augmented by the BuildKit `proxy_ca` secret. It verifies size
and SHA-256 before executing the locked pip 25.3 wheel, installs the complete
CPython 3.11 Linux amd64 closure offline with `--require-hashes`, and runs
`pip check`. The worker Python package activates these private wheels only in
its own process; no global `PYTHONPATH` changes Debian awscli dependencies. The
actual-image smoke also checks `aws --version`. No installer or runtime pip operation is retained. The lock pins
Streamlink 8.6.2, Requests 2.34.2 and urllib3 2.8.0 and all transitives.

The wheel set, including bootstrap, is 19,298,839 bytes compressed. Runtime
wheels contain 45,859,107 uncompressed bytes, excluding pip. This measures the
dependency payload, not Docker/VFS peak disk use. Normal builds require no
session files or preexisting wheelhouse:

```sh
docker build --platform linux/amd64 -f workers/restream/Dockerfile -t restream-worker .
```

The build executes `twitch_image_smoke.py` on CPython 3.11, verifies every copied
file against its source hash manifest, imports the pinned dependencies and Node
wrapper, and checks actual FFmpeg/ffprobe normalization. Run it again against
the immutable deployment image using that image's normal execution route.
Do not infer image acceptance from host tests. The current implementation
session defers the actual-image build and execution until Task 6 after manager
integration, subject to measured VFS headroom. Provider tests, both 1080p60
inputs across six presets, optional simulcast, 30-minute continuity and device
playback remain separate exact-image acceptance gates.

Host contracts (install dependencies from the target-appropriate lock first):

```sh
python -m unittest discover -s workers/restream/tests -p 'test_twitch_*.py'
node --conditions=import --import tsx --test tests/backend/event-twitch-input.test.ts
```

The CPython 3.11 binary lock cannot be installed as a CPython 3.12 environment.
The current host tests used a separately prepared pinned CPython 3.12 research
environment; no production code depends on it. Fixtures generate their own
verified CA/SAN and audible synthetic media. See
[fixture recipes and preserved negative research](tests/fixtures/README.md).


## Immutable allocation and exact-image proofs

Managed event workers require `VRDEX_EVENT_MEDIA_ALLOCATION_SNAPSHOT_JSON` from
the dispatcher and ECS v4 metadata. Startup compares task vCPU and memory, container
CPU units and memory, and the authenticated session's allocation, media settings
and destination snapshot before publication. Every configuration refresh retains
that same snapshot. Allocation changes apply only to a new session.

`packaging-manifest.json` is the explicit source/proof list used by installation
and image provenance checks. The server-only `broadcast-capacity.mjs` map is
excluded. The `packaged-files` Docker target exports actual `/app` files and
`/opt/twitch` for independent comparison without a local inspection container.
See [quality and capacity](../../docs/engineering/event-broadcast-quality-capacity.md)
for benchmark commands, acceptance gates and candidate evidence status.
