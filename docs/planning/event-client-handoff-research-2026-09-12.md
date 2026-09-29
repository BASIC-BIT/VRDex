# Client-side event stream handoff research

Status: current recommendation, for discussion. Inspected 2026-09-12. No implementation or live provider test performed.

## Recommendation

A browser-only event player is a sensible first slice. Reuse the public lineup, approved performer stream selection, and existing VRCDN player. Automatic advancement is enabled by default on the event page. Treat silence-triggered advance as a small subsequent experiment, because silence, transport failure, and broadcaster completion are different signals.

Locked decision: BASIC approved default automatic advancement in the follow-up to this research. The event page should feel like attending the live event in-world as closely as practical. Starting playback joins that experience without a separate automatic-advance opt-in. This does not establish a silence threshold or remove browser playback-start requirements.

This supplies a website watch experience. Each viewer switches independently. It does not create a stable stream URL for a VRChat world player or a synchronized event-wide operator decision; those still need a routing or restream layer.

## What exists

- `apps/web/src/app/_components/vrcdn-stream-player.tsx` uses `mpegts.js` with the public `.live.ts` transport, not HLS. Its comments record that the assumed HLS manifest returned 404 while the stream was live. This is repository evidence, not a new provider test.
- The player waits for a viewer click before opening a stream, releases the connection on failure/unmount, supports volume/fullscreen, and presents retry after `ended` or error. The final handling explicitly recognizes that clean EOF can be CDN connection recycling, not broadcaster completion.
- A source prop change alone is insufficient: `failed`, `ended`, and `connected` states need deliberate reset, and a persistent video element is preferable for playback continuity and autoplay permissions.
- `apps/web/src/app/_components/event-watch-surface.tsx` gates the watch surface at event end (or start plus six hours), refreshed every minute. An already-playing overtime set must survive that boundary to support the proposed after-end handoff policy. Separate initial watch availability from continuation of an active listening session.
- `workers/restream/live-control.mjs` implements FFmpeg source/hold switching and optional fades through explicit commands. `runProofTimeline` schedules synthetic A/hold/B changes. `workers/restream/vrcdn-poc.mjs` exercises provider relay. `scripts/restream-live-control-proof.mjs` measures a deliberately quiet interval. Searches found no implemented silence/hysteresis-driven automatic lineup handoff in these worker or browser surfaces.
- `docs/planning/restreaming-media-control.md` proposes silence/black/freeze checks. Reuse the source/hold model and transition fixtures, not a supposedly complete browser detector. A separate external restream bot, if that is what BASIC meant, remains uninspected.

## Proposed transition policy

1. Viewer starts playback with following the event lineup already enabled. Current recommendation: manual selection/hold pauses following the lineup until the viewer returns to live playback.
2. Choose the next slot from the same stage and ordered schedule, with one explicit source per slot. Never infer the correct source from the first profile link when DJ and VJ links coexist.
3. Eligibility begins at `nextSlot.startsAt - 120 seconds`. Also require `currentSlot.endsAt - 120 seconds` when both timestamps exist, so malformed overlaps cannot cut a set prematurely. The latter is a recommendation to reconcile BASIC's two phrasings; normal back-to-back slots make them identical. Missing times, overlaps, gaps, and multiple stages need explicit behavior rather than a guessed global next performer.
4. Once eligible, local EOF or sustained failure makes a handoff candidate. Debounce for at least one second and cancel on recovery. A local stall or network error is not proof the performer stopped; use the term local playback stopped in internal state.
5. Start/validate the next connection, require actual media progress rather than HTTP success, and commit only if it is playable. If next is unavailable, remain in recovery/manual selection and retry with bounds. Do not cascade through all later slots or back-switch automatically.
6. Keep the one-second value as a minimum confirmation interval, not a promise to switch in one second: transport buffers, next-stream startup and browser scheduling add latency.

## Silence option

Decoded audio can feed a Web Audio analyser for RMS/peak measurement. Measure upstream of viewer gain/mute, require an active AudioContext and progressing media, and clear evidence when paused, suspended, or stale. A muted tab, suspended context, failed analysis path, or frozen player must never count as observed source silence. True musical silence can still occur during a live set; the timing gate reduces this risk without eliminating it.

A one-second quiet threshold is worth testing as the user's proposed behavior, not declaring reliable from desk research. Record loud/quiet fixtures, short dropouts, a long musical break, and encoder output that continues silently after the performer finishes. A stronger later rule can require next-source readiness plus quiet audio for a measured duration, with a manual override.

Web Audio explicitly requires silence for a media resource classified CORS-cross-origin. The current MPEG-TS path fetches and transmuxes through MediaSource, so verify that exact pipeline experimentally rather than assuming the direct media URL rule prevents analysis or that current playback proves analyser compatibility. [Web Audio specification](https://www.w3.org/TR/webaudio-1.0/#MediaElementAudioSourceNode-security)

## Browser constraints and scope

- MPEG-TS playback requires correct provider CORS response headers. The library also documents live buffer settings and deferred source opening in background tabs. Preserve the working transport and avoid inventing an HLS integration for VRCDN. [mpegts.js livestream documentation](https://github.com/xqq/mpegts.js/blob/master/docs/livestream.md), [API](https://github.com/xqq/mpegts.js/blob/master/docs/api.md)
- Audible `play()` can be rejected, and Web Audio startup is subject to autoplay policy too. Keep one viewer-started media element where possible, handle the returned promise, and leave a usable play control after rejection. An initial click improves feasibility but does not guarantee future unprompted playback on every browser. [MDN autoplay guide](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Autoplay)
- `stalled` means expected media data is not arriving. It cannot identify whether the viewer's network, CDN, or broadcaster caused the interruption. [MDN stalled event](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/stalled_event)
- Timers can run late in inactive tabs. Compare timestamps instead of counting timer ticks; on resume, discard stale silence evidence and reacquire playback state. A hidden/suspended phone tab cannot carry a strict one-second switching guarantee. [MDN timer throttling](https://developer.mozilla.org/en-US/docs/Web/API/Window/setTimeout#reasons_for_delays_longer_than_specified)
- Prewarming the next stream can shorten the cut but opens an additional viewer connection. Start with connect-on-handoff and accept a startup gap; if needed, add one bounded next-stream prewarm only inside the eligibility window and only after the viewer starts playback. Never instantiate every performer preview on page load. Current source comments identify provider viewer capacity as the reason for click-to-connect.

## Bounded proof before product commitment

Use two controlled public test sources: A audible, A musical silence, A disconnect/reconnect, B late/offline, and B ready. Exercise before and after the two-minute boundary, one-second blips, source edits, manual hold, mute/pause, and last slot. Check Chromium, Firefox, and Safari where playback is supported, foreground and background. Confirm no connections before play, no false advance when the viewer pauses/mutes, connection release, and a visible recovery path after autoplay rejection. This answers the remaining feasibility questions without deploying a restream worker.
