# Persistent event broadcasts and automatic silence handoff

Locked direction from BASIC: event streaming should remain available after deployment, and silence handoff should work as part of ordinary automatic operation. BASIC has already authorized subagent-driven execution and an autonomous $20 work budget without repeated approval requests.

## User experience

Hosts configure an authorized event destination and use the existing Start/Stop, automatic/manual, Next and Hold controls. Starting a broadcast uses the validated silence default automatically. There is no separate calibration activation step or daily dispatcher renewal. A healthy source may continue past its authored end; the timetable alone never causes a handoff. Optional maximum overrun remains an explicit advanced policy.

## Persistent dispatch

Replace the manually launched 24-hour ECS dispatcher with one scheduled Node.js 22 Lambda invocation per minute. Each invocation performs one ordinary bridge pass using the existing Convex state machine and an AWS SDK v3 adapter. Lambda reserved concurrency is one. Use a unique invocation identity and no inherited drain deadline. Invocation completion, timeout, or service replacement must never invoke global media drain. Existing event workers continue polling Convex and enforcing their own leases, authorization, emergency stop and 12-hour session limit.

Reuse `loadConfig` and `runBridge` with `once: true`, `drainAtMs: undefined`, and an injected ECS runner. The runner implements exactly RegisterTaskDefinition, RunTask, DescribeTasks, StopTask and DeregisterTaskDefinition with the same payloads as the CLI bridge, including client token and ownership tag propagation. SDK requests and each Convex fetch have a 15-second timeout. Lambda timeout is 180 seconds. Read the exact service-token secret on every invocation, without storing the value in Terraform or Lambda configuration. Use the Node runtime's SDK v3 through deferred imports and verify those imports in a deployed smoke test. Offline tests inject real-shaped client and command interfaces. No extra root dependency is required.

Schedule delivery and Lambda asynchronous event age are capped at 60 seconds, without automatic failed-event replay. A future tick performs ordinary discovery and reconciliation. The schedule is the only dispatcher lifecycle control: provisioning the owner-configured bridge enables its normal schedule. Keep the existing publication emergency stop as an internal operational control, preserving its current enabled state during migration. Do not add another runtime enable variable.

Start dispatch may take up to one minute plus scheduler jitter, followed by ECS startup. Running source control stays worker-driven. Existing launch fencing and actual STOPPED requirements remain authoritative. Unknown launch outcomes retain admission; this change does not claim recovery of pre-existing unrecorded task ARNs or stale claimed commands. Document those recovery limits rather than introducing a new launch protocol here.

Estimated idle Lambda cost at 256 MiB is about $0.19/month for one-second passes or $0.92/month for five-second passes, excluding ancillary charges. Active media remains about $0.205/hour plus egress. The work budget covers implementation verification and bounded provider checks; no broadcast is started arbitrarily.

## Automatic silence

Candidate default is below -90 dBFS continuously for 15 seconds. It becomes the default only after actual AAC/MPEGTS decoding through the existing input supervisor and worker proves digital-silence qualification and quiet-track retention. Preserve the historical -81 dBFS quiet tone. This is conservative synthetic calibration, not an observed real-DJ musical false-positive rate.

Resolve the effective policy centrally in Convex for both missing and empty stored policies. Retire `VRDEX_EVENT_BROADCAST_SILENCE_CALIBRATED` as an activation prerequisite after proof. Keep validation of explicit advanced policies and preserve existing custom silence when updating maximum overrun. Threshold changes during an active session retain the existing restart requirement and never silently activate analysis at a different threshold.

All existing reducer safeguards remain: automatic mode only, fresh matching progressing current A/V, sustained decoded analysis, fresh matching decoded-ready successor, authored eligibility, reconnect/failure reset, and manual/hold overrides. Silence without a ready successor retains the current source. Last-slot silence cannot invent a successor. An accumulated qualifying quiet interval may switch when eligibility arrives; no new hidden post-boundary grace is added.

## Verification and migration

Use meaningful TDD coverage for SDK request equivalence, invocation identity and secret handling, no invocation-driven media drain, bounded HTTP/SDK operations, independent replay/reconciliation, policy defaults, preserved overrides and silence eligibility. Add a bounded real FFmpeg proof with AAC/MPEGTS inputs, actual worker/rendering, safe evidence and encoded source identity. Cover audible and quiet tones, digital zero, short pauses/reset, readiness, pre-boundary silence, manual hold and positive silence handoff.

IaC provisions the singleton Lambda, dedicated least-privilege role and logs, minute schedule, invocation permission and event-age/retry bounds. Runtime can read only the exact bridge-token secret, launch only event-worker definitions in the existing cluster, pass only existing worker roles, and observe/stop ownership-tagged tasks. AWS's existing unconditional task-definition deregistration requirement is documented. Worker execution-role secret grants remain exact. Bundle ZIP uses a SHA256-addressed private S3 key. Verify deployed CodeSha256 against the local artifact.

Migration waits for no active sessions, stops the old standalone dispatcher and confirms STOPPED before enabling the new schedule. Preserve BITRATE's `basicbit1` ownership, primary credential, concurrency one and emergency-stop state. Verify actual scheduled polls and deployed SDK support. Do not start an event without selecting one. Retain all previous media evidence and rollout receipts.

## Scope

No public product prose or UI changes, new provider destinations, recurring container, daily renewal, worker-image rebuild, or new event-start authorization. Existing account grants and media fencing remain unchanged. Publish one follow-up PR and resolve review feedback before calling it ready.
