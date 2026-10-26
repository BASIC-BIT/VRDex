# Verification fix round 1 independent scoped review

Reviewer: `/root/review_capacity_bridge_seam`. Reviewed on 2026-10-26, independently of implementation. No subagents.

SPEC verdict: PASS.

QUALITY verdict: PASS.

Each recorded cause is addressed. No breakage introduced by this fix found, and no required corrections.

## Scope and frozen identities

Base and observed HEAD: `b6b338a664630c9fa4237e43932ef2b36cbbc372`. Exactly three uncommitted backend test files differ from BASE. Production and shared helper files do not differ.

Read the full `verification-fixture-findings.md`, appended Task 2 implementation report, review package, manifest and Root's ruling in `progress.md`. The ruling permits the control events-loader opt-in while requiring its direct-seeded helper to remain unchanged. This review applies to that authorized scope.

All three current source SHA-256 values, byte counts and modes match the manifest. All three BASE bodies match their recorded SHA-256 values, and every listed evidence file matches its hash, size and mode. The packaged diff exactly matches the actual three-file `git diff --unified=10`.

| Path | Reviewed SHA-256 |
| --- | --- |
| `tests/backend/event-broadcast-control.test.ts` | `1f3a0fd7c485395004026a5f8f2a0294ad32a58a4cbb38225d8f09d99e567eb0` |
| `tests/backend/event-broadcast-worker.test.ts` | `a8783b8ceedad6b8da669b3f9894bec7bcfeaad7617a77497fa4a3af57d88cd9` |
| `tests/backend/event-media-worker.test.ts` | `7215f4ab5a3af9cd710dcfb215d82681e9b48f4a315304f09b82b4610ad62ab0` |

Review package SHA-256: `c67a37ee20df6e5de58cfabab18cb4f2972d2abda70b64778c03d6a9bead5e23`.
Manifest SHA-256: `bd8033adf7111c9c10050501342a008763220bb24dd566af2394b34581276dd3`.
Appended implementation report SHA-256: `be0d69b68cd18a569e621f83086130673d939f68d21d170f2628dbb30770796e`.

## Disposition of recorded causes

1. Control replacement scheduling: ADDRESSED. The only control-file changes are importing `loadEventsWithFixtureCapacity` and replacing the existing events module entry with it. Programmatically reversing exactly these two substitutions reconstructs the complete BASE file byte-for-byte. Thus the entire direct-seeded helper and every existing assertion are unchanged. The four affected cases still call the real `scheduleEventMediaWorker` mutation for replacement/new-event scheduling through the existing synthetic factory loader. No new seeding or production authority was added.

2. Backend bridge resolver omissions: ADDRESSED. All eight listed calls now pass the shared `fixtureCapacityResolver` through the fifth dependency argument: F1 first call and retry, R8 config/register, R8 ambiguity, R8 Stop-before-marker, both competing claims, and R8 duplicate marker. F1 passes `undefined` as its third argument, preserving the existing default CLI runner configured with its local fake executable. Stop-only and denied/unknown/malformed-admission callers are unchanged. The new import consumes the existing fixture with no shared helper edit. Existing marker, release, RunTask, persisted-task and cleanup assertions remain.

3. Three latent compute-runtime region omissions: ADDRESSED. Exactly the F1 config, R8 ambiguity config and competing-bridge config gain literal `region: 'us-east-1'`. This lets their successful launches reach the real required runtime validator and intended record behavior. No production fallback or validator change appears.

4. Competing-bridge stalled handshake and ownership cleanup: ADDRESSED. Registration is raced against a continuation that throws if the first claim completes before entering registration. A rejected first claim also rejects that race. The ownership sequence is enclosed in `try/finally`, which always releases the first registration hold and awaits the same first claim, including when the second claim fails. The race has handlers attached to its inputs, so the first-claim continuation rejecting after registration wins does not create an unhandled rejection. The original exactly-one-RunTask, winner definition/task, losing-definition cleanup and audit assertions remain after cleanup. No timeout race abandons an owned claim; the recorded command also has an external 120-second bound.

5. Revoked projected source expectation: ADDRESSED. The test captures `formerSource` before revocation and retains the original `hasPublicUrl === true` assertion. Acquisition still precedes revocation. After removing outbound links, it requires exact `after.sources === []` by deep equality, then submits the captured formerly valid key to the real mutation and requires `/unavailable/i`. No worker refresh intervenes. Source inspection confirms the operator query filters unavailable projections and the command mutation retains its explicit `Event media source is unavailable.` guard. This reaches the intended rejection instead of dereferencing an absent row.

## Verification evidence and limits

I inspected the hash-verified focused log and exit file. The recorded bounded three-file command exited 0 with 288 tests, 288 pass, zero fail/cancelled/skipped. All eighteen impacted logical cases have named passing results, including config failure, competing bridges, duplicate marker, the four control cases and stale-source rejection. I did not rerun tests.

The original interrupted backend evidence remains an interrupted broad run with incomplete post-stall coverage, not a completed baseline. This focused review does not establish full-backend, merge, whole-flow or CI readiness. The empty production measured map and original measured-admission migration requirement remain unchanged.

`git diff --check` passed during review. No new casts, `any`, packages, mutable authority, module mocks or generic fixture machinery were introduced. Existing `any` annotations in context predate this fix and are outside its scope. No source edits, test executions, services, network/provider actions or commits were performed. Only this review artifact was written; every review shell sourced `/workspace/vrdex-env.sh`.
