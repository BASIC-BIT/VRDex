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

## Review fix round 1: retain valid post-window retry authority

Review base: `5d91839`. Addressed Important 1 from `task-8-review.md`.
The review correctly identified that retaining the owner's started boolean did
not preserve server authorization: disposing the relay adapter released the
valid grant, and a subsequent fresh event admission failed after calendar end.

The owner now calls an adapter's optional explicit `retry()` instead of disposing
that adapter on unavailable playback. Relay retry recreates only native media,
retains its grant, and calls `restartPlayback({grantId})` on that deliberate
viewer action. Healthy native-only retry returns the same admission with no
restart charge. Stopped/unavailable sources are queued under the original
unexpired, unreleased, context-current grant. Identity, issuedAt, expiry and
playlist URLs are preserved. Unsupported stays explicit Unsupported; no retry
transcode or automatic restart is introduced. Actual expired capability returns
an explicit expired result and the client uses ordinary new admission, including
the event new-start window. Released/revoked grants cannot restart. Close and
Pause fence pending restart completions, and Close still releases the grant.

The controller approved the narrow storage addition before implementation:
`mediaRelayRestartRate` is one indexed global row containing successful terminal
restart timestamps. The common quota helper sums recent issued grants plus
restart timestamps for both open and restart operations. Successful restart
prunes the rolling sixty-second history; the configured per-minute limit is at
most 10,000, bounding row growth. Transactional reads/writes serialize different
sources competing for the final slot. Duplicate retries of a now-queued source
are read-only and do not spend another restart. Source-cap checks are shared;
existing grants consume no additional grant slot, but lowered grant caps still
bound terminal restarts. No poll/get/foreground refresh can enqueue a source.

Self-review also found that retaining an adapter could retain an old Unsupported
reason across a successful retry and later unrelated native error. A focused
RED/GREEN regression now clears the prior reason when deliberate loading begins.
Minor 2 (readable storage with denied writes) remains deferred to Task 9 as
instructed; this round does not change mode storage.

### Exact RED/GREEN evidence

Commands below activated `/workspace/vrdex-env.sh` and used authorized additional
network permission for tsx, preserving proxy/CA settings.

Initial integration RED:

```text
node --conditions=import --import tsx --test --test-name-pattern='owner retry retains' tests/backend/media-relay-admission.test.ts
✖ owner retry retains a valid post-window grant through native failure and terminal source restart
AssertionError: actual 'unavailable', expected 'playing'
ℹ tests 1
ℹ pass 0
ℹ fail 1
```

This regression uses the actual owner and relay client against real convex-test
backend handlers. Only native media and worker readiness are fixtures. It first
plays within the event window, then ends the event, recreates failed native media
and recovers stopped/unavailable sources with the same grant. The unavailable
case invokes actual foreground refresh before deliberate Retry. It verifies one
grant, one initial open, no release before Close, and native recreation. Finally
it expires the grant and proves ordinary fresh event admission is denied.

The initial endpoint/quota RED command was:

```text
node --conditions=import --import tsx --test --test-name-pattern='explicit restart|shared rolling|restart keeps' tests/backend/media-relay-admission.test.ts
ℹ tests 3
ℹ pass 0
ℹ fail 3
Error: Expected a Convex function exported from module "mediaRelayPlayback" as `restartPlayback`, but there is no such export.
```

After implementation, all four original new cases passed:

```text
node --conditions=import --import tsx --test --test-name-pattern='owner retry retains|explicit restart|shared rolling|restart keeps' tests/backend/media-relay-admission.test.ts
ℹ tests 4
ℹ pass 4
ℹ fail 0
```

Additional coverage verifies two different terminal sources concurrently compete
for one remaining admission slot, exact rolling cutoff pruning, source capacity,
no additional grant slot, unsupported/expired/released/revoked denial, and
get/refresh non-restart behavior. A relay client regression proves the delayed
restart reply cannot recreate media after Close and never releases a valid grant
before explicit disposal.

Self-review RED command and output:

```text
node --import tsx --test --test-name-pattern='retained retry clears' tests/web/event-playback-owner.test.ts
✖ retained retry clears the previous unsupported reason before later native errors
AssertionError: actual 'unsupported', expected undefined
ℹ tests 1
ℹ pass 0
ℹ fail 1
```

Covering GREEN verification:

```text
node --conditions=import --import tsx --test tests/backend/media-relay-admission.test.ts tests/backend/media-relay-control.test.ts
ℹ tests 36
ℹ pass 36
ℹ fail 0
node --import tsx --test tests/web/event-playback-owner.test.ts tests/web/relay-playback-adapter.test.ts tests/web/native-hls-adapter.test.ts tests/web/event-playback-recovery.test.ts tests/web/event-playback-revalidation.test.ts
ℹ tests 36
ℹ pass 36
ℹ fail 0
```

The strengthened actual-refresh/expired-owner integration case additionally
reran alone and passed 1/1. `pnpm typecheck:web` and
`pnpm exec tsc --noEmit --project convex/tsconfig.json` exited 0.
`git diff --check` exited 0. No broad suite, UI/native device run or hosted
operation was needed for this scoped recovery correction.

Task 9 interface note: restart accepts only the exact original grant identity;
it cannot swap event/slot context or create another performer grant. Whether
preparing/promoting a different authorized slot after event end needs a scoped
same-event continuation admission proof remains a separate Task 9 controller
ruling. This fix supplies no broad event-window bypass.
