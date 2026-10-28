# Task 8 report

Status: DONE_WITH_CONCERNS. Retained profile/event HLS plumbing and focused local
verification are complete. Native lineup integration, final visual acceptance and
physical-device playback remain Tasks 9/12; rollout stays disabled.

## Implementation and API decisions

- Evolved the existing `EventPlaybackOwner`, provider and adapter factory. There
  is still one retained root owner and mount. `PlaybackRequest` is now a union of
  profile VRCDN identity and existing event identity/transport variants. Existing
  event-specific callers narrow their request types atomically. Profile playback
  bypasses calendar gating; event new-start and retained continuation semantics
  remain. No source or grant is opened on mount or preference restoration.
- `readPlaybackMode(storage)` / `writePlaybackMode(storage,mode)` use the shared
  `PlaybackMode` type, localStorage key `vrdex.playback-mode`, video default and
  best-effort memory fallback. `owner.setMode()` persists the viewer preference
  across DJs/routes/owners without autoplay. Async mode completions are fenced
  against newer mode, pause and close intents.
- `createNativeHlsAdapter({grant,mode,mount,notify})` receives a ready admission;
  owns stable video/audio nodes; selects native HLS first; dynamically imports
  the direct web dependency `hls.js` **1.6.16** only for non-native MSE. The lockfile
  includes only its importer/package/snapshot addition. No Web Audio connection.
  Switching pauses/unloads the old rendition before starting the target, retains
  the grant/nodes, closes PiP on audio and never requests PiP on return. Paused
  native controls stay paused. iPhone/iPad/iPod output volume is not written.
- `createRelayPlaybackAdapter` owns lazy explicit-Play admission, preparing polls,
  one cached dual-rendition grant, late-close release and cancellation fences.
  Client responses cross `AdmissionSchema`; unavailable unsupported remains
  explicit rather than initiating another transport. Slow native play rejection
  returns blocked for deliberate Enable playback. Mode changes reuse the same
  source/grant and metadata updates retain nodes.
- `RelayPlaybackClient` exposes `open(context,streamId,mode)`, `get(id)`,
  `refresh(id)`, `release(id)` returning unknown wire data. The provider maps
  these to `mediaRelayPlayback` functions; `createRetainedPlaybackAdapter` chooses
  this path only when supplied the explicitly enabled client.
- `NEXT_PUBLIC_MEDIA_RELAY_ENABLED` is off by default and documented in the web
  environment example and deployment guide. Disabled clients never call missing
  relay functions on mount. Saved audio is blocked without downloading legacy
  full video; deliberate Video then Play restores foreground legacy behavior.
  No legacy background capability is claimed. Enabled performer sequences are
  temporarily blocked rather than routed through legacy Web Audio.
- All actual profile VRCDN entrypoints now send profile ID/slug/display name to
  the retained owner, preserving existing WatchPlayPoster/utility patterns and
  feeding owner activity back into existing live-state sanity checks. Profile
  projection revalidation checks the exact canonical case-preserving link ID.
  Direct-video props keep initial and revalidated requests consistent. Multiple
  streams have distinct inline placement keys. Live profile title is
  `<display name> - VRDex`; original profile imagery remains unchanged.

## Controller-approved grant lifecycle

Added `mediaRelayPlayback:refreshPlayback({grantId})`. It uses server time and the
existing grant/context authorization, rejecting released, revoked and exactly
expired capabilities. It extends an unexpired grant to twelve hours only within
its final hour. Indexed reads are bounded, concurrent mutations serialize, and
subsequent calls do not write for eleven hours. It preserves ID/playlist URLs and
never admits, creates or restarts a source. Metadata-only edits remain authorized.

`retainForegroundGrant` runs a single-flight refresh on visibility return and once
per minute while visible; hidden/inactive cleanup does not renew. Native playlist
requests, not browser timers, sustain source demand. Owner refresh is optional for
legacy adapters. On deliberate resume after locally known expiry, the adapter
resolves the old capability first (a recovery response may have hidden a server
extension), then uses ordinary fresh admission only when no longer valid.

The controller explicitly ruled that a valid in-window event capability may
continue after the window and refresh while active. After twelve hours of
background expiry, fresh event admission may be denied outside the window. An
independently public profile can still admit. No unconditional Resume promise or
calendar bypass was added.

## RED/GREEN and self-review

Observed RED for profile Play rejected by the event calendar; absent mode/native/
relay modules; absent backend refresh export; native paused-controls switching
incorrectly resuming; old video playlist remaining attached after audio selection;
missing legacy rollback factory; missing foreground-only refresh scheduler;
expired resume incorrectly replaying its old native adapter; and unsupported
admission losing its explicit reason. These passed after the respective changes.
Additional focused regression tests cover stale toggle completions, one audible
source, late native playing events, PiP exit, denied storage, no autoplay, MSE
selection/cleanup, metadata/grant reuse, pause/close during admission, and
profile/event request/revalidation behavior.

The first restricted tsx invocation was not meaningful due sandbox/process limits;
subsequent runs used the authorized additional network permission and preserved
proxy/CA settings. Missing-module RED results are recorded honestly as missing
implementation boundaries, not assertion-level behavior evidence. The initial
ready-admission fixture used a string contextRevision; corrected it to the shared
schema's numeric type before using it as integration evidence.

React checklist review: root lifetime remains stable, effects unsubscribe/clear
intervals, refresh is visibility-bound/single-flight, no heavy HLS import on mount,
request dependencies preserve metadata-only nodes, and new buttons use utility
labels/explicit accessible names. No substantive new authored product sentences.
New utility labels are Audio, Video and Unsupported; existing Play/Enable playback
and WatchPlayPoster patterns are reused.

## Verification

All commands activated `/workspace/vrdex-env.sh`. No broad repo suite ran.

- Focused web command: `node --import tsx --test tests/web/{playback-mode,native-hls-adapter,relay-playback-adapter,event-playback-owner,event-playback-request,event-playback-revalidation,event-playback-recovery,foreground-playback,profile-rendering-boundary,event-lineup-player}.test.ts`: **44/44 passed**.
- `node --conditions=import --import tsx --test tests/backend/media-relay-admission.test.ts`: **19/19 passed**, including renewal expiry/release/revocation/post-window and metadata/URL stability.
- `pnpm typecheck:web`: exit 0. Existing generated MPEG-TS `.ts` fixtures under
  `playwright-artifacts` initially caused binary parse errors; web tsconfig now
  excludes that generated artifact directory without modifying the fixtures.
- `pnpm exec tsc --noEmit --project convex/tsconfig.json`: exit 0.
- Focused ESLint on new mode/native/relay modules and provider/profile components:
  exit 0, no diagnostics.
- `pnpm install --frozen-lockfile --ignore-scripts`: exit 0. Initial pnpm add
  re-resolved unrelated dependency graphs; restored those exact baseline lock
  entries and retained only the hls.js addition before frozen verification.
- Actual Next webpack fixture smoke: local `/playwright/event-persistent` compiled
  in 8.4 seconds and returned HTTP 200. Added media-relay to transpilePackages;
  source exports and browser lazy HLS import compile in the real app. Initial
  127.0.0.1/Clerk proxy reset and leftover owned-process lock were resolved by
  stopping the owned process and restarting the local credential-free fixture on
  localhost. Proxy/CA environment remained intact. This is compilation/render
  evidence, not native-media playback or screenshot/visual evidence.
- `git diff --check`: exit 0.

## Task 9/12 handoff and limits

- `createRetainedPlaybackAdapter` currently blocks performer_sequence with an
  enabled relay client. Task 9 must replace that branch with native lineup
  observation/control, preserving existing following/boundary behavior. The
  legacy EventLineupSession path is untouched when rollout is disabled/video.
- `createRelayPlaybackAdapter` currently maps event_stream sourceId to both
  canonical stream ID and selectedSourceId. Performer sequences need explicit
  event context with the slot playbackKey separate from canonical streamId.
  The client open contract already separates context and streamId; add that
  context input to the adapter as part of Task 9, without a second coordinator.
- Native adapter owns selected media internally and exposes owner play/pause,
  setMode, volume/mute, update/dispose. Task 9 should extend observation hooks for
  current/prepared status without routing these elements through Web Audio.
- Compact Audio/Video controls and profile retained placement are preliminary
  integrations. Screenshot/VLM and final responsive visual evidence are pending
  Task 9/12, coordinated with the controller. No complete-UI claim is made.
- Real Safari/iPhone lock-screen/background/PiP/hardware behavior, desktop real
  media MSE startup, live VRCDN compatibility and hosted grant/gateway delivery
  remain acceptance gates. Synthetic media DOM tests establish lifecycle logic,
  not physical-phone behavior. No hosted mutation, deployment/apply, public tunnel,
  credential provisioning, resource enablement or security posture change ran.

## Final native-event race correction

Controller requested one final event-notification review after commit `617e24e`.
Two focused tests observed RED: a queued `playing` notification could report
playing while its selected element was already paused, and a genuine native/OS
Resume after native pause was overly fenced. The adapter now checks `node.paused`
alongside disposed/current/desired state, and a new native `play` event on the
current nonpaused element records fresh intent. A late `playing` event alone
cannot recreate that intent; old-mode events remain fenced and disposal removes
both listeners. This preserves native Resume without trusting stale completions.

Exact added tests are `queued playing event cannot report playback while the
selected element is already paused` and `genuine native play event resumes after
native pause while a late playing event alone stays fenced` in the native adapter
suite. Both failed before the fix and passed after. Focused native-adapter plus
owner rerun: **20/20 passed**, including late-play promise, rapid mode toggle and
close/pause intent fences. No broader suite reran for this event-listener change.
