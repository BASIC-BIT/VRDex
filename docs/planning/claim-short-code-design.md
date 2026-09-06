# Short VRChat claim codes

Date: 2026-09-05. Status: source design complete, implementation not authorized
by this document. Based on checkout `12f32b96a22a47bb91a4d0ab57f15d085c403b97`.

## Intended result

BASIC's format preference: `VRDEX` plus exactly five decimal digits, no dash.
Synthetic example: `VRDEX19825`. Ten characters total, down from eighteen.
Leading zeros are retained: the suffix has 100,000 possible values. Do not
substitute a longer or alphanumeric format.

Current recommendation: retain the 24-hour expiry, verified-session guard,
profile/claimant/immutable VRChat target binding, collector authorization,
ownership conflict handling, and existing connection-only completion behavior.
This design does not explain or fix the separately reported stalled attempt.

## Why shortening the generator alone fails

- `convex/profileClaims.ts:createProofCode` currently emits a UUID-derived
  twelve-character hexadecimal suffix after `VRDEX-`.
- `workers/group-telemetry/proof-matching.mjs` requires that dash and at least
  six suffix characters. An executed source probe rejects the requested form.
- The staging adapter at
  `apps/web/src/app/api/e2e/adapters/vrchat-proof/route.ts` requires `VRDEX-`.
  The hosted browser test in `apps/web/e2e/auth-claim.flow.spec.ts` also does.
- The browser copy row displays the server-returned string directly. No new
  code-entry screen, length selector, or display-only shortening is needed.
- VRCLinking does not ask the user to post a code. Keep that flow unchanged;
  change issuance only for `vrchat_user` and `vrchat_group`.

## Issuance and collision rules

Use the existing `startVrchatProof` mutation and attempt table. Keep returning
the same unexpired pending attempt for the same claimant, profile, and target
before applying new-issuance limits. Reloading must neither rotate the code nor
extend expiry. Cancellation makes a code unusable but does not release its value.

Choose an unbiased random integer from 0 through 99,999, then zero-pad to five
digits. Use cryptographic random bits, not time, IDs, counters, or `Math.random`.
The already-used `crypto.randomUUID()` can supply its first eight hexadecimal
characters, which precede UUID version bits. Interpret those as 32 bits, reject
values at or above 4,294,900,000, then take modulo 100,000. This avoids modulo
bias without introducing a new runtime dependency.

Never reissue the same short code for the same normalized target type and
external ID, across all profiles, claimants, and historical attempt states.
This is stronger than unique-among-pending: a canceled or expired code may
remain in a bio indefinitely. Allow the same digits for different targets,
since the verifier reads the exact bound target and does not accept a code as
a global bearer credential.

Add an index on `(targetType, targetExternalId, proofCode)` to the existing
attempt table. Check for any historical use and insert the new attempt in the
same mutation. Limit random draws/collision probes to 32; if none is usable,
fail without issuing a code or changing format. Reuse the existing temporary
unavailability response for this exceptional case. Concurrent allocation of
the same value must be verified against the real backend transaction boundary.

No new reservation table is needed while existing attempt records are retained.
The current cron expires attempts but does not delete them; the deletion paths
found in `convex/e2e.ts` are fixture cleanup. Production cleanup must not delete
the used-value evidence: if attempt retention/deletion is added later, retain
the minimal target/code reservation separately. Do not use real targets in the
fixture cleanup path. This is a replay-protection invariant, not permission to
retain additional provider bio text or credentials.

The namespace is finite. At exhaustion, fail closed; never recycle a used code.
Ordinary linking should consume very few values per target. Persistent attempts
to exhaust a target are abuse, not grounds for an automatic longer-code fallback.

## Issuance and checking limits

Recommended initial defaults, enforced atomically before allocating a new code:

- At least 60 seconds between new direct VRChat codes for one VRDex account.
- At most 10 new direct VRChat codes per account in a rolling 24 hours, across
  user and group targets together.
- At most 20 new codes for one immutable VRChat target in a rolling 24 hours,
  across all VRDex profiles and accounts.
- Preserve the existing three-open-attempt cap per account and target type.

Count every issued attempt, including canceled, expired, failed, and legacy
codes within the time window. Opening another profile or canceling cannot reset
the counters. Returning an existing pending code remains available at the cap.
The target cap limits multi-account attacks; it can also temporarily block a
legitimate claimant during abuse. Return the same limit response without
revealing which other accounts or attempts contributed.

Use the existing user/type/creation-time index with bounded reads for both
direct target types. Add `(targetType, targetExternalId, createdAt)` for the
target window. Each query needs at most its cap plus one row, not an unbounded
history scan. VRCLinking's existing issuance/check limits remain unchanged.

Keep the collector's five-minute per-attempt dispatch cooldown, shared provider
budget/backoff, and adapter's 60-second check cooldown. Polling the same bound
code is not a new guess. These provider budgets do not replace issuance limits.
Expiry and final ownership authorization remain checked at verification time.

The five digits are not a login OTP. There is no public endpoint where someone
submits arbitrary five-digit guesses to acquire a profile. The service must
find the exact assigned code on the bound VRChat target. Its small namespace
therefore requires non-reuse and bounded issuance, not an assumption that the
prefix adds entropy. Keep attempt codes private to their claimant before posting.

## Matching and old-code compatibility

Classify the expected code first:

- New: `^VRDEX[0-9]{5}$`. Find that contiguous string, case-insensitively, bounded
  on both sides by the start/end of the field or a non-letter/non-number.
  Unicode letter/number boundaries prevent attaching the code to another token.
  Normal text, newlines, punctuation, and emoji may surround it. Do not strip
  characters from inside a short code or accept a prefix of a longer string.
- Legacy: retain the current valid-code pattern and normalization unchanged,
  so already-posted formatted long codes continue to work.

Thus a long old token beginning with the same five digits cannot accidentally
prove a new short attempt. Do not run new short codes through the old
alphanumeric projection and substring matcher. Continue checking the same
provider fields; no bio/status/name policy change is needed.

Update the fixture adapter and browser assertion for both formats. Fixture
success still requires the recognized fixture target and existing helper/auth
gates. Remove the interpolated proof code from the fixture evidence summary
while touching that path; proof text is not needed in diagnostic output.
An external `VRCHAT_PROOF_ADAPTER_URL`, if configured, must be checked against
the same format contract before enabling short issuance for that environment.

## Smallest rollout and rollback contract

Use two releases, not a new permanent feature-flag subsystem:

1. Reader release: dual-format collector matcher, updated fixture/web tests,
   and relevant docs. Continue issuing long codes. Verify every eligible live
   collector can read short codes and any configured external adapter supports
   them. The current readiness helper proving at least one exact-release worker
   is not enough to establish mixed-fleet compatibility.
2. Issuer release: schema indexes, collision/rate rules, and short generation.
   Existing pending long codes are returned unchanged until settled or expired.
   New direct VRChat attempts use the requested format.

Roll back issuance to long codes if needed, but keep dual-format readers and
historical short-code reservations. Do not roll readers behind the first
release while short attempts can still be pending. Release planning must
explicitly prevent an old-reader rollback during that period. If reader-first
convergence cannot be guaranteed, hold issuance; do not ship a best-effort
mixed fleet or silently change the requested format.

No releases, live issuance, configuration changes, or production tests are
authorized or performed by this source design.

## Validation evidence and implementation checks

Executed isolated experiment:
`node .tmp-gh-artifacts/claim-short-code-design.mjs`.
Result: 27 assertions passed, plus all 100,000 formatted values checked for
shape/uniqueness. Covers case/boundaries, long-prefix rejection, legacy styled
matching, unbiased-range arithmetic, modeled target-scoped non-reuse, and
bounded allocation failure. This is a design model, not application integration
or Convex concurrency proof. All seven existing matcher/budget tests passed via
`node --test workers/group-telemetry/proof-matching.test.mjs`.

Implementation must additionally test the actual mutation and collector path:

- Concurrent identical random candidates cannot issue a duplicate on one target;
  different targets can share a value. All terminal historical states reserve it.
- Same-attempt reuse does not consume quota or extend expiry. Cancel/recreate,
  profile changes, and additional accounts cannot bypass the relevant limits.
- Time-window boundaries, rejected draws, repeated collisions, and exhausted
  allocation fail safely. No raw code appears in logs or analytics.
- Before/at/after expiry, foreign claimant access, revoked collector authority,
  competing ownership, replay, connection-only completion, and cleanup isolation.
- An actual user/group fixture traverses provider read, matcher, result recording,
  and query/UI completion for short codes, with a still-pending legacy code too.
- Preserve PR #314's two-user coverage through owner coordination. Do not copy
  or overwrite that owner's changes or claim its synthetic tests prove live linking.

## Genuine remaining product decision

No unresolved format choice: BASIC chose `VRDEX` plus five digits. The limits
above are concrete engineering recommendations, not extra questions for BASIC.
The one new public sentence needs exact-copy approval before shipping under
the repo's public-copy rule:

> Too many new codes. Try again later.

Use a dedicated structured issuance-limit error, not the existing
`ADAPTER_COOLDOWN` text, which incorrectly refers to VRCLinking and one minute.
Existing approved unavailable copy covers exceptional allocation failure.
No other new public explanatory prose is proposed. Implementation and release
authorization remain separate from this design handoff.
