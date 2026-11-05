# Media relay independent review corrections

This records the independent review of PR 401 at
`3991c6e70d0c9d1174b07f802e9423426307b620` and its coordinated correction wave.
The original implementation plan is complete; this is a bounded review follow-up.
Integration remains disabled, unmerged and undeployed. Independent agent review
is not hosted review or release approval.

## Coverage and evidence boundary

Six independent sections covered their complete assigned diffs: authority
(4,548 lines), runtime (6,746), playback (4,330), artwork/metadata (699),
infrastructure (2,632), and verification (6,748). Their reports name adjacent
reads and considered behaviors. A seventh interface pass traced explicit Play
through grants and delivery; terminal failure through physical cleanup and
retry/claim; retained owner through lineup and metadata; evidence through enable
and deployment; and verification through actual imports, artifacts and CI.
That interface pass was not a second whole-branch review.

Required and selected CI passed at the reviewed baseline. Hosted reviewers did
not complete because of quota/diff limits; no bypass or hosted approval is
claimed. This correction wave adds focused failing regressions before behavioral
fixes, real Convex/control boundary tests, default-policy Node subprocess tests,
actual adapter/session identity tests, and permanent credential-free CI coverage.
Local tests and screenshots do not establish physical-device or hosted behavior.

## Finding dispositions

| Finding | Correction or deliberate limit |
| --- | --- |
| AUTH-01 | Checked-in enable blocker remains after hosted measurement/capacity validation. Release evidence rejects PAYG; no budget, string, env or CLI override enables it. Disable is still idempotent and needs no evidence. |
| RUNTIME-01 | Publication fences immediately; terminal lease surrender waits for successful physical setup/stop. Pending/rejected teardown retains quarantine and lease-expiry boundary. Real backend retry/second-worker claim regressions cover both outcomes. |
| RUNTIME-02 | Detached stop/failure chains handle cleanup rejection and deliver failure without turning rejected stop into cleanup success. Default-policy subprocess regression preserves shared-process survival. |
| INT-01 | Identity generations are independent of play intent. Rebound authority remains separate from installed identity until visible session commit. Pause, mode, hidden completion, newer manual selection and close are covered with the actual adapter/session and subsequent refresh. |
| PB-01 | Selecting the current mode is a no-op for playback intent, transport and status; real legacy Audio transition remains blocked. |
| PB-02 | Capability and action use the owned video element; legacy adapters without that element advertise no PiP. |
| ART-01 | Selected authorized artwork must match the file route's selection and supported raster limits; otherwise null IDs select neutral artwork. No SVG support or visibility expansion. |
| V-1 | Reordered-output proof requires decoded progress beyond the old buffered tail after replacement-object fetch, retaining publication/admission assertions. |
| V-2 | Archived relay documentation identifies unbounded TERM wait and the separate outer sandbox deadline. The expired relay was not revived. |
| CI gap | Existing baseline job runs package typecheck/tests and Terraform backend-free init, validate and mock tests, with no cloud credentials or deployment authority. |
| AUTH-02 | Deferred. Full terminal windows grow with lifetime sources. Bounded retirement must preserve durable epoch/sequence/discontinuity tombstones before release scale increases. |

## Remaining release gates

Approved hard traffic/cost enforcement, current-integration physical phone
acceptance, hosted capacity/recovery/CDN behavior and disk/FFmpeg buffer
containment remain open. PAYG substitution has not been approved. Synthetic
measurement validation and mock provider plans do not satisfy these gates.
ECS maximum 100/minimum 0 bounds RUNNING/PENDING tasks, not STOPPING processes;
hosted replacement must measure physical duplicate-acquisition duration and
publication fencing. No zero-overlap guarantee is claimed.

Firefox HLS and OS suspension remain unproven. Existing hidden revalidation
timeout and dormant `releaseSource` behavior remain considered-set-aside risks,
not new changes in this wave. Source-row deletion or a new retirement cron is
not part of AUTH-02's deferral. Public enablement requires separately reviewed
implementation and evidence, not a change to a configuration string.

## Correction-wave local verification

The final relay package run passed 79 tests; backend operations/admission/control
passed 73; focused web coverage passed 62, followed by all 29 native lineup tests
after the final hidden-cancel regression. Relay and backend typechecks passed.
Workflow definition tests passed 14, Terraform validate passed, and all eight
mock runs passed. These are credential-free local checks, not hosted acceptance.

The strengthened Chromium reordered-output case passed: pre-perturbation buffered
tail 5.72 seconds, replacement-fetch observation at 6.672011 seconds, and decoded
time 8.711539 seconds. Retained controls were captured and visually inspected.
An earlier attempt was invalidated by a source edit causing a development-server
full reload; its empty-media capture is retained as execution-error evidence,
not a runtime failure or passing proof. Source was frozen for the passing rerun.
PulseAudio tools were unavailable locally; no daemon or browser-policy workaround
was installed. Physical audibility and device acceptance remain open.
