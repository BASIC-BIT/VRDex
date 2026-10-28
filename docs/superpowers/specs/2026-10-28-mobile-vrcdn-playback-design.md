# VRCDN mobile playback and shared HLS relay design

Status: design draft for BASIC's review. Architecture and product choices below
are distinguished from proposed implementation defaults. This document authorizes
no production deployment, permanent relay, new paid resources or spending level.

## Intent and locked decisions

Make VRDex's existing VRCDN players useful for listening while changing apps or
locking a phone, and for watching through native Picture in Picture (PiP).

BASIC selected:

- Default availability for every VRCDN stream played through VRDex; no owner opt-in.
- Shared relay workers, rather than a dedicated container for each stream.
- A Video / Audio only toggle on video players, backed by real audio-only delivery.
- Audio-only stays selected across DJ changes until explicitly changed.
- Now Playing shows the DJ name with `- VRDex` and DJ artwork carrying the
  approved VRDex wordmark; original profile images remain untouched.
- Existing lineup behavior is preserved. This project adds no automatic
  background lineup switching where the site does not already support it.

Proposed defaults: remember mode in this browser across visits, without account
sync or autoplay; use the same HLS delivery on desktop; use AWS for the relay pool
and media origin, reusing the existing ECS/Terraform operating approach. These
details are recommendations, not previously approved production policy.

## Evidence and limits

The experiment lives under `scripts/mobile-media-spike/`. BASIC reported successful
prerecorded HLS video/audio on iPhone Safari, then successful live HLS relay
playback. Direct VRCDN MP4 worked on desktop but failed on iPhone with media error
4. Range probes returned chunked 200 instead of partial content; that is a
candidate compatibility issue, not a uniquely established root cause. VRCDN HLS
URL variants returned 404 during an active broadcast.

Stream-copy HLS packaging worked with H.264/AAC. Timestamp warnings remained.
The live audio-only rendition contained AAC and no video track and passed a short
decode. BASIC has not separately confirmed that live audio-only rendition. Exact
iPhone model, iOS, listening durations and exported phone logs were not supplied.
Android, long-session recovery and production capacity remain unverified.

The short-lived Vercel Sandbox and its expiring relay are experiment infrastructure,
not a production dependency. No native app is required for the demonstrated path.

## Approaches considered

1. Shared packaging workers with CDN delivery: selected by BASIC. Packs several
   independent streams into a worker while viewers share CDN objects. Needs bounded
   per-stream jobs, explicit ownership and worker failure recovery.
2. One task per stream: simpler isolation/accounting, but more launch latency and
   allocation overhead for a packaging workload. Not selected.
3. Native apps or direct provider MP4/HLS alone: no app is needed for demonstrated
   HLS playback; direct provider paths did not satisfy the tested Safari case.
   Revisit provider-native HLS if independently verified later.

## Viewer experience

Opening a page creates no media connection or relay session. A deliberate Play
starts or joins playback; source authorization is checked by the server. A loading
state covers cold startup, with explicit retry if it fails. There is never muted
autoplay merely to bypass a phone's gesture requirements.

The root playback owner retains media across navigation. Extend the current
event-root ownership to profile playback rather than introducing a second global
owner. Context is a discriminated profile/event request; event requests retain
their existing new-start calendar gates, publication checks and revocation rules.
Profile playback must not inherit event-only watch-window requirements.

Mode is a viewer preference, not a DJ, event or relay property. The proposal is a
browser-local persisted `video | audio` value, default video. Storage unavailable
means in-memory preference. Returning to the site never resumes audio without a
gesture. Closing the player ends playback but retains the preference.

Audio-only uses a native audio element and an audio-only playlist. Artwork replaces
video. Toggling retains the selected source/DJ and pause/mute intent; hardware
volume remains authoritative on iPhone. Returning to video joins that same source
near its live edge, not whichever DJ a schedule would select for a new session.
Do not promise gapless or exact-position switching in v1.

Both playlist URLs are available in the current playback grant before toggling.
Pause the old element and call play on the target within the toggle gesture; never
leave two audible elements. If the target fails, offer retry/return to the prior
mode without silently starting a different source. Paused playback stays paused.
Switching to audio closes video PiP. Returning to video does not force PiP.

Use native HLS whenever the browser supports it, particularly Safari. A desktop
MSE HLS adapter can cover browsers without native HLS. It is not evidence that
JavaScript HLS survives mobile OS suspension; physical Android tests gate claims.
Twitch retains its provider adapter and existing limitations.

## Placement and responsibilities

Proposed AWS topology:

```text
VRDex page -> root playback owner -> playback admission (Convex)
                                      |
                             source lease + worker placement
                                      |
                         shared ECS packaging worker pool
                         one FFmpeg child per active source
                                      |
                       private S3 segments + rendition snapshots
                                      |
native player <- manifest gateway <- CloudFront media hostname
native player <---- signed, cacheable segments ---- CloudFront
```

Vercel continues serving the app. Convex owns public-context authorization,
playback grant records, worker registration, placement, source ownership epochs
and configuration. A dedicated manifest gateway validates playback grants,
checks current authorization, resolves the active epoch, and serves uncached
playlists. It is not an FFmpeg host. Immutable segments use private S3 and CDN
delivery, not Vercel Function proxying of every video byte.

Initial infrastructure proposal: ECS/Fargate pool, private S3 media bucket,
CloudFront with origin access control, and a small API Gateway/Lambda manifest
gateway. A DynamoDB demand table coalesces latest media activity per stream; it
stores transport observations, not lease authority. Existing AWS account/region
and network infrastructure may be reused after inventory and an isolated plan.
Do not reuse event credentials, roles, task families, buckets or kill switches
implicitly; relay resources and IAM scope have their own owner in Terraform.

## Caller contract and state ownership

Conceptual calls, not an approved implementation API:

```text
openPlayback(publicContext, selectedSource, preferredMode)
  -> preparing(retryAfter) | ready(grant, videoPlaylist, audioPlaylist, metadata)
  | unavailable(reason) | capacityLimited(retryAfter)

GET stable rendition playlist with scoped grant
  -> current fresh HLS manifest, or explicit preparing/retry/unavailable response

worker claim/renew(streamKey, workerIdentity, epoch)
  -> bounded ownership authority, or denial requiring immediate fencing
```

Normal callers pass a public source reference, never a fetch URL, bucket key,
worker address, ingest credential or resource allocation.

The logical source key is provider + normalized VRCDN stream ID + packaging
contract version. It excludes profile, event and viewer IDs: the same public
source reached through different pages shares packaging. Authorization remains
per playback context, so removing an event's link revokes that event's grants
without disrupting an independently authorized profile listener.

Context revisions refer to playback-relevant source identity/visibility and event
policy, not every profile edit. Bio, title or artwork changes must not revoke a
healthy source session. An already-started event keeps the existing post-window
continuation rules; revalidation must not reinterpret it as a forbidden new start.

Keep these entities separate:

- Playback grant: opaque ID, source, authorized context/revision, allowed
  renditions, expiry and revocation state. May belong to a guest.
- Source session: desired demand, ownership epoch, state and active media paths.
- Worker: verified identity/allocation, capacity, lease, drain status and health.
- Local packaging job: one source acquisition, one FFmpeg child, bounded local
  storage and upload queue, publication progress, retry state and cleanup.
- DJ metadata: authorized display identity and artwork revision, separate from
  transport identity and viewer preference.

Model source session as stopped, queued, starting, ready, recovering or draining,
with state-specific fields. An upstream HTTP 200 or healthy worker heartbeat
does not mean fresh playable media exists.

## Demand, sharing and shutdown

One authorized source owner and normally one upstream connection produce both
renditions for all viewers. Deduplicate concurrent Play requests transactionally.
No page mount, liveness badge or crawler request creates demand. Anonymous playback
is allowed under the existing public-page policy; owner opt-in is not introduced.

The native player repeatedly fetches an uncached rendition playlist while playing.
These requests refresh interest independently of browser JavaScript timers. The
gateway coalesces updates to a monotonic per-stream `lastManifestRequestAt` in the
demand store, at most once per ten seconds per gateway instance. Segment cache
hits do not need to reach the origin or be counted as heartbeats. Do not write a
Convex mutation per segment/viewer request or depend on delayed CDN logs.

Proposed idle grace: three minutes after valid playlist activity stops. This covers
buffered phone playback and brief network switches; verify it with real devices.
Once idle, stop source acquisition, terminate the child, fence publication and
retire its files. Pause/Close can signal release as a hint, but cleanup must work
when the app disappears without sending one. Cached remaining media can play
briefly after revocation or shutdown; it cannot be remotely unplayed.

Playlist traffic may sustain an admitted session but cannot create a new one or
restart a terminal failure. Only fresh Play admission may do that. Proposed source
recovery budget: at most thirty seconds without fresh output, then mark unavailable,
release the packaging job and require an explicit retry under normal rate limits.
This prevents a native client's repeated playlist fetches from buying endless
upstream retries while the page's JavaScript is suspended.

Initial grants expire after twelve hours, with refresh while the app is active.
Expiry while backgrounded requires a deliberate resume afterward; do not claim
unlimited unattended playback. They authorize public playback only, not worker
administration. Rate-limit admission and grant issuance, bound simultaneous source
starts, and include copied/replayed grants in abuse tests. A gesture cannot be
trusted as a server-side anti-abuse guarantee.

Both renditions are initially packaged while a source is active, avoiding upstream
restart on mode toggles. Audio-only saves listener video transfer/decoding; it does
not eliminate the relay's video-bearing upstream or all origin packaging costs.
Demand-based suppression of the unused video rendition is a later optimization.

## Packaging, publication and recovery

Initial supported contract: H.264 video and AAC audio, stream-copied into MPEG-TS
HLS, with an approximately two-second target and a rolling window. Actual segment
duration follows available keyframes. Measure end-to-end latency; do not promise
two-second latency or fabricate independent segments without verifying keyframes.
Unsupported input gets an explicit unsupported result, not a hidden expensive
transcode. Video/audio presentation clocks must be aligned and tested.

Begin with the MP4 provider input proven by the experiment behind the guarded
acquisition boundary. Extend its exact allowlist and media type; the existing
guard currently permits canonical MPEG-TS and hardcodes its content type. Do not
pass arbitrary remote URLs directly to FFmpeg. Pin validated public DNS addresses,
reject redirects/credentials/private destinations, and bound header/body stalls.

Upload complete immutable segments before publishing a playlist that references
them. Names include stream key, ownership epoch and a monotonically increasing
sequence. Private bucket access and CDN signatures protect origin access. Use
short-lived segment URLs with at least five minutes for buffered playback; the
uncached manifest renews URLs without JavaScript. Cache keys must not fragment
the shared object cache by viewer, while authorization is still checked.

Worker leases use server authority conservatively anchored to a monotonic clock.
A per-job watchdog runs independently of slow control-plane calls and child IO.
Lease loss fences publication before awaited cleanup. Old epochs can write only
their obsolete namespace; the gateway never publishes them as current. Do not
claim physically zero overlapping sockets under every partition: bound takeover
by lease expiry, fence resumed workers and measure duplicate-acquisition windows.

Output freshness, not input connectivity, gates ready state. Proposed stale bound:
three actual target durations, with a minimum ten seconds. Never serve an old
playlist as healthy indefinitely. On transient failure retain playable buffered
media, retry source acquisition with jittered bounded backoff, and update state.
EOF alone is not proof that a DJ ended. Repeated failures enter explicit retry
instead of an endless spinner. Recovery stays on the selected stream.

Ownership/reconnect changes produce a valid discontinuity and increasing media
sequence; stable playlist URLs resolve the current epoch. Test native Safari across
these transitions, including lost responses, missing objects and codec/clock changes.
If native playback cannot recover automatically, expose the real failure and a
gesture-based Resume. Do not fallback to the direct MP4 path already rejected by
Safari or silently replace a background-capable path with the old JS transport.

Stopping/draining terminates children, closes provider sockets and removes only
the session's local files. SIGTERM has a bounded wait and SIGKILL escalation.
S3 lifecycle removes retired epoch objects; it is housekeeping rather than a
lease/revocation mechanism. Parent and child resource limits protect other streams.

## Existing code to reuse, adapt or exclude

Inspected source:

| Existing piece | Production relay use |
| --- | --- |
| `workers/restream/source-relay.mjs` | Reuse guarded acquisition and teardown after adding the exact MP4 contract; its current content type and source allowlist cannot be used unchanged. |
| `resource-sampler.mjs`, `worker-allocation.mjs`, `task-metadata.mjs` | Reuse pure cgroup sampling and verified allocation checks; keep metrics off the media critical path. |
| `event-worker.mjs` | Reuse lease/watchdog/fence and bounded-operation patterns. Extract only truly generic utilities with migrated callers; do not import the whole event worker for a helper. |
| `input-manager.mjs` | Reuse proven cancellation/generation ideas; its event current/next warm-source orchestration is not the shared relay registry. |
| `infra/terraform/restream-worker/` | Reuse ECS/ECR/logging/deployment conventions after inventory; use separate relay tasks, grants and enablement. |
| `event-playback-owner.ts`, provider and adapters | Extend the root lifetime/one-audible-owner contract to profile and HLS playback; retain event revalidation and route survival. |
| `event-lineup-runtime.ts`, observed source | Preserve existing following policy. Web Audio processing and native background playback need an explicit adapter boundary, not a transport string substitution. |

Exclude the event renderer/mixer, crossfades/slates, ingest/output credentials,
VRCDN/Twitch publishing, event controller commands and event-scoped authority as
the shared relay control model. This service consumes public streams and packages
for viewers; it does not publish a composed event program back to VRCDN.

Existing lineup following pauses analysis/preparation/handoffs in hidden documents.
Retain that contract. Native current-source playback may continue while hidden;
frontend timer suspension must not tear it down. Foreground handoff behavior must
remain covered by the existing tests. No stream-wide server DJ switching is added
just to support a locked phone.

For the native-HLS path, do not route current playback through Web Audio. The
existing observed source permanently connects its element through an AudioContext;
merely suspending analysis would not restore a native output path. The current
approved following policy does not use silence for handoff, so the HLS observation
adapter should expose media progress/readiness/failure directly and use native
element mute/volume for prepared and current sources. Preserve the existing
failure/boundary policy with those observations; do not invent dBFS values to fit
the old interface. Make audio-level observation explicitly unavailable for this
adapter. Foreground native warm-source promotion/autoplay rejection remains a
real-device gate, with the existing explicit enable/retry gesture when required.
Migrate the native lineup path and its callers together rather than retaining a
parallel Web Audio owner. MediaSession resumes must use the same owner/fences.

Cold admission can outlive the initiating gesture. Treat a rejected native play
promise as blocked playback requiring an explicit Play/Resume gesture, not as a
failed stream or permission to start muted. Measure this extra-tap case when
choosing warm capacity; do not claim one-tap cold startup until tested on Safari.

## Now Playing and artwork

One metadata owner follows the actually playing source, not a prepared next DJ.
Title is `<DJ display name> - VRDex`. Use the authorized profile image and approved
wordmark to create a cached derivative keyed by image revision and brand version.
Do not replace the profile asset or fetch arbitrary client-supplied artwork URLs.
Fallback to the published stream/event identity and a neutral VRDex image if no
DJ association is authoritative; do not guess the current performer from wall time.

Metadata-only edits do not restart playback. Publish long-cache immutable image
URLs and clear/reassign metadata on Close or ownership change. Test Safari image
fetching with actual access rules. iOS owns Now Playing/Island layout; there is no
custom Live Activity, animated-artwork promise or track recognition feature here.

## Capacity, cost and operational controls

Measure CPU, memory, local disk/upload queue, bytes in/out and active source count
for packaging before setting streams per worker. Do not copy the event renderer's
multi-vCPU allocations or the sandbox's single-stream capacity as a production
benchmark. Shared worker failure affects several sources; cap that blast radius.

Proposed launch: one region, a small warm pool for reasonable startup, explicit
per-worker/global source limits, bounded admission queues and reserved recovery
capacity. Scale by source demand and measured resource pressure, not viewer count
alone. Viewers mostly add CDN egress. When new-source capacity is exhausted, give
an honest retry response and protect existing listeners; do not start unbounded jobs.

The budget model includes warm compute, gateway/demand-store operations, storage,
segment uploads, CDN egress, logs and networking (including NAT/public-IP choices).
Estimate traffic as bitrate times listening duration times listeners; audio-only
and video audiences differ substantially. Region, warm minimum, source caps,
traffic limits and the dollar ceiling must be set in an owner-reviewed deployment
plan using current rates and measurements. This draft claims no fixed monthly
price or approved spending amount.

Implement admission/traffic ceilings and an emergency switch in addition to billing
alerts. Billing observations are delayed, so alerts alone are not a hard dollar
stop. Drain/rollback policy and resource deletion must be explicit in the runbook.
Relay enablement is independent of the event-broadcast emergency switch.

## Verification and rollout gates

1. Isolated media proof: multiple concurrent sources, one acquisition per source
   under normal load, true audio-only output, stable timestamps/keyframes, missing
   segments, slow clients, reconnects, child cleanup and isolated failure.
2. Control proof: simultaneous Play admission, deduplication, expired leases,
   stale-worker fencing, authorization revocation by context, copied grants,
   demand grace under suspended browser timers and CDN cache hits, and exhaustion.
3. Product integration: profile/event navigation, retained player, native controls,
   one audible owner, persistent mode, pause/mute, toggle failure, actual-current-DJ
   metadata, and existing lineup timing/visibility/revocation behavior.
4. Physical iPhone Safari and Android Chrome: Video/Audio only switching, PiP,
   app switching, 30-minute lock, headphone/lock-screen controls, network changes,
   worker recovery, artwork, and source stop/restart. Record OS/device and logs;
   timestamp progress alone does not establish audible output.
5. Load/cost proof: measured source packing, warm/cold startup, playlist request
   rate, origin upload load, CDN transfer/cache behavior and a reviewed budget.
6. Staged operational rollout with small caps and rollback. The eventual product
   default remains all eligible VRCDN streams, not owner opt-in or a new paywall.

The old production path remains rollbackable behind operational rollout controls.
Do not silently advertise background support during a fallback to that path.
No implementation begins until BASIC approves this design.

## Calls for review

The shared-worker choice, default availability, persistent audio mode and branding
are locked. Main proposed calls: AWS topology; browser-local persistence across
visits; source/grant/session separation; native-HLS-first adapters; three-minute
idle grace; twelve-hour grants; and stream-copy H.264/AAC v1. Validate numeric
defaults in device/load testing. A deployment budget is a later release gate,
not an inferred authorization to provision production now.

## Design review

A read-only builder review identified the native-lineup observation boundary and
cold-start gesture requirement as planning blockers. Both are explicitly resolved
above; the reviewer then reported no important questions left. This is a design
completeness check, not implementation verification or approval by BASIC.
