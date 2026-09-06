# Short-code issuer handoff

Date: 2026-09-06. Owner: this source task. Activation owner: Life Thread.

## Change

New direct VRChat user/group attempts issue `VRDEX` plus five decimal digits.
Pending legacy attempts and VRCLinking stay unchanged. Allocation uses unbiased
cryptographic draws, at most 32 attempts, and lifetime target/code reservations
in the existing attempt table. Twenty new attempts per target per rolling day
protect the finite pool. BASIC removed proposed account-wide issuance limits;
the existing three-open-attempt cap remains.

Exact new public copy, approved by BASIC:

> Too many new codes. Try again later.

## Evidence

- All 727 backend tests passed, including 21 issuer tests, ownership races,
  collector authority, expiry, cancellation, and VRCLinking limits.
- 17 collector worker tests passed.
- Six desktop/mobile browser fixture checks passed. Mobile screenshot review
  confirms the short code fits alongside the copy action without overflow.
- Short and legacy user/group fixtures traverse the real provider client,
  matcher, collector recording, and completion query. Only HTTP transport and
  identities are synthetic; these tests do not prove live VRChat linking.
- Real isolated local Convex transactions: two simultaneous allocations forced
  to choose one value for one target yield one issuance and one rejection.
  Two different targets can share that value. No production data used.
- Backend and web typechecks passed. Independent source review found no
  correctness/security defects and requested the accompanying docs updates.

### Reproduce the local concurrency check

Run only in an isolated worktree with an anonymous local Convex deployment.
The fixture uses only `usr_local-short-code-` targets. It is deliberately stored
outside `convex/` so it is never part of a normal release.

1. Copy `tests/local/short-code-probe.ts.fixture` to
   `convex/localShortCodeProbe.ts`.
2. Start the local backend on port 3240 with the worktree-local environment
   selector `CONVEX_DEPLOYMENT=anonymous:anonymous-agent`. The repository runner
   supports `--env-file` for that selector; its default `local:` selector may
   otherwise request an interactive login on a fresh checkout.
3. After functions are ready, run `node tests/local/short-code-concurrency.mjs`.
   The script reads only `.convex/local/default/config.json` and connects only
   to `http://127.0.0.1:3240`.
4. Remove `convex/localShortCodeProbe.ts`, let codegen finish, and stop the local
   backend. Never include the temporary module in a commit or deployment.

## Release boundary

PR #317 supplied dual readers. Before merging/activating issuer code, Life
Thread must verify every eligible collector and any configured external
adapter support short codes. One healthy worker does not establish fleet
convergence. Preserve dual readers and historical reservations on rollback.

PR #319 is deployed and G-Catz confirmed the verification-status fix. Search
PR #320 supplied the exact obsolete owner-notice assertion correction, now
applied here by coordination. Code-format locators and target-isolation checks
also accept legitimate equal codes across different targets. No repeat PR #319 deployment is needed.

Source review/CI and the required final 30-minute review window remain to be
completed before this change can be called merge-ready. No issuer production
activation has occurred.

## Review recycle and reader inventory

Codex findings addressed: both E2E cleanup paths reject non-fixture direct
VRChat targets before deletion, preserving lifetime reservations; the two-user
browser flow checks bound targets and cancellation/ownership isolation instead
of assuming globally unique codes. Regression tests reproduce both cleanup
failures before the fix and confirm accepted fixture cleanup afterward.

Claude's suggested runtime activation toggle was declined because the approved
reduced design uses two releases with reader-first convergence, not a new flag.
Merge/deploy activates issuer code; Life Thread controls that release ordering.
The bounded read-only production inventory on 2026-09-06 at 21:12-21:14 UTC found:

- One eligible collector account, Oak, with fresh heartbeat and proof poll,
  both identifying release `8eb9bc4406429075e8e489a750f7263d26fd6e12`.
- One running task in the configured collector ECS cluster, task definition
  revision 20, desired/running 1, pending 0, one completed PRIMARY deployment.
- Running task and definition use the same immutable image digest:
  `sha256:59d6501d99b27e31ee4ac03a634b07447e94fe874769981f2314f514137574f1`.
  Release environment metadata agrees with the collector's reported release.
- Git ancestry confirms PR #317's dual-format reader is included.
- Production `VRCHAT_PROOF_ADAPTER_URL` is unset.

No reader compatibility gap was found in this snapshot. Refresh if runtime or
configuration changes before activation. This is not a live provider claim test.
