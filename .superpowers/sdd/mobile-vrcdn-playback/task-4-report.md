# Task 4 report

Status: DONE_WITH_CONCERNS. Implementation is complete; the integration contracts
and evidence limits below must be carried into Task 5 and later validation.

## Delivered

- Explicit `vrcdn_fmp4` relay mode accepts only canonical case-preserving
  `/live/<streamId>.live.mp4` URLs or exact deployment-owned endpoints, and requires
  upstream `video/mp4`. TS mode remains the default with its existing endpoint,
  source identity, operator endpoint, and `video/mp2t` behavior.
- Redirects are refused; every DNS answer must be public IPv4; the chosen address
  is pinned. Production DNS now uses one cancellable `Resolver` per connection,
  timeout 1000 ms / one try, with a 2000 ms outer deadline. Cancellation never
  cancels another connection's resolver. Injected legacy `resolveAddresses` hooks
  preserve the existing physical-completion ownership contract.
- `@vrdex/media-relay/worker/packager` exports `startPackager` and the optional
  dependency factory `createPackager`. The shared root stays free of new Node
  media-process imports. Type declarations accompany the existing JS relay.
- One attempt acquires one guarded source and starts one FFmpeg process with one
  input and two copy-only outputs. Video contains H.264/AAC; audio contains AAC
  only. No hidden transcoding and no remote FFprobe. First complete local output
  segments are probed before any snapshot is published.
- FFmpeg is forced to MP4 demuxing, with `enable_drefs=0` and input protocols
  `http,tcp`. Mislabelled HLS cannot induce decoder-authored external acquisition.
- Timestamp normalization uses `copyts`, `start_at_zero`, and output
  `avoid_negative_ts=make_zero`. Nonmonotonic timestamp diagnostics fail explicitly.
  Diagnostics are bounded to 16 KiB and are not exposed as raw failure text.
- Atomic HLS temporary files, complete-segment snapshots, ceiling of maximum
  observed duration, eight-segment rolling windows, immutable attempt-specific
  filenames, obsolete-file pruning, and no independent-segments claim.
- Bounded TERM/KILL for this FFmpeg child, bounded/reaped local probes, source
  disposal, callback cancellation, and deletion of only this attempt directory.
  Stop is idempotent, including reentrant cancellation.
- Durable developer contract: `docs/engineering/media-relay-packaging.md`.

## Controller-agreed interfaces and decisions

The packager owns exactly one attempt. Task 5 owns retry and the shared 30-second
recovery budget. There is no FFmpeg or packager reconnect loop.

```ts
startPackager({
  source, epoch, directory, signal,
  continuity?: {
    video: { nextSequence, discontinuitySequence },
    audio: { nextSequence, discontinuitySequence },
  },
  onSnapshot(snapshot: RenditionSnapshot, signal: AbortSignal): void | Promise<void>,
  onFailure(failure: {
    kind: 'unsupported' | 'source' | 'packaging' | 'timestamp',
    message: string,
  }): void,
}): Promise<{ stop(): Promise<void> }>
```

- The returned handle means setup, not readiness. A validated complete snapshot
  establishes usable output. Invalid descriptor/epoch/continuity/directory setup
  rejects startup. Runtime failure is reported once after teardown. Deliberate
  stop/abort does not emit failure.
- `nextSequence` is normally the last published segment sequence + 1 per rendition.
  Initial defaults are zero. Continuity means restart: first new segment carries
  `discontinuity=true`. Supplied `discontinuitySequence` counts markers BEFORE that
  segment; do not count its marker twice. After the first restarted segment slides
  out, the header increments once. The real restart test covers this rollover.
- `Segment.objectKey` is relative to the supplied job directory, under unique
  `attempt-<epoch>-<random>/video-N.ts` or `audio-N.ts`. The publisher adds its durable
  epoch namespace. Restart cannot overwrite the previous attempt's filenames.
- `programDateTime` and `generatedAt` are Unix milliseconds. Target duration is
  truthful for observed segments and never decreases within an attempt.
- The asynchronous snapshot callback must upload referenced files before resolving,
  honor its attempt AbortSignal, and fence durable publication against the current
  lease/generation. Stop detaches a stalled callback; arbitrary user callback code
  cannot be forcibly cancelled. A detached callback may no longer rely on local
  files and must never commit after cancellation. Subsequent scans/pruning are
  fenced; the unique directory is removed after process/acquisition cleanup.

## RED/GREEN and verification evidence

Toolchain: Node 24.19.0, pnpm 10.15.1, FFmpeg and FFprobe
7.1.5-0+deb13u1. Commands activate `/workspace/vrdex-env.sh`; socket/process runs
used additional network permission, preserving proxy/CA environment. All media
originated from generated loopback fixtures; no provider stream was acquired.

Observed RED:

- Initial explicit MP4 URL/acquisition tests: 0/2, endpoint not authorized under
  the pre-existing TS-only implementation.
- Packager tests first exposed the missing module, then 0/3 against the minimal
  unimplemented boundary, each failing `Packager is not implemented`.
- Per-attempt resolver cancellation: expected two resolver instances, observed
  zero before introducing the default resolver factory.
- Stalled callback cancellation: stop did not finish before the 1500 ms test bound.

Observed intermediate failures corrected:

- Reconnect test initially expected immediate 502 while the correctly quarantined
  previous acquisition still returned 409; test now awaits disposal explicitly.
- Burst fixture initially advanced the audio window past the restart's first
  segment before observation; source delivery now paces real fragments.
- An output decode check read a segment after its publication lifetime while the
  rolling window pruned it; decode now selects the latest retained complete segment.

Final relevant commands/results:

1. `node --conditions=import --import tsx --test packages/media-relay/tests/packager.test.ts packages/media-relay/tests/source-acquisition.test.ts tests/backend/event-broadcast-relay.test.ts`
   passed 19/19 before the additional nested-playlist case and explicit demuxer
   hardening. This includes all seven existing TS relay regressions unchanged.
2. After the Zod/build dependency correction,
   `pnpm --filter @vrdex/media-relay test` passed 22/22 (contracts, leases, seven
   media tests, five source tests); this confirms package test discovery.
3. After explicit demuxer/data-reference/protocol hardening,
   `node --conditions=import --import tsx --test packages/media-relay/tests/packager.test.ts`
   passed 8/8, including the new mislabeled playlist check.
4. After final reentrant stop ordering,
   `node --conditions=import --import tsx --test --test-name-pattern='abort closes|blocked publisher' packages/media-relay/tests/packager.test.ts`
   passed 2/2.
5. Final `pnpm --filter @vrdex/media-relay typecheck` and `git diff --check`: exit 0.
6. Installed Prettier 3.8.1 formatted all new/changed implementation/test/doc files.

The nested-playlist regression already passed on this FFmpeg build before the
explicit demuxer hardening (the supplied MIME type also influenced probing).
It remains evidence of no follow-up acquisition, not a claimed RED for those
additional defensive flags.

Real-media assertions include H.264/AAC and AAC-only local probe results, both
outputs decoded with FFmpeg and empty error stderr, five-second keyframe segments
with target duration at least five, advancing playlists, existing complete files,
no independence flag, one normal upstream, maximum one active acquisition across
restart, increasing sequences, discontinuity rollover, unsupported MPEG-4 video,
partial fragment rejection, timestamp reset failure, abort cleanup, and stalled
publisher cancellation. The mislabeled playlist test records one acquisition and
zero publication; the nested loopback endpoint is never fetched.

Cleanup: tests await their handles, close their loopback servers/connections, and
remove only their own fixture directories. Post-run inspection found zero
FFmpeg/FFprobe processes referencing `/tmp/vrdex-packager-*` and zero matching
fixture directories. No broad process kill or unrelated filesystem cleanup ran.

## Inherited setup corrections requested by controller

Task 1 had declared media-relay Zod ^4.4.3 despite the approved shared version.
Changed only media-relay to ^4.3.6 and resolved 4.3.6, matching api-contracts.
Added explicit root devDependency esbuild 0.28.0 because Task 7's build orchestrator
will live in root `scripts/`. Only the root and media-relay lock importers changed.

`pnpm install --offline --frozen-lockfile --ignore-scripts --filter @vrdex/media-relay --filter vrdex`
passed, with no downloaded packages. Direct resolution confirmed esbuild 0.28.0
and media-relay Zod 4.3.6. Package tests and typecheck passed against that resolution.

## Self-review and concerns for subsequent tasks

- Task 5 must apply the callback signal and durable lease/generation fence; a
  detached arbitrary callback cannot be stopped by this package alone.
- The default resolver is bounded/cancellable. A deliberately uncancellable
  injected legacy resolver may keep disposal pending until its own completion;
  this is retained for the existing ownership regression, not claimed as bounded
  production DNS behavior.
- Local H.264/AAC fixtures establish media correctness and cleanup. Hosted VRCDN
  codec/profile behavior, physical-phone playback, and production capacity remain
  later evidence gates. No claim of phone compatibility is made here.
- FFmpeg/FFprobe must be present on worker PATH; image/build packaging belongs to
  later tasks. Publisher durability, signed playlists, recovery policy, and epoch
  fencing remain Task 5/6 responsibilities.
- No public product prose, hosted mutation, deployment, credentials, provider
  stream, public tunnel, or paid service was introduced.
