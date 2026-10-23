# Twitch inputs and event operator controls

Status: current recommendation, ready for design review. This document extends the merged event-broadcast design. It does not authorize implementation by itself.

## Intent and success

Locked direction from BASIC: deliver this work in one PR, with multiple implementation and review rounds as needed. Event hosts keep one stable program link while DJs change. The console must support off-lineup inputs and manual cutoff. Automatic switching uses silence, stream death, and optional maximum overrun, rather than switching exactly at scheduled boundaries. Avoid additional independent product toggles. Preserve the existing persistent event player across navigation.

The research establishes a feasible Twitch acquisition path, not a shipped integration. Success means a host can select a lineup input or add a custom source, preview it, Take it safely, cut to slate during preparation, and return to automatic operation. Worker replacement must preserve the committed manual choice within the same session. Temporary media loss must not erase that choice.

Locked decision: BASIC confirmed that this PR must include 1080p-only Twitch channels and let hosts choose 720p or 1080p program output in the site's stream settings. Accept supported input up to 1080p60 and select source renditions relative to the chosen output resolution. Additional dual-1080p capacity proofs cover both output options before merge; completed 720p-output research does not establish a fixed product limit.

Current recommendation: custom sources in this PR accept VRCDN stream links and Twitch channel URLs. Generic HLS, RTMP ingest, arbitrary HTTPS endpoints, authenticated/private Twitch playback, browser cookies, and browser automation are outside this increment. Existing deployment-authorized endpoint behavior remains supported internally.

## Approaches considered

| Approach | Benefit | Cost | Decision |
| --- | --- | --- | --- |
| Extend the current worker with provider acquisition and explicit control state | Reuses renderer, output fencing, persistent playback, and handoff policy | Requires coordinated backend/worker contracts | Recommended |
| Create a separate restreaming service | Can own acquisition independently | Adds another deployment, lease, network boundary, and failure path | Defer until measured scale requires it |
| Add URL entry and keep the existing command loop | Small initial UI change | Leaves blocking preparation, cutoff races, and lost manual intent unresolved | Insufficient for the requested controls |

This is one feature across existing components, not a new streaming platform. Changes are limited to input selection, acquisition, operator intent, and the UI that exposes them. Destination configuration, dispatcher scheduling, and event playback ownership remain existing responsibilities.

## Operator experience

Keep the current operator route. Its first section shows actual program state, committed automatic/manual/slate mode, and any pending operation. Show freshness explicitly through existing status conventions. Never display a queued command as an observed on-air source.

The source list groups lineup sources and event custom sources. Each row contains label, provider, provider-reported live state when fresh, source link/copy action, Preview, and Take. Only sources prepared by the worker have worker readiness. Provider live status alone never makes a source safe to promote. Preserve Unknown when a source is unprobed, stale, or its provider cannot answer.

The primary controls are Take, Cancel, Cut to slate, and Return to auto. Retain Start/Stop and existing useful Next/Hold current behavior, routing source-changing operations through the same control protocol. Do not add a separate Prepare button. Do not require a settings toggle for Twitch inputs, buffering, warming, or manual controls.

| Action | Result |
| --- | --- |
| Preview | Opens a local muted preview; broadcast and automatic handoffs continue |
| Take | Prepares one candidate while retaining the committed source, then enters manual mode and promotes it |
| Cancel | Cancels preparation before promotion begins; committed source and mode stay unchanged |
| Cut to slate | Supersedes pending work and holds slate until another explicit operator action |
| Return to auto | Prepares a currently eligible automatic candidate; during a schedule gap, enters automatic mode on slate and waits for the next interval |
| Failed preparation | Preserves the previous committed source and mode |
| Stop | Uses the existing terminal session shutdown and publication fencing |

Manual Take remains manual until Return to auto. A subsequent schedule boundary does not undo it. A second ordinary Take is rejected while preparation or promotion is pending; Cancel and Cut remain independently available. Retry after cancellation is a new operation with a new idempotency key. A Return-to-auto preparation failure from slate keeps slate; from a manual source it keeps that source. With no eligible automatic candidate, preserve the existing behavior: commit automatic mode, confirm slate, and prepare the next interval when appropriate. This explicit release of manual control is not a failed preparation.

Cancel ends at the atomic transition from preparing to promoting. Do not offer an apparent undo while waiting for encoded confirmation. After promotion begins, Cut is the way to interrupt. The UI shows Preparing, Switching, Cancelled, Failed, or completed on-air state, without exposing adapter implementation details.

Custom source authoring requires the existing `manage_event_media` capability. Adding, renaming, and disabling sources does not require editing DJ profiles. Authoring can create the event media program idempotently without starting a broadcast or requiring a configured destination. Changing a custom endpoint creates a replacement source record; the old record stays unchanged and remains on air until an explicit Take or removal. Label-only renames are harmless. Removing a pending source cancels preparation. Removing an active source atomically disables it and establishes slate intent. Preserve audit history.

## Preview and live indicators

Use the existing foreground playback coordinator. A preview is local to the operator view and must not call the global event playback owner's `play()` method. Explicit Monitor acquires foreground audio before unmuting. Closing preview releases its ownership; it does not unexpectedly resume another player.

The current Twitch adapter cannot observe native iframe mute changes. Keep its muted preview noninteractive until Monitor acquires focus, then expose interaction. An external provider link remains available. Audio exclusivity applies inside VRDex, not across external tabs or devices.

Reuse `event-source-observations.ts` and the existing VRCDN/Twitch status readers. Keep their four-probe concurrency, 30-second cache/refresh, ten-second aggregate wait bound, and 60-second observation freshness. Prioritize current, next, previewed, and visible sources. A request supplies a bounded window rather than probing all 64 event sources or spawning media decoders. Custom-source status requests use authorized event records, not arbitrary client URLs. Unqueried rows remain Unknown.

## Input selection and compatibility

Add a broadcast-only slot selection with two variants: `{kind: "vrcdn", streamId}` and `{kind: "twitch", channel}`. Canonical keys derive from those values as `vrcdn:<id>` and `twitch:<lowercase-login>`. Reuse the current canonical Twitch parser and its reserved-path rules through a dependency-safe shared helper. Do not accept signed playback URLs as authored Twitch inputs.

This is separate from `selectedStreamId` and the public VRCDN `PlaybackStream` contract. The performer-sequence watch mode and its PC/Quest links retain their existing meaning. The event-stream editor gains a broadcast input selector. Changing the performer clears that broadcast selection, as the existing stream selection does today.

Resolution order is deterministic:

1. Preserve an explicit broadcast selection. If it disappears or becomes hidden, report unavailable without changing provider.
2. Preserve an existing explicit VRCDN `selectedStreamId` when initializing an event's broadcast choice. If missing, do not substitute Twitch.
3. With one eligible VRCDN stream, use it. With several, require a choice.
4. Only with zero eligible VRCDN streams, use the profile's first valid public typed Twitch channel, following the existing profile live-claim helper.

Store canonical input references on event media sources with a positive revision. Legacy source rows normalize from their validated type/URL until backfilled; new broadcast writes use the canonical reference. Do not rewrite unrelated asset/source kinds. Derive worker configuration and public provider links from the same reference so probing and broadcasting cannot target different channels.

The stable event output remains VRCDN. Existing optional Twitch destination support is independent of Twitch input acquisition. Quest viewers consume the event's VRCDN output and do not need direct Twitch playback support.

## Output quality settings

Add one Resolution selector in the event's stream settings. Locked options are 720p and 1080p; current recommendation adds 480p as a lower-bandwidth option. All three run at 30 fps for this increment, mapped to `480p30`, `720p30`, and `1080p30` renderer profiles. The proposed 480p profile is 854x480 with an initial 1,000-kbps video bitrate; validate its visual quality alongside the existing 720p/1080p profiles. Preserve 720p30 as the default for existing events. A separate frame-rate selector, 60-fps output, and per-destination quality controls are outside this increment.

Persist the validated quality preset on the event media program and snapshot it on each new session. The worker configuration passes that immutable session preset to the renderer. Primary VRCDN output and any configured simulcast use the same encoded program. Preserve source aspect ratio with scaling and padding. Lower-resolution sources remain usable in a 1080p program, but upscaling cannot add missing detail.

Current recommendation: a settings change during an active broadcast applies to its next session. Keep the running encoder and publisher on their session snapshot; show the active and next-start values distinctly when they differ. Do not restart an on-air broadcast implicitly or claim a live resolution change. Seamless in-session encoder reconfiguration is outside this PR.

Worker allocation follows a checked-in, server-owned mapping from quality preset to the smallest capacity-tested CPU/memory shape. The host chooses resolution, not infrastructure settings. The dispatcher uses the immutable session preset to select an allowed shape; the worker rejects unsupported or mismatched configurations before publishing. Tests may establish the same shape for several presets. Lower output resolution reduces output bandwidth and encoding work but does not remove the cost of decoding high-resolution inputs; do not promise lower compute cost without measurement. No provider-specific resource knobs or automatic silent quality downgrade are introduced.

## Operator diagnostics

Current recommendation: add a collapsed Diagnostics disclosure to the existing operator console, accessible under its existing read authorization. This is an operator tool, not a public event-page widget or a new staff-only debug route. Normal program/source/destination health stays visible without opening it. Do not add historical charts, arbitrary time ranges, alert configuration, a new telemetry service, or CPU/memory allocation controls in this PR.

The disclosure shows recent worker CPU usage as a percentage of its allocated vCPU, memory used versus its allocation, the running output preset, and sample freshness. Read the worker container's cgroup counters so Python, decoders, encoder, and sender processes count. Node-only process usage is insufficient. Memory is total cgroup usage including page cache, not RSS or an estimate of free heap. Use the validated session allocation as the denominator; do not use the host's CPU count or assume the container exposes a finite cgroup quota.

Sample cumulative CPU and current memory every ten seconds. Compute CPU from counter delta divided by actual monotonic sample duration and allocated vCPU. Attach a newly sampled snapshot to an existing worker control report and retain only the latest snapshot on the session; no extra frontend polling loop or AWS metrics API calls. Include a per-epoch increasing sample sequence, sample-window duration, and monotonic sample age at send. Derive observation freshness from backend receipt time minus sample age, conservatively allowing for the bounded control-request duration. Reject out-of-order samples and clear resource observations on worker replacement. Do not stamp an old sample as newly measured when sending an ordinary heartbeat.

Before two CPU samples exist, show CPU as Unknown; independently available memory can still display. Unsupported/missing measurements and measurements older than 30 seconds display Unknown instead of zero. Diagnostics collection failures never stop publication, alter committed intent, or bypass normal health checks. High CPU by itself does not declare a stream broken or silently change resolution; actual media progress and destination health remain authoritative.

## Control state and ownership

Separate desired intent from rendered observations. The session stores a committed intent with exactly three variants: automatic, manual with source ID and revision, or slate. It also stores at most one pending operation with preparing/promoting phase, target, actor, sequence, deadline, and captured prior committed intent. Source-free manual intent is invalid. Program-level current source remains a rendered observation, never the restart authority for manual intent.

Backend transactions own admission, idempotency, sequence allocation, cancellation, promotion eligibility, and durable Cut. The worker owns acquisition, decoder readiness, renderer selection, and encoded-output evidence. Keep the existing lease epoch and destination fencing; ordinary control operations do not create new publisher leases.

Use the existing per-session command sequence as the operation identity and add an explicit current intent sequence. Every async acquisition, readiness callback, promotion, and acknowledgment carries session, lease epoch, intent sequence, source ID, and source revision. Superseded work cannot modify current intent.

### Take and Return to auto

1. Admit one pending preparation transactionally, keeping the committed intent unchanged. Pin the target revision. Return an existing operation for duplicate idempotency keys.
2. The worker suspends automatic handoffs and retires automatic standby acquisition before preparing the candidate. The current source continues.
3. Acquisition warming completes asynchronously. The candidate decoder must then establish fresh progressing A/V under the existing readiness checks.
4. Before selecting, the worker requests an atomic preparing-to-promoting transition. Recheck actor authority, source availability/revision, destination authority, lease ownership, deadline, and current intent sequence.
5. That transition ends Cancel eligibility and durably commits the target intent before renderer selection. A replacement worker in the same session can therefore recover it.
6. Select the candidate and confirm actual encoded output before marking the operation complete. Do not use provider status or selection-call success as an acknowledgment. Return to auto during a schedule gap follows the same authorization/commit/confirmation boundary with slate as its immediate rendered target, without an acquisition attempt.

If preparation fails, expires, or is cancelled, retain prior committed intent, release the candidate, and recalculate automatic standby from the current timetable. If the target input fails after promotion begins, report the failure and render fallback slate while retaining the newly committed intent for recovery. Fatal program-encoder or publication failure still ends/fences the session through the existing mechanism. Do not promise automatic rollback after media may already have reached viewers.

### Cut and cancellation

Cut admission atomically advances intent sequence, commits slate, and supersedes older pending operations. The worker prioritizes that intent over ordinary queued commands, cancels acquisition, and calls renderer hold without waiting for provider cleanup. It continues output publication and confirms encoded slate. An older command cannot block Cut acknowledgment through the existing ordered-command rule.

The preemption guarantee begins when the worker receives Cut. A promotion already granted before a later Cut reaches the worker can have emitted media. Network delivery and downstream player buffers cannot be undone. Keep local Cut independent of preparation locks and awaitable network operations.

Cancel transactionally changes a preparing operation to cancelled. It cannot cancel a promoting operation. Duplicate cancellation is harmless. Cut and Stop remain available during either phase. Terminal Stop outranks Cut: once stopping is accepted, reject new Take, Cancel, Cut, and Return-to-auto requests. Cut supersession cannot cancel, reorder, or delay lifecycle Stop.

### Observations and restart

Attach intent sequence and output watermark to worker observations and acknowledgments. Source identity and watermark must describe the same coherent renderer snapshot. Accept only the owning epoch, current intent sequence, and nondecreasing output progress within that epoch. Reject old same-epoch observations without treating them as publisher-fatal lease failures. Duplicate acknowledgments are idempotent. Explicit stale/superseded results differ from revoked authority or stale lease.

Temporary media loss or advertisement fallback changes observed source to slate but leaves desired manual intent intact. Restart in the same session reads that intent and revision. Starting a new explicit broadcast creates a new session in automatic mode and does not revive an earlier session's manual source.

A replacement worker reclaims the same pending receipt under its new lease epoch. It revalidates the pinned source and acquires fresh media; it does not reject its own recovery as a second pending operation. Preserve the original operation identity and expiry. A preparing operation can still fail without changing committed intent. A promoting operation retains its committed target, cannot become cancellable again, and can complete the original receipt after encoded confirmation. If its original confirmation deadline has expired, mark the receipt failed without rolling back committed intent; ordinary source recovery continues. Never restore a profile projection revision whose public link has been removed or hidden.

Actor revocation blocks new actions and promotion still in preparation. It does not retroactively terminate an already committed broadcast. Destination revocation continues to fence publication. No changes to the existing 12-hour session limit or dispatch admission cap are required.

## Acquisition architecture

Introduce a worker input-lifecycle boundary shared by the existing guarded VRCDN relay and a Twitch acquisition adapter. Its handle owns source identity/revision, bounded preparation, a loopback MPEGTS endpoint, structured state changes, and idempotent cancellation/disposal. Network acquisition never blocks the control tick, lease renewal, program encoder, or emergency hold.

For Twitch, resolve the canonical channel using packaged Streamlink. Accept supported H264/AAC input up to 1920x1080 at 60 fps, including channels with no 720p rendition. Prefer the highest available rendition at or below the selected output resolution and 60 fps; otherwise select the smallest supported rendition above that resolution and at or below 1080p60. A 1080p program therefore uses an available 1080p rendition; a 720p program can select 720p or scale down a 1080p-only input. Reject audio-only or unsupported renditions cleanly. Normalize supported MPEGTS and MP4-family input through paced copy-remux before handing media to the existing decoder. Output is H264/AAC at the session's chosen 720p30 or 1080p30 preset. This approved scope requires the additional capacity proofs below; the completed public research covered 720p inputs and 720p output.

The initial reservoir targets two seconds of warmup with a hard four-MiB compressed buffer per Twitch input and ordinary backpressure. This is a bounded warmup target, not a guaranteed two seconds of source media. Make buffered-byte and elapsed-warmup facts observable internally. Validate sufficient reservoir behavior through the deployed-version jitter and long-run tests below; if it fails, revise the reservoir rather than relaxing readiness.

Model acquiring, warming, transport-ready, ad-wait, unavailable, and cancelled independently of decoder-ready. Start the decoder only when normalized media is available. Keep the existing one-second A/V/progress freshness and five-second decoder startup/stall enforcement. Acquisition plus warming plus initial decode has a 15-second preparation budget beginning at worker receipt, with a persisted expiry to prevent abandoned work from resuming after replacement.

Keep at most two acquisitions and two decoders per session: committed/current and standby/candidate. Browser preview does not count against that bound. A cancelled attempt cannot leave subprocesses or an extra acquisition alive. Stop the encoder or report encoded completion independently from cleanup of acquisition children.

Use five-second provider HTTP timeouts and a two-second DNS bound in the pinned fetch boundary. After first normalized media, 15 seconds without further normalized output ends that acquisition attempt, including an advertisement wait. Cancellation terminates the acquisition process group with at most one second of graceful shutdown before forced termination. These outer bounds also cover library waits. For a live input that dies or returns authorization/expiry errors, discard the locator and resolve the canonical channel again. Use the existing reconnect delays of one, two, four, eight, then ten seconds capped thereafter; retry lifetime is bounded by the session. Reset decoded silence evidence after reconnect.

Advertisement waits are missing-media evidence, not musical silence or decoded readiness. Preserve committed intent while existing automatic policy decides whether an eligible successor may take over. Never synthesize successful readiness through filler timestamps. Anonymous channels that require authentication or client-integrity/browser challenges become unavailable; no cookie collection or browser bypass is part of this design.

## Network and packaging

Package Streamlink 8.6.2, Requests 2.34.2, urllib3 2.8.0, and locked transitive dependencies in the worker image at build time. No runtime pip installation. Use the existing deployed FFmpeg major for acceptance proofs. Keep child processes within the existing nonprivileged, bounded task environment and writable temporary directory.

The experimental Requests transport is a candidate implementation requiring production contract coverage. Every Twitch request, including redirects, playlists, media, initialization data, and keys, passes one boundary. Allow only approved Twitch API/CDN HTTPS hosts on port 443. Reject credentials, cookies, custom authorization/Host headers, unsupported protocols/ports, client certificates, disabled certificate verification, and inherited proxy configurations. Disable Chromium fallback.

Resolve public IPv4 once per connection, reject mixed public/private or special-range answers, and connect to the validated numeric address while retaining original TLS hostname/SNI and certificate checks. Never re-resolve the hostname after validation. Do not mutate global urllib3 pools. Unknown CDN hosts fail closed and require a reviewed allowlist change. Do not bypass the managed development executor's proxy to run the direct transport; use the isolated worker environment.

Keep signed locators only in worker memory. Log structured error codes, durations, bounded byte counts, revisions, and operation identifiers. Do not retain raw provider diagnostics, request tokens, signed URLs, cookies, or response bodies in ordinary telemetry.

## Integration boundaries

| Responsibility | Existing code and intended change |
| --- | --- |
| Input identity and slot projection | `convex/_eventPlayback.ts`, `convex/eventMediaWorker.ts`, slot validators/editor serialization; add broadcast-only selection without changing public playback types |
| Event source management and control | `convex/schema.ts`, `convex/_eventMediaControl.ts`, `convex/_eventBroadcastInputs.ts`, `convex/events.ts`; add canonical revisions, control state, authoring, cancellation, and status projection |
| Worker protocol | `convex/eventMediaWorker.ts`, `workers/restream/event-worker.mjs`; ordered intent, promotion grant, nonfatal supersession, and observations |
| Output quality and allocation | Program/session schema, stream settings, worker config/renderer construction, ECS bridge, and checked-in deployment configuration; immutable quality preset and validated resource mapping |
| Media lifecycle | `source-relay.mjs`, `input-supervisor.mjs`, `program-renderer.mjs`, focused new acquisition modules; bounded asynchronous warmup and disposal |
| Twitch transport and packaging | Focused Python adapter/transport modules, locked requirements, `workers/restream/Dockerfile`; normalized media and outbound boundary |
| Operator/editor/preview | `event-operator-view.tsx`, `event-host-view.tsx`, `event-editor-form.tsx`, existing foreground and player helpers; source list, controls, and local preview |
| Provider hints | Existing event source-status reader and host-status projection; authorized canonical source windows with preserved bounds |
| Operator diagnostics | Focused worker cgroup sampler, fenced session resource snapshot, existing control-status query and operator disclosure; no new monitoring service |
| API contracts and documentation | Existing API/MCP event authoring contracts and schemas, generated bindings, engineering/deployment/playback docs; preserve caller compatibility |

Split source management and control transition helpers out of large existing files where they are modified. Avoid an unrelated events/backend rewrite. The implementation plan will name exact new files, exported signatures, test ownership, and task interfaces after this design is reviewed.

## Verification and merge criteria

Use layered tests that exercise real framework and media behavior where available:

- Convex tests prove capability checks, canonical selection precedence, unavailable explicit choices, custom-source revisions/removal, idempotent admission, Cancel versus promotion, Cut supersession, stale observations, actor/destination revocation, and same-session restart recovery. Test late results across both intent sequence and lease replacement. Verify quality defaults, validated preset persistence, immutable active-session snapshots, and changes applying only to a subsequent session.
- Real worker tests hold candidate acquisition indefinitely and prove control ticks, lease renewal, current media, Cut, Cancel, and Stop still progress. Verify all child process groups close after cancellation and failure. Verify at most two live acquisitions/decoders.
- Pinned transport contracts cover private/mixed DNS, rebinding, redirects and nested resources, original TLS hostname, invalid certificates, proxy refusal, forbidden headers, connection reuse, slow DNS/TLS/body cancellation, unknown hosts, and dependency-version compatibility.
- Deployed-version media fixtures cover paced MPEGTS and MP4-family input, delivery jitter, three-second cold acquisition plus warmup, advertisements, midstream failure/403, changed playback locator, bounded persistent failure, and cancellation during a provider wait. No false-ready during ad waits, reset silence evidence on reconnect, and retain existing silence/death/overrun behavior.
- A buffered public AWS run lasts at least 30 minutes, keeps both inputs decoding, switches A to B and to slate, and has zero unexpected post-startup readiness drops. Independently verify output format, packet progress/order, actual source identity, audio/video sync, and bounded processes/memory. Include publisher overhead in a subsequent end-to-end run, since research recording did not measure it.
- Verify two 1080p60-only input fixtures on the deployed worker separately with 480p30, 720p30, and 1080p30 output, first at four vCPU/eight GiB for each preset. Require the same zero-drop gate, existing live-delay budget, and sampled CPU P95 below 80% of allocation during steady dual-input operation. If a preset fails that shape, repeat it at eight vCPU/16 GiB. A passing preset may be tested at two vCPU/four GiB and then one vCPU/two GiB to establish a lower allocation; stop at the first failure and retain the smallest passing shape. Record the measured mapping, not an assumption that 480p needs less CPU. If neither initial shape passes, return to the capacity/encoding design rather than silently excluding promised channels, removing a selected output option, or weakening readiness. Also verify a lower-resolution source in a 1080p program and mixed source resolutions across a Take. Assert actual encoded dimensions, visual quality, and frame rate for all presets, dispatcher allocation, and worker configuration consistency.
- Resource-sampler tests cover cumulative CPU deltas over real elapsed sample windows, normalization to allocated cores, all child-process usage, memory units/cache semantics, the initial missing CPU sample, counter reset on replacement, unsupported counters, delayed reports, stale/old-epoch snapshots, and collection failure while output continues. Verify only new samples refresh resource-observation time and no resource fields enter public event projections.
- Browser tests cover custom input entry, source status freshness, Take and cancellation boundaries, Cut while busy, failed Return to auto, muted preview and Monitor audio ownership, persistent event playback through navigation, resolution selection, active versus next-start settings, and operator diagnostics access/freshness. Follow repo-required desktop/mobile screenshots and VLM review using shared UI primitives.
- An owned event rehearsal checks the stable output link, audible synchronized handoff, cutoff, reconnects, and persistent playback. Record actual PC and Quest playback separately. If hardware or a real provider ad is unavailable, keep that evidence gap explicit; do not label it verified or invent a new feature toggle.

Readiness thresholds must match the user experience. The research harness's 95% both-ready threshold cannot be the seamless-playback acceptance gate. Valid packet timestamps alone cannot detect fallback slate, wrong source identity, or lip-sync errors.

## Evidence informing the design

Research on October 22 used the existing worker renderer on AWS with two public Twitch 720p60 selections and independently verified 720p30 H264/AAC output. The 25-minute unbuffered run had seven readiness losses totaling 6.545 seconds, all while that source was selected. A separate ten-minute run with initial buffering had zero losses. Both averaged about 2.51 CPU cores on a four-vCPU/eight-GiB task. Upstream conditions and durations differed, so these are not controlled provider comparisons.

Local controlled jitter tests support the reservoir mechanism. A failed buffered startup remains preserved alongside successful repeats. A cold acquisition test showed why warming must not consume the decoder startup deadline. Local fixtures used FFmpeg 7.1.5; deployed-version proofs remain necessary.

A pinned-fetch AWS smoke decoded real Twitch media with public-IP pinning and TLS verification. Controlled fault tests exercised fresh resolution, bounded repeated 403, and cancellation. No real provider advertisement or forced provider token expiry was observed. The 25-minute run crossed token-expiry metadata by about five minutes; that does not prove a playback locator actually expired.

All four research tasks stopped and all research task definitions were made inactive. Capacity numbers include local recording/cache and exclude destination publishing/fanout; they are not a claim of leak-free or 24/7 operation. The research report and raw traces currently live under `/tmp/vrdex-twitch-round2`, with independent audit and operator/fault/transport fixtures in adjacent research directories. The requirements above carry the findings into durable repository documentation without depending on those temporary artifacts.

## Delivery

Deploy the new control contract with no active sessions, so an old worker cannot accept a new promotion or cancellation it does not understand. Backfill canonical references and normalize legacy control state once. Preserve a valid recorded manual source when available; a legacy manual state without a recoverable source becomes slate rather than guessing. Do not infer missing historical intent from provider status or silently revive old commands. New sessions identify their control protocol version, and backend mutations reject unsupported worker protocols before promotion. Keep this a compatibility/version check, not a user-facing feature toggle.

Use one implementation PR with independently testable commits for canonical inputs/source management, durable control protocol, acquisition/packaging, selectable output quality and validated capacity mapping, operator/editor integration with bounded diagnostics, and full-flow verification. Preserve the previously chosen subagent-driven implementation method. Review the written design before producing the task-by-task implementation plan. Keep deployment/configuration changes reproducible and include documentation alongside the behavior they describe.
