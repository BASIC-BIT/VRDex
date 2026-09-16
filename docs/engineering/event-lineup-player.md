# Event lineup player

The event page supports an organizer-selected `event_stream` or
`performer_sequence` mode. The latter starts with following enabled, but makes no
media connection until the viewer presses Play. New-session controls appear only
inside the existing doors-open/start/end watch window. The shared clock refreshes
on its normal interval and when document visibility changes. An already-started
session stays mounted after the window closes. It requires no media worker,
relay, provider key, or paid entitlement.

## Ownership and updates

`EventPublicPage` retains its server-provided content until one event-scoped
`events.getPublicBySlug` subscription has an authoritative result. That projection
updates both the roster links and the watch component. A null projection removes
the page content and releases playback. Cancellation, disabling watch, and mode
changes unmount the lineup session. There is no subscription per performer.

`EventLineupSession` owns one current source and at most one prepared next source.
A generation check runs before creating an asynchronous source and again before
accepting playback results. Projection edits, manual selection and disposal
invalidate prepared requests. A pending current connection reconciles its captured
slot again when accepted, so a unique replacement key remains the active final
slot for overtime pause/resume. Pause also invalidates initial transport imports and
source play attempts awaiting audio-context resume. Sources are owned before
awaiting playback, so hiding a source or unmounting releases them even when
resume or play completion never resolves. Exact slot keys retain source identity. Replaced
keys require exactly one matching performer slug, authored start and selected
normalized stream ID. A hidden or changed selected source stops the session and
requires viewer action. An unchanged stream may retain its connection while its
slot key changes.

The existing standalone `VrcdnStreamPlayer` API is unchanged. It and the observed
event source share `attachVrcdnTransport` and `releaseVrcdnTransport`. Event playback
uses different buffered-failure handling, with the existing `VrcdnPlayerControls`
and play poster. Transport setup failure releases partially attached players;
teardown attempts every transport step even if an earlier step throws.

## Following policy

Wall time selects schedule candidates. Monotonic `performance.now()` timestamps
measure audio progress and failure intervals. The two clock domains are never
subtracted. Current playback retains its slot identity across schedule boundaries.
A healthy source is never cut off because its posted end has passed.

Only the immediate next slot can be prepared. Missing, freeform and unplayable
slots are barriers. Out-of-order or overlapping schedules do not automatically
advance. Eligibility is the later of current end and next start, minus 120 seconds.
If current end is absent, next start provides the handoff boundary only.

Each decoded source routes through an analyser and source gain before the shared
viewer gain. Prepared source gain is zero. Three consecutive progressing samples
are required before it is ready to replace the current source. Viewer mute and
volume affect output gain, not silence measurements.

The measured policy is below -90 dBFS for 1000 ms, sampled every 100 ms. Continuous
stopped playback requires at least 1000 ms. Healthy decoded progress cancels
failure evidence, including when bytes remain buffered after transport failure or
clean EOF. EOF alone neither releases buffered playback nor advances the lineup.
A genuine long silent musical break can satisfy the silence rule; it does not
prove that the broadcaster has finished.

Retries use 1, 2, 4, then 10 second intervals. Replacing a prepared connection also
observes the first retry interval to avoid immediate reconnect bursts after
pause/resume or edits. A pending `video.play()` promise cannot block retries.
Failed next-source attempts retain the current source. Pause disables transition
decisions and releases preparation. Play rejection leaves the shared Play action.

Manual selection disables following. Return to live re-evaluates the scheduled
slot. Resuming following also re-evaluates it, except an already-active final slot
can resume after posted event end. New sessions after event end are refused. There
is no automatic wraparound.

## Browser visibility

Hidden documents deliberately stop analysis, preparation and handoff decisions;
current audio can continue. Visibility changes and audio-context state changes
clear evidence. The first active sample after a reset does not inherit old timers.
Sampling gaps over 500 ms also reset evidence. This is foreground automatic
following, not a claim of background switching or OS-suspension support.

## Verification

The guarded `/playwright/event-lineup-live` route mounts the actual public page,
query hook and player. Only its Convex transport boundary is mocked. Backend
`event-playback-projection.test.ts` tests the actual public query and projection,
including hidden links, removed sources, cancellation and unpublished events.
Only the guarded fixture overrides schedule time. The loopback MPEG-TS server
provides audible, quiet, connected silent, musical-break and unavailable sources.
Browser tests also map the canonical event-stream fetch to loopback inside the
test page. This tests URL resolution and the existing player without contacting a
live provider.

Run with the same local fixture server and environment variables documented in
[event-playback-proof.md](event-playback-proof.md), replacing the test filename
with `event-lineup-live.spec.ts`. The test explicitly launches Chromium and Firefox
and attaches screenshots, browser messages, connection statistics and visibility
observations. Each proof-server invocation generates private MPEG-TS files in a
unique directory and removes that directory after stopping its media processes.
Simultaneous invocations cannot truncate another server's transport inputs. Generated artifacts remain ignored under
`apps/web/playwright-artifacts/`.

Safari is unavailable on the Windows test host. A mobile viewport verifies layout,
not Safari/iOS audio or hardware-volume behavior. Live-provider CORS/encoders and a
human listening comparison require separate evidence. Native visibility results
must be read from the recorded browser attachment, not inferred from headless
foreground playback.

The September 15 product runs passed Chromium and Firefox lifecycle and recovery
cases. Both peaked at two connections and ended with zero connections and FFmpeg
children. Chromium minimization and Firefox foreground-tab attempts both left
`document.visibilityState` as `visible` on this headless host. Real native hidden
window behavior therefore remains unverified. The dev Issues indicator in the
controlled-failure screenshots corresponds to injected HTTP 503 and EarlyEOF
transport errors; neither run recorded an uncaught page error.

One isolated-fixture Firefox run reported an uncaught error with the message
`Object`. A focused follow-up with stack and rejection diagnostics passed, but
the earlier error remains unclassified. The failed report is preserved as
`playwright-artifacts/task-5-isolated-final.json`, with its extracted failure in
`event-playback-proof/firefox-unclassified-error.json`. The clean follow-up does
not establish that this error is fixed.

## Transport cancellation ownership

The shared transport uses mpegts.js 1.8.1's supported customLoader interface.
`VrcdnFetchLoader` owns fetch, the response reader, and all cancellation promises.
It keeps range/seek headers, configured headers, credentials, referrer policy,
redirect notification, byte offsets, content length, EOF and HTTP/read errors.
The mpegts parser, media-source player, stash buffering and public controls remain
unchanged. This loader serves the current HTTP(S) VRCDN MPEG-TS callers with Fetch
and ReadableStream; it does not add WebSocket or legacy XHR transport support.

A deterministic Firefox browser test held a naturally fulfilled response until
after player unmount. The original library then called body.cancel without
returning or handling its promise, producing an uncaught native AbortError from
FetchStreamLoader.open. The maintained loader handles rejected cancellation only
for its owned cleanup; active HTTP/read errors still reach the player error
callback. No global rejection filter is installed. Reader cancellation and late
response fulfillment are generation-scoped so obsolete callbacks cannot change a
new request.

This reproduces and fixes a concrete teardown leak consistent with the historical
Object symptom. The historical recording did not retain the exception fields, so
its exact identity remains unprovable. Preserve that failed artifact alongside
the cancellation RED/GREEN evidence; a clean rerun alone is not the explanation.

The [final local verification ledger](event-lineup-verification.md) records the
connected authored-event serialization test, final editor snapshots and remaining
operational evidence.
