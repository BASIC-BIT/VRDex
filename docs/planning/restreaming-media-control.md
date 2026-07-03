# Restreaming and Media Control

## Status

Current recommendation and research notes for the large restreaming and
media-control direction tracked by `#124` and adjacent event-operations work.

This document records product decisions, research findings, architecture
options, and open questions from the June 2026 restream planning session. It is
not yet an implementation spec.

Visibility boundary: this is planning/engineering material. Do not promote these
notes into public docs, PR prose, marketing copy, or external issues until
provider-sensitive strategy, rights posture, and product wording have been
sanitized for public consumption.

## Core Bet

Current recommendation: treat restreaming as a major VRDex platform pillar, not
as a small extension of event media links.

The product opportunity is a simple event media control plane for VRChat events:

- operators plan an event lineup in VRDex
- performers keep using their existing stream setup where possible
- VRDex gives the event one operational media workflow
- public pages, in-world links, Discord commands, and operator controls share
  the same event state
- operators keep escape hatches so they can fall back to direct links during a
  live event

The strategic value is not only streaming. The value is combining profiles,
stream-link memory, event slots, Discord exports, public watch pages, and
operational controls into one coherent workflow.

## Locked Decisions

- Day-one restream output should prioritize VRCDN because VRCDN is already
  VRChat-specific, low-latency, and familiar to event operators.
- Day-one account ownership should assume operators bring their own VRCDN
  account and stream keys.
- VRDex should preserve both PC and standalone/mobile playback compatibility.
  Dual-link behavior must remain feature parity even if the product later
  exposes a single convenient event setup flow.
- Performers should not need to change behavior to use the first useful version.
  If a performer uses VRCDN or Twitch today, VRDex should try to support that
  workflow before requiring a new ingest path.
- Hard cuts are acceptable for the first switching version, but the architecture
  must support a hold/media slate from day one.
- The planning distinction is `v0.9` versus `v1`: a hard cut can be acceptable
  for `v0.9` validation, but `v1` should include the full default transition
  sequence before the feature is merged as a real product slice.
- The first hosted quality target is `1080p60` as the hard first-tier target,
  with strong audio quality, about 10 concurrent events, 90 viewers per event,
  and event durations around 4-6 hours with 12 hours as a practical upper bound.
- Restreaming should remain infrastructure-as-code and technically self-hostable,
  but the hosted product can be the realistic operating path.
- The first Discord integration should include Gateway early, not only HTTP
  interactions, and must carry the same testing, verification, CI/CD,
  deployment, and infrastructure rigor as the rest of the application.
- VRDex can become the broadcaster-of-record for hosted restreaming features only
  if the product owns the related rights, compliance, consent, and audit
  boundaries clearly.
- Local pipeline verification and cloud infrastructure planning should both
  happen early. Validate actual media flow locally, then move directly into
  ECS/Fargate or equivalent infrastructure design.
- Audio must be in the first pipeline prototype because audio quality, sync, and
  transitions are core product behavior, not later polish.
- Operator-owned output credentials are still the obvious default for `v1`, but
  the `vrdex_pool` model deserves a focused feasibility research pass before
  final issue slicing.

## Current Recommendations

- Build VRDex as the control plane first.
- Use VRCDN as the first external delivery target, not as the only long-term
  delivery option.
- Keep VRDex-owned delivery as a researched future option, not the day-one
  default.
- Treat restream workers as event-session workers. Viewer scale should sit
  behind VRCDN or another delivery provider, not on the worker pool.
- Keep Discord bot commands and web control-room actions as different control
  surfaces over the same underlying command model.
- Separate public event state from private operator state. Public pages should
  show safe current/next/watch information; they should not expose private
  readiness checks, failed probes, stream keys, or internal worker mechanics.

## VRCDN Research Notes

Observed from the public VRCDN wiki and VRChat community documentation:

- VRCDN is a low-latency streaming CDN tailored for VR applications.
- A VRCDN account currently depends on Patreon subscription tiers.
- VRCDN's Live page provides an ingest server address and stream key for OBS or
  equivalent encoding software.
- VRCDN exposes different playback URLs for VRChat use.
- RTSP/RTSPT-style playback is recommended for PC-only instances because it
  provides the lowest latency.
- MPEG-TS is recommended for standalone VR platforms such as Quest and Pico
  because RTSP/RTSPT is not supported on most standalone/mobile platforms.
- For mixed instances without a dual-URL video-player feature, VRCDN recommends
  MPEG-TS because it is supported on PC and most standalone platforms.
- In-world playback should use video players based on AVPro stream mode and
  low-latency player settings where available.
- VRCDN recommends `3500 Kbps` video bitrate, allows up to `6000 Kbps` video
  bitrate, and documents `320 Kbps` max audio bitrate.
- VRCDN can temporarily halt streams that exceed its bitrate limit.
- VRCDN recommends 1-second keyframe intervals for low-latency VR use.
- VRCDN recommends `48kHz` audio sample rate because other sample rates are not
  supported by most VR platforms.
- Troubleshooting guidance points toward H.264 encoders such as NVENC H.264,
  AMD H.264, or x264.
- VRCDN guest streams can create extra stream keys that forward to the main live
  stream URL.
- VRCDN private streams can be used as relay links between a DJ, VJ, lighting
  designer, or other stream pipeline participants.
- VRCDN exposes regional RTMP ingest servers in Europe, North America, South
  America, Asia, and Oceania.
- VRCDN network rules say to double-check with the receiving provider before
  restreaming to them from VRCDN.

Implications for VRDex:

- Store provider rules and compatibility warnings as operational knowledge, not
  public-page copy.
- Model `pc` and `standalone` playback outputs separately even when the UI offers
  one simple setup flow.
- Do not assume `pc` and `standalone` compatibility requires two separately
  encoded streams. It might be two output URLs for one encoded stream, depending
  on provider and player behavior.
- Keep bitrate and audio settings visible to operators before the live event
  starts.
- Model ingest region as an operator or event-level setting when VRCDN
  credentials are used.
- Treat provider consent and rights as part of the event media setup checklist.
- Never persist stream keys in ordinary event media links. Secrets belong in
  provider secret stores or encrypted/scoped secret storage once implemented.

## VRChat Video Player Compatibility

Current disposition: keep dual PC/standalone playback outputs as the safe
default. A single VRDex-controlled link may still be possible for a custom world
integration, but it should be proven in ProTV, VideoTXL, and at least one
simpler AVPro-based setup before becoming product policy.

Source notes:

- VRChat's video-player docs say worlds can use `VRCAVProVideoPlayer` or
  `VRCUnityVideoPlayer`; AVPro supports live streams on multiple platforms,
  while Unity Video does not support those live streams.
- VRChat's docs also say Android URL resolution is now available, but video URL
  requests are globally rate-limited to one new URL every five seconds per user
  across all video players.
- VRChat's docs list VideoTXL, ProTV, and USharpVideo as community prefabs worth
  considering.
- ProTV's VRChat Wiki page describes native livestream support including VRCDN
  and Quest support.
- ProTV's Android/Quest docs emphasize that URLs, not player prefabs, are often
  the compatibility problem, and warn about website URLs, direct media URLs, URL
  expiration, and resolver/proxy tradeoffs.
- VideoTXL docs and source model multiple video sources, Unity/AVPro backends,
  local/Quest URL choices, low-latency options, and audio-manager behavior
  rather than assuming one universal backend.
- USharpVideo documents RTSP stream use for low-latency playback, reinforcing
  that RTSP/RTSPT is part of the PC-oriented ecosystem rather than a
  standalone-safe default.
- Community code examples suggest local platform distinctions can be made with
  compile-time Android checks plus VR state, but current VRChat Player API docs
  do not expose a documented `GetPlatform` method. Treat platform-sensitive Udon
  routing as test-required, not settled.
- A server-side VRDex redirect endpoint cannot reliably know the viewer platform
  unless the world/player provides platform context or the request path is
  player-specific.

Implications for VRDex:

- Event records should continue to carry separate `pc`, `standalone`, and
  browser/watch outputs even if the UI groups them.
- A future world integration could expose a config endpoint or generated setup
  snippet that lets supported prefabs pick the correct local URL, but that is a
  player-integration feature, not a generic CDN redirect.
- Late-joiner and multi-player URL-load rate limits matter for worlds with
  multiple screens or separate preview/program players.
- First compatibility docs should target ProTV and VideoTXL because they are
  widely referenced and event-oriented.
- USharpVideo should be included in a second compatibility pass because it is
  still a common reference point and documents low-latency RTSP workflows.
- If a world or player only accepts one URL, the mixed-instance recommendation
  should be MPEG-TS or the provider's standalone-compatible URL, not the PC-only
  low-latency URL.
- If VRDex later serves playback from its own media domain, allowlist and Android
  HTTPS behavior need explicit validation before claiming it works in all worlds.
- Local pipeline tests need to validate audio, stream continuity, and
  player-consumable output formats; unit tests around URL derivation are not
  enough.

Confidence:

- High: keep dual output fields and VRCDN-specific PC/standalone URL derivation
  in the data model.
- High: require AVPro-compatible output for live-event playback guidance.
- High: treat VRChat URL-load rate limits as a real product constraint for
  multi-screen and late-joiner guidance.
- Medium: a custom world integration can reduce operator setup friction by
  choosing URLs locally.
- Low until tested: a single plain URL can replace dual-link behavior across
  common worlds without player-specific support.

## AWS and Delivery Research

AWS's managed live-streaming reference architectures are robust, but they are not
automatically the right first target for VRDex.

Relevant AWS findings from the June 2026 research pass:

- The standard AWS live-streaming solution uses AWS Elemental MediaLive for
  ingest/transcoding, AWS Elemental MediaPackage for packaging, and Amazon
  CloudFront for CDN delivery.
- MediaLive supports inputs such as HLS pull, RTMP pull/push, RTP push, SRT
  caller/listener, MediaConnect, MP4, and other broadcast-oriented sources.
- MediaPackage live channels receive HLS pushed from an upstream encoder using
  HTTPS WebDAV with digest authentication. MediaPackage is not a generic
  pull-any-url service.
- Amazon IVS supports RTMPS/RTMP/SRT ingest and low-latency playback, but lowest
  latency expects the IVS player and IVS-specific workflow. That may not map
  cleanly to VRChat in-world playback.
- Fargate is attractive for a first hosted worker benchmark because it avoids
  EC2 fleet management, but it does not support GPUs, privileged containers,
  direct device access, or ECS `gpu` task definitions.
- ECS on EC2 with GPU is the likely NVENC path if CPU-only workers cannot satisfy
  `1080p60`, transitions, or cost targets.
- MediaLive plus MediaPackage is a future broadcast-grade delivery path, not the
  first VRCDN-forwarding worker. Its channel-hour cost and CDN delivery posture
  change the product and pricing model.

Open cost interpretation:

- AWS CloudFront is pay-as-you-go and priced for general-purpose global delivery
  without assuming a niche community subscription model.
- A VRCDN subscription is not directly comparable to AWS per-event pricing
  because VRCDN can average usage across many subscribers, impose bitrate limits,
  use non-AWS infrastructure, rely on fair-use economics, and specialize for one
  VR use case.
- For VRDex, the important distinction is whether we are forwarding one live
  source to a user's VRCDN target or acting as the delivery layer for every
  viewer.
- If VRDex forwards one stream to VRCDN, viewer count mostly affects VRCDN and
  the operator's account, not VRDex infrastructure.
- If VRDex owns delivery, every viewer-hour becomes a direct bandwidth cost and
  pricing must reflect that.
- VRCDN-forwarding pricing should be built around worker-hours, maximum session
  length, and output profile while VRCDN or another provider owns viewer
  delivery.
- VRDex-owned delivery pricing would need viewer-hour or bandwidth limits,
  takedown/support burden, and abuse controls.

Candidate future output paths:

- `vrcdn`: push one composed output stream to the operator's VRCDN ingest.
- `external_rtmp`: push to a compatible external RTMP/RTMPS destination when the
  provider allows it.
- `aws_hls`: worker or MediaLive outputs HLS through S3/MediaPackage plus
  CloudFront.
- `ivs`: push to Amazon IVS for web-watch use cases if VRChat compatibility is
  not the target.
- `manual`: no restreaming; VRDex only exposes direct platform links and
  operational checklist state.

Candidate account models:

- `operator_owned`: the event operator supplies their own VRCDN account
  credentials or scoped event key.
- `vrdex_pool`: VRDex owns a pool of VRCDN accounts or equivalent provider
  capacity. This is operationally closer to managed hosting and should be weighed
  against building a VRDex-owned delivery path.
- `vrdex_delivery`: VRDex owns ingest, processing, and delivery. This is a
  strategic independence path, not a hidden assumption in the first
  VRCDN-forwarding design.

VRDex pool feasibility disposition:

- Current recommendation: keep `operator_owned` as the `v1` account model.
- `vrdex_pool` is technically plausible, but it is not implementation-ready
  without explicit provider approval and legal/compliance review.
- `vrdex_pool` means VRDex owns provider accounts or provider capacity and leases
  that capacity to customer events. This makes VRDex responsible for pool
  scheduling, billing, credential rotation, account security, support escalation,
  abuse response, takedown handling, and provider-compliance enforcement.
- If VRDex owns the output credential, assume VRDex is the practical
  broadcaster-of-record unless provider/legal review says otherwise.
- Public VRCDN docs confirm useful primitives such as Live stream keys, Guest
  stream keys, Private/Relay streams, regional RTMP ingests, account-wide CCU,
  Patreon-tier-dependent capacity, forwarding limits, bitrate limits, and
  network rules requiring legal broadcast rights.
- Public VRCDN docs do not establish that VRCDN permits commercial pooling,
  resale, sublicensing, or third-party event leasing of VRCDN accounts.
- Near-term alternative: offer managed setup assistance for operator-owned VRCDN
  accounts. VRDex can guide account setup, validate OBS/provider settings, store
  scoped output credentials securely, run the control-room worker, and preserve
  direct-link fallback while the event operator remains the provider account
  holder.
- Decision gate: do not implement `vrdex_pool` until VRCDN explicitly confirms
  allowed account ownership, pooled or leased capacity, Guest/Private key use,
  automation/API support, CCU limits, support responsibilities, abuse/takedown
  routing, and acceptable product wording.

## Worker Architecture

Current recommendation: a restream worker is a stateful event-session worker,
while Convex remains the authoritative control plane.

Control plane responsibilities:

- event media program configuration
- source and output records
- selected current source or scene
- queued commands
- worker leases and heartbeats
- audit log of operator actions
- public projection of safe current/watch state

Worker responsibilities:

- acquire one event-session lease
- resolve input source configuration
- compose the current scene
- switch between sources and slates
- push the output to the configured target
- report health, liveness, bitrate, errors, and command outcomes
- never expose secrets in logs or public state

Candidate compute path:

- Start with containerized workers on ECS/Fargate or equivalent hosted container
  runtime.
- Use SQS/EventBridge or Convex scheduled/action polling to wake or coordinate
  workers.
- Consider ECS on EC2 with GPU/NVENC only if CPU-only workers cannot satisfy
  `1080p60`, transitions, or cost targets.
- Keep the worker implementation swappable. FFmpeg is likely, but the
  architecture should not encode every product decision around one binary.
- Benchmark Fargate first, but do not treat it as a production promise until
  CPU-only worker profiles are measured.
- Treat ECS on EC2 GPU as the fallback for measured `1080p60` or
  transition-quality needs, not as the first operational surface.

Cloud infrastructure follow-on plan:

- Build a worker container that can run the same local pipeline proof in a
  non-interactive task.
- Publish the image to ECR and run one ECS task per event media session.
- Store stream keys and output credentials in Secrets Manager or an equivalent
  encrypted secret store, injected into task runtime and never into ordinary
  event records.
- Use task roles with least-privilege access to read only the event/session
  secret, write health, and emit logs/metrics.
- Use EventBridge Scheduler, an operator command, or a Convex action to start
  scheduled tasks before event time.
- Use Convex as the authoritative control plane, with either SQS command delivery
  or short-poll command leases from the worker.
- Use valid Fargate CPU/memory pairs and Linux platform `1.4.0+` for larger task
  sizes and fine-grained Secrets Manager injection.
- If tasks run in private subnets, plan NAT or VPC endpoints for ECR, Secrets
  Manager, CloudWatch Logs, and any required S3 gateway endpoint behavior for
  image pulls.
- Add ECR lifecycle policy early because media-worker images can become large.
- Emit heartbeats, current source, output bitrate, audio presence,
  dropped/retried segment counts, and command results back to Convex.
- Send logs to CloudWatch with redaction for ingest URLs, stream keys, and signed
  URLs.
- Add cost guardrails before production testing: max concurrent workers,
  per-event duration limit, budget alarm, and manual kill switch.
- Exercise a 10-concurrent-event load test with `1080p60` profiles before
  committing to first hosted pricing.
- Keep rollback simple: stop the worker and publish direct source links or the
  operator's original VRCDN links as fallback.

## Media Pipeline Direction

The first real product should support a simple but extensible media program.

Candidate domain objects:

- `eventMediaProgram`: the event-level media-control root.
- `eventMediaSource`: performer stream, VJ stream, event-camera stream, Twitch
  watch/source, VRCDN link, HLS URL, RTMP source, uploaded file, static image, or
  audio loop.
- `eventMediaScene`: live source, hold slate, intro, outro, offline card,
  countdown, or custom visual.
- `eventMediaOutput`: VRCDN target, external RTMP target, AWS HLS target, IVS
  target, or manual-only target.
- `eventMediaCommand`: switch, hold, preview, start, stop, next, previous, set
  output, mute, volume, emergency offline.
- `eventMediaSession`: a concrete live run with worker lease, status,
  started/stopped timestamps, and health.
- `eventMediaAuditLog`: immutable operator and automation action log.

Candidate first command set:

- start program
- stop program
- switch to source
- switch to hold slate
- next slot
- previous slot
- force direct-link fallback
- mark source live/offline manually
- publish current public watch link

Candidate early scene behavior:

- A hold slate is core, not luxury.
- The default hold slate can use the community logo or uploaded event image.
- Waiting audio is desirable but should be rights-cleared and operator-provided.
- Default transition can be a hard cut only for `v0.9` validation.
- `v1` should include fade out, brief black, slate fade in, and source fade in
  before the product PR is considered complete.
- User-configurable transitions can wait; default system transitions should be
  tasteful, subtle, and non-flashy.

Validation requirement:

- The local prototype should push real media through the pipeline and expose
  output that a human can watch and hear.
- Automated checks should inspect enough of the output to catch obvious missing
  audio, broken segment generation, failed switching, and command sequencing
  mistakes.
- Visual/manual verification remains required because operator trust depends on
  watching the result, not only passing process-level health checks.

Implementation engine research notes:

- Current recommendation: use an FFmpeg-based worker for the first `v0.9`
  media-worker proof, while keeping the worker architecture engine-swappable.
- FFmpeg is the best first target because it is container-friendly, scriptable,
  easy to validate with `ffprobe`, and supports RTMP/RTMPS push, HLS artifact
  output, H.264/AAC encoding, `48kHz` audio, static slates, fades, overlays, and
  automated media checks.
- A local synthetic FFmpeg test already generated a short HLS program with H.264
  video, AAC audio, `48kHz` sample rate, segment continuity, silence detection,
  black/fade detection, and transition thumbnails.
- GStreamer remains the strongest later candidate for advanced live switching
  because `input-selector` and `compositor` directly model live source selection,
  synchronized pads, alpha, z-order, and compositing.
- OBS plus `obs-websocket` is a useful self-hosted/operator integration path, but
  it is not the hosted-worker default because headless cloud operation adds
  rendering, profile, virtual-display, and operational complexity.
- Managed AWS MediaLive/MediaPackage should wait until VRDex is intentionally
  designing AWS-owned broadcast delivery, not simply forwarding one composed
  output to VRCDN.

Hard first-tier target:

- Locked decision: the first hosted quality target is `1080p60`. This is a hard
  engineering acceptance bar for the first hosted tier, not a beta label.
- Do not publicly promise hosted `1080p60` availability, pricing, or concurrency
  until the `v0.9` proof includes both media-correctness evidence and capacity
  benchmark evidence.
- Target output is `1920x1080`, `60 fps`, progressive constant frame rate,
  H.264/AVC `yuv420p`, AAC-LC stereo, `48kHz` audio, and a 1-second keyframe
  interval.
- Benchmark video bitrates should include `3500 Kbps`, `5000 Kbps`, and
  `5800-6000 Kbps`; production defaults should keep headroom below provider hard
  caps to avoid bitrate-spike enforcement.
- Target audio bitrate is `320 Kbps` where allowed, with `192 Kbps` tested as
  fallback if provider or stability headroom requires it.
- Passing `1080p60` means sustained real-time encode with operational headroom,
  realistic high-motion inputs, stable bitrate under provider caps, no segment
  gaps, no audio loss, expected keyframe cadence, clean source/slate/source
  switching, and enough CPU/GPU headroom for live variance.
- If Fargate CPU cannot meet the target with reliability and cost headroom, ECS
  on EC2 with GPU/NVENC becomes the fallback path before launch promises or
  first-tier pricing are set.

Local pipeline proof plan:

- Use synthetic and real sample inputs: two distinct video sources, two distinct
  audio tones or tracks, a branded still/slate, and optional hold music.
- Produce a local output that can be watched, such as HLS segments plus playlist
  or a local RTMP target through a test relay.
- Drive switching through an explicit command script or small command API rather
  than editing the FFmpeg command by hand during the test.
- Validate `v0.9` first: source A, hard switch to slate, hard switch to source B,
  continuous audio/video output, and direct watchable artifact.
- Validate `v1` next: fade source audio/video out, brief black, fade slate in,
  hold music if configured, fade source B in, and maintain audio sync.
- Use `ffprobe` or equivalent to assert video stream exists, audio stream exists,
  expected codec/profile is present, sample rate is `48kHz`, segment generation
  is continuous, and output duration roughly matches the command script.
- Parse the HLS playlist to assert target duration, segment count, nonzero
  segment sizes, missing-segment absence, and total duration near the command
  timeline.
- Use `silencedetect`, `blackdetect`, and later `freezedetect` to catch missing
  audio, expected fade-to-black windows, and stuck source output.
- Generate thumbnail frames around transition boundaries so a human or VLM can
  inspect that black/slate/source transitions happened in the right order.
- Keep all secrets out of the local prototype. Use local files and local relay
  URLs until the cloud worker path is ready.
- Treat failure cases as part of the proof: missing source, source ends, audio
  missing, command arrives late, and output target disconnects.
- Add a local RTMP relay test after the HLS artifact proof, using a local relay
  such as MediaMTX or nginx-rtmp, so the worker push path can be validated
  separately from artifact generation.

Local proof acceptance criteria:

- A human can watch and hear the generated output without special event
  infrastructure.
- Automated checks fail if audio is absent, output has no video, segments stop
  unexpectedly, or command ordering is not reflected in the output.
- The same container entrypoint can run locally and in ECS with only
  configuration changes.
- The proof produces watchable `1080p60` output and automated evidence for codec,
  resolution, frame rate, keyframe cadence, audio sample rate, stream continuity,
  and transition behavior.
- The proof creates enough evidence to decide whether Fargate CPU benchmarking
  is viable before moving to GPU-backed ECS.

## VJ and Event Camera Workflows

VJs and event videographers are first-class future sources, not edge cases.

Common VJ workflow observed from operator knowledge:

- DJ streams to VRCDN.
- VJ loads the DJ's VRCDN stream as a source in visual software such as Obsidian
  or OBS.
- VJ adds visuals, effects, and possibly lighting/control side channels.
- VJ restreams the combined output to the VJ's own VRCDN.
- The event uses the VJ's VRCDN as the actual in-world source.

Implications:

- A VJ can be a person/profile in VRDex with their own stream links and provider
  credentials.
- Event slots may need both performer/DJ and VJ associations.
- If a slot has an explicit VJ output source, the VJ source may be the preferred
  event source instead of the DJ source.
- Do not assume every `VJ` role means a video restreamer. Some VJs operate
  lighting panels, DMX-like in-world controls, or other side-channel visuals
  rather than the main AV stream.
- The product needs a role/capability distinction such as
  `visual_restream_source`, `lighting_operator`, or `stage_visuals` before
  automating source selection from the word `VJ` alone.

Event camera and videographer workflows:

- Some events may want the public/web stream to show a live camera view of the
  event rather than the DJ's own output.
- The camera source could be a human videographer, a fixed VRChat camera path, or
  a scene camera loop.
- This is not required for first `v1`, but the source model should not make it
  hard to add.

Current recommendation:

- First product can focus on DJ/source switching plus hold slate.
- Data model should still support source owner, role, and purpose so VJ and
  camera sources can become first-class later.
- Source selection must remain operator-overridable. Automatic "use the VJ stream
  when present" is useful only when the source role is explicit and confirmed.

## Twitch and Other Source Boundaries

Twitch support is important because many performers already use Twitch, but it
is a product and legal boundary.

Current recommendation:

- Support Twitch watch/embed links on public event pages.
- Allow public watch-link priority to be controlled by both performer preference
  and event/community policy.
- A performer might prefer their Twitch embed to appear on the website even when
  the in-world stream uses a restreamed VRCDN output.
- An event/community operator might require the restreamed event output to be the
  public watch link for consistency, rights, moderation, or operational reasons.
- Research Twitch terms and technical source availability before promising Twitch
  restreaming.
- Do not build brittle extraction or circumvention logic to pull raw Twitch
  streams.
- If Twitch does not provide a reliable and permitted raw source path for this
  use case, VRDex should require a VRCDN or other direct stream source for
  restreamed events.
- Make this limitation operator-facing in setup flows, not viewer-facing on
  public event pages.

Twitch research disposition:

- High confidence: Twitch is suitable as a public web watch/embed provider.
- High confidence: Twitch is suitable as a destination for a broadcaster's own
  RTMP ingest when the broadcaster owns the channel and stream key.
- High confidence: Twitch is not currently proven as a provider-approved raw
  input source for VRDex workers. The official developer docs researched here
  expose embeds and broadcaster ingest, not a sanctioned API for third parties to
  pull a channel's live HLS output and rebroadcast it through another provider.
- Medium confidence: Twitch simulcasting rules support a performer multi-output
  workflow more than they support VRDex pulling Twitch as a source.

Implications for VRDex:

- Treat Twitch as `watch_embed` and `watch_link` first.
- Treat Twitch as a `restream_input` only after explicit provider/legal review or
  a documented, approved source path.
- Prefer asking performers who want Twitch plus VRDex restreaming to send the
  same OBS/program output to Twitch and a VRDex/VRCDN-compatible input, rather
  than having VRDex pull from Twitch.
- Do not use yt-dlp-like extraction, hidden HLS URL scraping, or unofficial
  playback-token workflows in product code.
- Public pages should not expose this uncertainty; setup and operator docs
  should explain which source types are restream-capable.
- If VRDex ever supports Twitch as a restream input, require source-owner consent
  and record that consent in the event media setup audit trail.

Broader provider rule:

- VRDex should prefer raw or provider-approved source inputs.
- VRDex should not jump through hoops to support providers that do not clearly
  allow or support restreaming.
- Operators remain responsible for rights and provider compliance unless VRDex
  explicitly sells a managed broadcaster service with its own terms.
- YouTube can remain an embedded public watch provider, but rebroadcasting
  YouTube through VRDex workers should not be first-class unless rights and
  provider terms are explicitly cleared.
- Hold music and intro/outro media should be operator-uploaded or otherwise
  rights-cleared. Do not design the first product around pulling arbitrary
  YouTube music into a live program.

## Discord Bot Direction

Locked decision: include a persistent Gateway bot early, not only HTTP
interaction webhooks.

Current recommendation: run Discord as a dedicated long-running adapter service
that shares the same command, permission, audit, deployment, and verification
rigor as the rest of VRDex.

Important UX distinction: slash commands are probably not the right primary
surface for live controls. Discord interaction buttons, selects, modals, and
embeds can be a much better control surface because they feel like a compact
media control panel rather than typed commands.

Discord research notes:

- Discord interactions can be received through outgoing webhooks or Gateway
  events; those delivery modes are mutually exclusive for interactions.
- HTTP interactions support slash commands, buttons, select menus, and modals
  without running a persistent Gateway process.
- Initial interaction responses must happen within 3 seconds; deferred responses
  and followups can continue later.
- Application commands can be scoped globally or to a guild. Guild commands
  update faster and are useful for testing.
- Gateway bots are needed for ambient server events, message monitoring,
  presence/member signals, and broader real-time behavior.
- Privileged intents apply to member, presence, and message content access.
- Interaction delivery through HTTP and Gateway `INTERACTION_CREATE` is mutually
  exclusive for interactions. For the Gateway-first app, do not configure a
  Discord Interactions Endpoint URL.
- The bot should receive slash commands, buttons, selects, and modals through
  Gateway `INTERACTION_CREATE`, then respond through Discord's HTTP
  callback/followup APIs.
- `discord.js` v14 on Node 22 is the likely first library stack, deployed
  separately from the Next.js/Vercel app and Convex functions.
- The first bot should request minimal intents, starting with `GUILDS` and no
  privileged intents. Defer `GUILD_MEMBERS`, `MESSAGE_CONTENT`, and
  `GUILD_PRESENCES` unless a later feature explicitly requires role sync,
  ordinary message ingestion, or presence behavior.
- Component `custom_id` values are limited to 100 characters and should be
  treated as compact routing hints, not trusted state.
- A row can contain up to five buttons, or one select menu. String selects
  support up to 25 options, which is enough for a small lineup but not an
  unbounded source list.
- Discord rate limits should be handled from response headers and `Retry-After`;
  do not hard-code assumed rate limits.

Candidate first command surface:

- `/vrdex event status`
- `/vrdex event links`
- `/vrdex event now`
- `/vrdex media hold`
- `/vrdex media next`
- `/vrdex media source`
- `/vrdex media fallback`

Candidate first interactive control surface:

- event status embed with current source, next source, output state, and direct
  fallback links
- one primary control message per event/session to avoid spamming a staff channel
- `Hold`, `Next`, `Fallback`, `Preview`, and `Refresh` buttons
- source select menu for manual source switching
- modal for one-off custom source or fallback link entry
- ephemeral operator responses for sensitive command outcomes
- stale-panel detection through a revision or nonce in the component state
- confirmation flow for dangerous live actions such as `Fallback`, `Stop`, or
  switching during active output

Current recommendation:

- Use commands for discovery, setup, status, and opening/refreshing the control
  embed.
- Use buttons/selects/modals for live event control if Discord control ships in
  the first restream slice.
- ACK or defer immediately, enqueue the command in the authoritative control
  plane, and update the shared embed only after safe state changes.
- Use ephemeral responses for permission denials, queued-command confirmation,
  stale-panel warnings, sensitive setup validation, and operator-specific
  outcomes.
- Audit every Discord control attempt, not only successful worker commands.
- Run the bot as an ECS/Fargate service or equivalent persistent runtime, not as
  a serverless function.
- Add health checks for login state, shard readiness, last heartbeat ACK, Convex
  reachability, and Discord REST reachability.
- Track heartbeat ACK latency, reconnect/resume counts, interaction ACK latency,
  REST `429`s, invalid requests, command queue latency, and command failure
  counts.
- Use separate staging and production Discord applications if practical.
  Register staging commands as guild-scoped for fast iteration and promote
  production commands only after staging smoke tests.
- Include bot lint, typecheck, unit tests, mocked Gateway/REST integration tests,
  command schema checks, staging guild smoke tests, and deployment health checks
  in CI/CD.

## UX Direction

The control room must be dead simple during a live event.

Principles:

- Avoid making operators reason about internal adapters, codecs, or workers
  unless they need to fix a problem.
- Show a clear current state: current source, next source, output target, public
  watch link, PC/Quest links, and worker health.
- Keep emergency actions obvious and safe.
- Always preserve a direct-link fallback for in-world operators.
- Make setup checklists proactive: bitrate, keyframe interval, audio sample
  rate, codec, VRCDN region, stream key configured, provider consent.
- Visual design should be screenshot-reviewed and VLM-reviewed before declaring
  UI completion.
- The happy path should feel like: pick event, confirm sources, paste/set one
  output credential, start program.
- The direct-link fallback path should be visible and rehearsable before the
  event starts.
- UI should support a `v0.9` validation checkpoint before pushing toward `v1`,
  so the human can confirm direction while the implementation is still
  adjustable.

Candidate operator panels:

- setup checklist
- current program monitor
- source queue / lineup
- output links for PC, Quest, browser, and public event page
- hold slate and fallback controls
- audit/history panel

## Security and Compliance

Important requirements:

- Stream keys are secrets.
- Secrets must not live in ordinary event records or public media links.
- Worker logs must avoid secret values, full ingest URLs, and private tokens.
- Operator actions must be audited.
- Permission checks should use community ownership/staff capabilities once `#93`
  lands.
- Provider account credentials should be scoped by event/community/owner where
  practical.
- The product needs explicit rights and provider-compliance acceptance before
  starting managed restreaming.
- If VRDex becomes broadcaster-of-record, the terms, takedown path, and abuse
  controls need to match that responsibility.
- Twitch and YouTube should remain `watch_embed` or `watch_link` providers unless
  provider-approved source access and legal review are documented.
- VRDex must not scrape playback URLs, use hidden HLS/token extraction, download
  platform audiovisual content, or rebroadcast platform player output.
- Hold slates, intro/outro media, uploaded event art, waiting audio, VJ layers,
  and camera feeds are media sources with rights requirements.
- Hold music should be disabled by default unless the operator supplies or
  selects rights-cleared media.
- Hosted VRDex output should stay disabled until DMCA/takedown contact,
  repeat-infringer policy, abuse process, and legal/provider review gates are
  complete.

Candidate access model:

- `owner`: manage media program, credentials, outputs, staff, and billing.
- `admin`: manage event media programs and operator controls.
- `mod` or `operator`: run live controls during the event but not view or rotate
  long-lived credentials.
- scoped event key: limited command access for a specific event/session.

Candidate rights and compliance checklist:

- Event owner confirms they are authorized to run the event media program.
- Each performer/source owner confirms VRDex may ingest, process, switch, and
  forward their live source for this event.
- Operator confirms all music, visuals, hold slates, logos, intro/outro media,
  VJ layers, and camera feeds are cleared for the intended destinations.
- Operator acknowledges destination provider rules for every output target.
- Operator confirms the stream key or account belongs to them or they have
  authority to use it for the event.
- VRDex records who entered or authorized each credential without exposing the
  secret value.
- VRDex records source consent, provider-compliance acceptance, output
  destination, actor IDs, timestamps, and credential rotation or revocation
  events.
- VRDex provides an emergency stop/offline action and records who triggered it.

## Unit Economics and Business Model

There are two different businesses hidden under the word restreaming.

VRCDN-forwarding business:

- VRDex controls source switching and pushes one composed stream to the
  operator's VRCDN account.
- VRCDN handles viewer delivery.
- VRDex costs scale mainly with concurrent event workers and worker runtime.
- This can fit a premium workflow subscription without huge viewer-based risk.

VRDex-owned delivery business:

- VRDex ingests, processes, packages, and delivers streams to viewers.
- VRDex pays bandwidth/CDN costs per viewer-hour.
- Pricing must include viewer-hour or bandwidth limits.
- This needs stricter abuse, rights, reliability, support, and capacity planning.

Research notes:

- AWS live-streaming examples reinforce that viewer distribution is the expensive
  part of a VRDex-owned delivery business, while VRCDN-forwarding mostly pays for
  workers plus one outbound program stream.
- A CloudFront flat-rate plan might change delivery economics, but it needs
  separate validation for live streaming behavior, distribution count, sustained
  usage, and feature compatibility.
- `vrdex_pool` is closer to a managed broadcast product than a small
  implementation detail. It needs provider-compliance acceptance and
  support/abuse planning.
- `operator_owned` remains the lowest-risk path because provider responsibility,
  account authority, and bandwidth economics stay closer to the event operator.
- `vrdex_pool` has three cost layers: worker runtime, provider pool capacity, and
  support/risk cost from abuse review, takedowns, refunds, event failure support,
  account security, and provider escalation.
- Pooling only makes sense if provider capacity can be used across enough events
  to amortize idle subscription/account cost without creating unacceptable
  cross-customer blast radius.

Current business recommendation:

- Start with VRCDN-forwarding and operator-owned credentials.
- Keep VRDex-owned delivery as a future paid tier or enterprise/hosted option
  after usage data proves demand.
- Make the user value about operational simplicity, not cheaper bandwidth.
- During private validation, frame the operator value as one setup, one event
  control room, one public event page, one Discord-operable command surface, and
  clear PC/Quest/browser output links.

## Recommended Issue Slices

Current implementation recommendation: keep `#124` as the parent epic and split
first delivery into a small number of larger, independently testable slices.

Implementation orchestration recommendation: after a root contract pass, use the
candidate parallel worktree workflow in
`docs/agentic/parallel-worktree-delivery.md` to experiment with local leaf
worktrees before one integrated PR. The first control-plane/root contract slice
may need to be mostly sequential before the other leaves can safely fan out.

Issue 1: define event media control-plane schema, commands, and audit model.

- Model `eventMediaProgram`, sources, scenes, outputs, commands, sessions, and
  audit logs.
- Keep Convex as the authoritative control plane.
- Preserve direct-link fallback, separate PC/standalone/browser outputs, and
  public/private state separation.
- Accept start, stop, hold, next, source switch, fallback, and current public
  watch-state commands.

Issue 2: add operator-owned VRCDN setup, secrets, and rights/compliance gates.

- Implement the `operator_owned` account model only for first delivery.
- Store stream keys and output credentials only in encrypted/scoped secret
  storage.
- Capture VRCDN region, bitrate/keyframe/audio guidance, destination authority,
  source-owner consent, provider-compliance acceptance, and rights-cleared media
  state.
- Keep hosted managed output disabled unless source, rights, provider, takedown,
  and abuse gates are satisfied.

Issue 3: build local FFmpeg media-worker proof with watchable `1080p60` evidence.

- Prove source A, hold slate, source B, audio continuity, command-scripted
  switching, HLS artifact output, and transition evidence.
- Add local RTMP relay proof after HLS artifact output.
- Validate H.264/AAC, `1920x1080`, `60 fps`, `48kHz` audio, keyframe cadence,
  segment continuity, silence/black/freeze checks, and transition thumbnails.
- Use the same container entrypoint shape intended for hosted worker
  benchmarking.

Issue 4: benchmark hosted worker path on ECS/Fargate with GPU fallback decision.

- Publish worker image to ECR and run one ECS task per event media session.
- Add task roles, Secrets Manager injection, CloudWatch logs/metrics,
  EventBridge/Scheduler or operator start, worker heartbeats, log redaction, max
  workers, max duration, budget alarms, and manual kill switch.
- Benchmark 10 concurrent `1080p60` event-session workers before
  pricing/product commitment.
- Document whether Fargate CPU passes with headroom or whether ECS on EC2
  GPU/NVENC is required.

Issue 5: build shared operator control UX plus early Discord Gateway foundation.

- Web control room and Discord controls use the same command, permission, and
  audit model.
- Discord Gateway bot is implemented as deployable live-event infrastructure,
  not a toy integration.
- Operators can view current source, next source, output state, worker health,
  public watch links, PC/standalone links, and fallback links.
- Operators can trigger hold, next, source switch, fallback, and refresh/status
  from web and Discord, with confirmations for dangerous actions.
- UI has screenshot/VLM review evidence before completion.

Recommended order:

1. Control-plane schema, commands, and audit model.
2. Operator-owned VRCDN setup, secrets, and compliance gates.
3. Local FFmpeg proof.
4. ECS/Fargate benchmark and hosted worker IaC.
5. Operator control room plus Discord Gateway.

Open research only, not first implementation scope:

- `vrdex_pool` provider approval and commercial feasibility.
- VRDex-owned delivery.
- AWS MediaLive/MediaPackage as first delivery path.
- Twitch as raw restream input.
- YouTube or arbitrary platform rebroadcasting.
- Single universal VRChat playback URL without player-side/platform context.
- Monetized managed hosted output before legal/provider/takedown gates.
- Full VJ/camera automation beyond source-role fields and operator override.

## Open Research Questions

- Can ProTV, TXL, or another major VRChat video player accept a single
  VRDex-controlled URL that returns platform-appropriate playback without
  client-side platform information?
- If not, can VRDex still simplify dual-link entry by producing a pair of
  PC/Quest URLs or a world-friendly setup snippet?
- Do Udon and major player prefabs expose enough client-platform information for
  a single-link abstraction, or is dual-link entry inherently required because
  the server cannot know the viewer platform?
- Which VRChat video players are dominant enough to justify direct compatibility
  docs or a custom prefab integration?
- What exactly makes RTSP/RTSPT better for PC VRChat playback compared with
  MPEG-TS in current player stacks?
- Does Twitch allow the one-to-one pull/restream use case needed for operator
  switching, or should Twitch remain public-watch/direct-link only?
- Which worker implementation best supports hold slates, subtle transitions,
  audio loops, and live source switching with low operational risk?
- What is the lowest-cost reliable worker shape for 10 concurrent `1080p60`
  programs with high-quality audio?
- Should the first managed worker output be direct RTMP to VRCDN, or should
  there be an intermediate local/remote relay layer for preview and failover?
- How should scoped event keys be issued, revoked, and audited?
- What UX makes this feel effortless instead of like broadcast engineering
  software?
- Does VRCDN permit VRDex to push restreamed output through operator-owned
  accounts, and separately through VRDex-managed pooled accounts?
- Who is legally the broadcaster-of-record when VRDex operates the worker but the
  destination credential belongs to the event operator?
- Which jurisdictions matter first for takedown, repeat-infringer, and
  abuse-process design?
- Should VRDex allow monetized hosted restreaming before a legal/provider review
  pass?
- Can Fargate CPU satisfy the locked `1080p60` first-tier target with enough
  quality, cost, and reliability headroom, or is ECS on EC2 GPU/NVENC required?
- Should live commands flow through Convex polling/leases first, or should SQS
  become the live command path for isolation during outages?

## Research Checklist Flow

Open research questions should be treated as active checklist work, not as a
parking lot.

Process:

1. Turn each open question into a research card with owner, source links, current
   confidence, and decision impact.
2. Prefer fanout research when questions are independent, especially
   provider/player compatibility, Twitch policy, worker implementation, and cost
   modeling.
3. Bring findings back into this doc as decisions, recommendations, or explicit
   unresolved risks.
4. Do not start major implementation that depends on a research question until
   that question has a recorded disposition.
5. Use blind reviewer/subagent passes for major architecture conclusions when the
   research surface is wide.

Initial checklist:

- Research ProTV, TXL, and other major VRChat video-player dual-link and
  fallback behavior. Initial desk research captured above; in-world testing
  still needed.
- Research Udon/platform-detection limits and whether a single-link abstraction
  can work. Initial source review captured above; custom prefab proof still
  needed.
- Research RTSPT versus MPEG-TS behavior in common VRChat player stacks. Initial
  disposition captured above; player-specific live tests still needed.
- Research Twitch source/restream policy and technical feasibility. Initial
  disposition captured above; legal/provider review still needed before any raw
  Twitch input support.
- Research worker implementation options for switching, fade transitions, audio
  loops, and slate compositing. FFmpeg is the first proof recommendation;
  GStreamer remains the likely advanced-switching fallback.
- Research local automated validation techniques for live media output,
  including audio presence/sync and visual transition checks. Initial tooling
  list captured above; implementation still needed.
- Research ECS/Fargate versus ECS/EC2 GPU/NVENC cost and reliability for 10
  concurrent `1080p60` programs. Fargate is the first benchmark target; measured
  load tests still decide production shape.
- Research Discord interaction embed/button/select ergonomics and Gateway service
  rigor for live media control. Initial Gateway-first component-control model
  captured above; exact permission/channel/thread model still needs product
  direction.
- Research rights/compliance/takedown requirements if VRDex is
  broadcaster-of-record. Initial checklist captured above; legal/provider review
  still needed before managed hosted output.
- Research pricing model and unit economics for VRCDN-forwarding versus
  VRDex-owned delivery. Initial economics captured above; CloudFront flat-rate
  and VRCDN terms need further validation.
- Research `vrdex_pool` feasibility. Initial disposition captured above; provider
  approval is required before implementation.

## Suggested Final Gate

Gate decisions captured:

- `vrdex_pool` remains research-only until VRCDN/provider contact is complete.
- Early Gateway should include the runtime foundation plus explicit controls
  first; role sync and richer channel/thread context can remain follow-on unless
  required by the first control flow.
- Cloud IaC drafting can happen in parallel with the local worker proof, but
  hosted commitments remain behind the `1080p60` benchmark gate.
- The five issue slices above are the accepted implementation breakdown.
- The parallel worktree workflow is a local VRDex experiment first, with possible
  global promotion only after it proves useful.

Recommended next gate before implementation:

1. Create the integration branch/worktree and root contract packet.
2. Convert the five accepted slices into kickoff packets with dependencies and
   required checks.
3. Run the first root/control-plane pass mostly sequentially until the shared
   contracts are stable enough for fanout.
4. Start local worker proof and cloud IaC drafting in parallel behind the
   `1080p60` benchmark gate.
5. Treat `vrdex_pool`, VRDex-owned delivery, raw Twitch input, and global
   workflow promotion as out-of-scope until their explicit gates are reopened.

## Source Trail

Research notes were captured from primary docs where possible during the June
2026 planning pass. Re-check provider docs before implementing provider-facing
behavior, pricing, or public claims.

- [VRChat video players](https://creators.vrchat.com/worlds/udon/video-players/)
- [VRChat external URLs](https://creators.vrchat.com/worlds/udon/external-urls/)
- [ProTV docs](https://protv.dev/)
- [VideoTXL repo](https://github.com/vrctxl/VideoTXL)
- [USharpVideo repo](https://github.com/MerlinVR/USharpVideo)
- [VRCDN wiki](https://wiki.vrcdn.live/)
- [Discord interactions](https://discord.com/developers/docs/interactions/overview)
- [Discord Gateway](https://discord.com/developers/docs/topics/gateway)
- [AWS ECS Fargate tasks](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/fargate-tasks-services.html)
- [AWS ECS GPU workloads](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/ecs-gpu.html)
- [Twitch embeds](https://dev.twitch.tv/docs/embed/)
- [Twitch broadcast ingest](https://dev.twitch.tv/docs/video-broadcast/)
- [YouTube API Services policies](https://developers.google.com/youtube/terms/developer-policies)
- [U.S. Copyright Office Section 512 overview](https://www.copyright.gov/512/)

## Related Docs

- `docs/backend/event-schema.md`
- `docs/planning/product-spec.md`
- `docs/planning/architecture.md`
- `docs/planning/agent-integration-surface.md`
- `docs/agentic/feature-design-loop.md`
- `docs/agentic/parallel-worktree-delivery.md`
