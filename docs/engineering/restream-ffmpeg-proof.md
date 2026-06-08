# Restream FFmpeg Proof

## Status

Current recommendation for the local `program/restream/ffmpeg-proof` leaf.

## Goal

The proof establishes a small, repeatable media-worker foundation before hosted infrastructure or provider credentials exist. It uses only synthetic local FFmpeg inputs and writes watchable HLS artifacts for source A, hold slate, and source B switching.

The proof intentionally does not use external platform scraping, provider tokens, VRCDN credentials, Twitch credentials, or YouTube credentials.

## Commands

Run the proof:

```bash
pnpm proof:restream:ffmpeg
```

Check the latest generated proof artifact:

```bash
pnpm check:restream:ffmpeg
```

Run the local vertical validation harness:

```bash
pnpm proof:restream:local
```

Check the latest local validation artifact:

```bash
pnpm check:restream:local
```

Check a specific artifact directory:

```bash
node scripts/restream-ffmpeg-proof.mjs check artifacts/restream-ffmpeg-proof/<run-id>
```

## Generated Artifacts

FFmpeg artifacts are written under `artifacts/restream-ffmpeg-proof/<run-id>/` and are ignored by git. Local vertical validation summaries are written under `artifacts/restream-local-validation/<run-id>/` and are also ignored by git.

Each run produces:

- `command-timeline.json` with the scripted command sequence
- `hls/program.m3u8` and local `.ts` HLS segments
- `frames/source-a.jpg`, `frames/hold-slate.jpg`, and `frames/source-b.jpg` for human transition review

## Proof Timeline

The first timeline is deliberately small:

| Time | Command | Expected Output |
| --- | --- | --- |
| 0s | `start_program` | synthetic source A with 440Hz tone |
| 4s | `switch_hold` | static hold slate with 220Hz tone |
| 8s | `switch_source` | synthetic source B with 880Hz tone |
| 12s | `stop_program` | VOD HLS playlist ends |

## Automated Checks

The check command validates:

- command timeline shape and ordering
- HLS playlist presence, independent segments, segment files, and near-12-second duration
- H.264 video stream at `1920x1080` and `60 fps`
- AAC stereo audio at `48kHz`
- transition evidence frames for source A, hold slate, and source B

The local vertical validation harness also checks:

- a Convex-shaped operator-owned VRCDN output fixture reaches `ready` only through references and accepted gates
- queued local command records are claimed and marked succeeded in timeline order
- public snapshots expose watch/fallback links while omitting worker IDs, command queue internals, credential references, and private notes
- the worker command timeline matches the generated FFmpeg proof timeline

## Follow-On Gaps

This proof is not a hosted benchmark. Follow-on work should add sustained real-time encode measurement, keyframe cadence checks, silence/black/freeze detection, local RTMP relay output, and Fargate/GPU comparison before any hosted availability or pricing claims.
