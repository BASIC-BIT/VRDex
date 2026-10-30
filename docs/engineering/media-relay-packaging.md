# Guarded media packaging

`@vrdex/media-relay/worker/packager` provides the server-only `startPackager`
entry point. Importing the shared package root does not load child-process or
HTTP code. The implementation requires FFmpeg and FFprobe on the worker PATH.

Each call owns one attempt: one guarded upstream GET and one FFmpeg process
with a single input. The source descriptor contains identity, never an arbitrary
URL. FFmpeg is forced to the MP4 demuxer with external data references disabled
and only HTTP/TCP input protocols allowed, so mislabeled nested playlists cannot
create decoder-authored acquisitions. The worker constructs the exact case-preserving VRCDN MP4 URL. The relay
accepts `video/mp4`, refuses redirects, validates every DNS answer as public IPv4,
and pins the chosen address. Its default DNS resolver belongs to that connection,
has finite retry/timeout settings, and is cancelled on disposal. The legacy
injected lookup hook retains its physical-completion disposal contract; an
uncancellable injected lookup can delay disposal. Existing MPEG-TS relay callers
retain their default endpoint/content-type behavior.

FFmpeg copies H.264 and AAC into MPEG-TS HLS video and AAC-only audio outputs.
There is no transcoding fallback. Bounded stream diagnostics and local completed
segment probes reject unsupported codecs. FFprobe never opens the upstream URL.
Input timestamps are normalized using `copyts`, `start_at_zero`, and output
`avoid_negative_ts=make_zero`; nonmonotonic timestamp diagnostics fail the attempt.
Temporary fragments never enter snapshots. Target duration is the ceiling of the
largest observed segment duration and cannot decrease during an attempt. No
independent-segments promise is emitted.

## Lifecycle and publication contract

`startPackager({source, epoch, directory, signal, continuity?, onSnapshot,
onFailure})` resolves to `{stop()}` after setup, before readiness. Readiness comes
from validated complete `RenditionSnapshot` callbacks. Invalid descriptors,
epochs, continuity, or inaccessible working directories reject startup.

`onSnapshot(snapshot, signal)` may be asynchronous. It must upload all referenced
files before resolving and must honor the supplied attempt signal. The publisher
must also recheck lease authority/generation before committing durable manifests.
Cancellation detaches a blocked callback; it cannot cancel arbitrary callback
code. A late callback must never publish after cancellation. Segment `objectKey`
is relative to the supplied job directory, under a unique
`attempt-<epoch>-<random>` child. The publisher adds its durable epoch namespace.
The attempt deletes older completed files after callback completion, and deletes
its entire child directory on stop/failure. It never deletes the job directory or
other attempts' files. Do not defer file reads beyond callback completion.

The registry owns all recovery and the shared 30-second recovery budget. There is
no internal reconnect. A restart passes both renditions' continuity values:

- `nextSequence`: the next unused sequence, normally the last published value + 1.
- `discontinuitySequence`: the number of discontinuities before the first new
  segment. The first restarted segment carries `discontinuity: true`; do not also
  increment the header for that same marker. Once that segment leaves the rolling
  window, the packager adds one to the header and emits no duplicate marker.

Defaults are sequence zero and discontinuity sequence zero, with no initial
marker. `programDateTime` and `generatedAt` use Unix milliseconds. Snapshots retain
up to eight segments; audio and video advance independently according to actual
packet/keyframe boundaries.

Stop is idempotent and fences callbacks immediately. It terminates only this
FFmpeg child (TERM, KILL after one second), waits for active bounded local probes,
disposes the source connection, and removes the attempt directory. Failed or
pending cleanup retains the registry's attempt quarantine. Abort is a deliberate
stop and normally emits no failure. Failed attempts emit `onFailure` once after
cleanup with `{kind, message}`, except `pressure`: it reports immediately after
local fencing so the registry can drain admission and fence sibling jobs while
physical cleanup continues. Storage pressure discovered during aborted setup or
cleanup also drains the worker. Kinds are `unsupported`, `source`, `packaging`,
`timestamp`, and `pressure`; messages contain no upstream URL or raw stderr.
Process diagnostics are bounded to 16 KiB for classification.

## Local evidence

`packages/media-relay/tests/packager.test.ts` generates loopback fragmented MP4,
runs real FFmpeg/FFprobe, and decodes both renditions. Source security and teardown
coverage lives in `source-acquisition.test.ts` and the existing
`tests/backend/event-broadcast-relay.test.ts`. These checks establish local media
behavior, not physical-phone playback or hosted-provider compatibility.

The [shared runtime](./media-relay-runtime.md) now composes this single-attempt
boundary with lease fencing, bounded publication and source recovery. Continuity
is validated as a complete strict two-rendition shape before any resources are
created, and each registry attempt receives its own fixed continuity baseline.
