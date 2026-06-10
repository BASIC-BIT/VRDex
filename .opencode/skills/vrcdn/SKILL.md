---
name: vrcdn
description: Work with VRCDN provider setup, URL formats, smoke tests, and VRDex restream POC flows without leaking stream credentials.
compatibility: opencode
metadata:
  audience: maintainers
  domain: provider-ops
---

## Goal

Operate VRCDN-related VRDex workflows safely: provider setup, smoke testing, URL handling, and restream POC diagnosis.

## Safety Boundaries

- Never print, commit, or paste stream keys, provider passwords, combined ingest URLs, signed URLs, or copied provider secrets.
- Store VRCDN credentials in AWS Secrets Manager or the approved secret store; keep docs and chat to secret names, ARNs, field names, and public preview/playback URLs.
- Public playback URLs may be shown when they contain no query string, userinfo, signature, or credential material.
- If a user pastes a key or ingest URL, immediately move it into the secret store and avoid repeating it back.
- Do not run a live provider task while the VRCDN panel preview says the stream is not live unless the task itself is meant to make it live.

## Current Smoke Account

- Secret name: `event-media/vrcdn/basicbit1-smoke`.
- Secret purpose: one-account VRCDN smoke testing for the restream worker.
- Browser preview URL: `https://panel.vrcdn.live/preview/basicbit1`.
- Stored secret fields: `provider`, `label`, `purpose`, `previewUrl`, `rtmpUrl`, `streamKey`, `playback`, `createdBy`, and `notes`.
- Do not disclose `rtmpUrl` plus `streamKey` together as an ingest URL.

## VRCDN URL Model

- Browser preview pages use `https://panel.vrcdn.live/preview/<stream-name>`.
- Ingest uses the VRCDN ingest server plus the stream key.
- The VRCDN panel also displays playback URLs; these are viewer/player outputs, not ingest endpoints.
- Playback variants can include RTMP, RTSPT, MPEG-TS, FMP4, FLV, and FLV/WebSocket.
- Do not assume `rtmp://stream.vrcdn.live/live/<stream-name>` is an ingest URL. That is a playback/output URL.

## Repo Surfaces

- POC worker: `workers/restream/vrcdn-poc.mjs`.
- Worker Dockerfile: `workers/restream/Dockerfile`.
- POC config tests: `tests/backend/restream-vrcdn-poc-config.test.ts`.
- Deployment evidence and runbook: `docs/deployment/restream-worker.md`.
- VRCDN URL parser for app media links: `convex/_vrcdnLinks.ts`.

## POC Modes

- `source-pusher`: pushes labeled synthetic source A or B into a VRCDN source account.
- `output-restream`: pulls source A and source B public playback URLs, hard-switches source A to hold slate to source B, then pushes to output VRCDN.
- `single-output-smoke`: pushes synthetic source A to hold slate to source A directly into one VRCDN output account.

## Single-Account Smoke Path

Use this when only one VRCDN account is ready.

1. Confirm the AWS secret exists by name only: `event-media/vrcdn/basicbit1-smoke`.
2. Confirm in the VRCDN panel that the stream/subscription/key is active.
3. Use `single-output-smoke` with `VRDEX_VRCDN_POC_OUTPUT_WATCH_URL=https://panel.vrcdn.live/preview/basicbit1`.
4. Inject the secret as `VRDEX_VRCDN_POC_OUTPUT_INGEST_SECRET_JSON` from Secrets Manager.
5. Start a short ECS task first, usually `720p30`, `1024` CPU, `2048` MiB, 120-180 seconds.
6. Watch the panel preview for source A, hold slate, then source A again.
7. If the task fails before FFmpeg output progress, check provider ingest readiness and exact RTMP app/playpath expectations.

## Prior Evidence

- A first smoke attempt used the playback RTMP URL as the stored ingest server; this was incorrect and produced no FFmpeg output progress.
- A retry with split RTMP app/playpath handling still produced no FFmpeg output progress while the panel was not live.
- After the panel screenshot, the secret was corrected to store the panel preview URL separately and distinguish ingest server plus stream key from playback URLs.
- A corrected retry completed successfully: `single-output-smoke`, `720p30`, `1024` CPU / `2048` MiB, 120 seconds, `8` runtime commands, `120000ms` final output progress.
- Private corrected retry report: `s3://vrdex-restream-worker-079358094174-artifacts/synthetic-benchmarks/2026-06-10T04-40-37-650Z/`.
- Future output POC artifact directories include `report.html`, `vrcdn-poc-report.json`, and `frames/hold-slate-input.png`.
- Next useful provider test: a longer single-account smoke or the three-account source A/source B/output POC.

## Validation Commands

From the repo root:

```powershell
node --check workers/restream/vrcdn-poc.mjs
node --import tsx --test tests/backend/restream-vrcdn-poc-config.test.ts
pnpm test:backend
pnpm lint:markdown
docker build -f workers/restream/Dockerfile -t vrdex-restream-worker:poc-local .
```

## Reporting

- Report the public preview URL, secret name, task id, task status, and sanitized event names.
- Do not report stream keys, full secret JSON, provider passwords, or combined ingest URLs.
- Use `report.html` as the human artifact index when present; it should only contain public watch/playback URLs and sanitized run metadata.
- If a live smoke fails, document the failure in `docs/deployment/restream-worker.md` with only public URLs, secret names, and sanitized symptoms.
