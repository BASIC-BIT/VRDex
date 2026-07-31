# Profile Trust Signals

## Status

Proposed. Supersedes the profile-level `claimed_verified` signal described in
[`profile-claim-journey.md`](./profile-claim-journey.md).

## The problem

`claimed_verified` tries to say something VRDex cannot establish, and in trying,
says nothing at all for most profiles.

**It is unreachable through self-service.** Upgrading to `claimed_verified`
requires a `profileExternalLinks` row for the proven asset written by somebody
who is not the claimant — `assetBacksThisProfile` in
[`profileClaims.ts`](../../convex/profileClaims.ts) tests
`link.linkedByUserId !== attempt.userId`. But the proof path writes its own link
with `linkedByUserId = attempt.userId`, so a claimant's evidence can never
satisfy the test: not on the first attempt, not on a retry. The only writer that
produces a qualifying row is `recordOperatorAssociation` in
[`profileConnections.ts`](../../convex/profileConnections.ts) — an
`internalMutation` with no self-service surface and no caller outside tests.

What is impossible is *self-service* verification, and that is the precise
claim. `recordOperatorAssociation` accepts any profile slug and does not inspect
`creationSource`, so an operator can associate and thereby enable verification
for a community-submitted profile exactly as for a concierge-seeded one. The
barrier is not the profile's origin — it is that no path a claimant can walk
produces a qualifying association, and the submit form captures `displayName`,
`aliases`, `tags`, `roleTags`, `categoryTags`, `subtype` — no service-typed
identifier for one to attach to.

**The guard does not protect what it appears to.** Impersonation lives in the
display name, not the account linkage: a claimant can name a profile "Nyx" and
prove their own VRChat account under either rule. Where a listing *does* carry an
operator association to the real account, the impostor is already stopped — they
cannot prove control of it. The corroboration test only bites where no
association exists, which is exactly where it blocks the honest case and nothing
else.

**`aliases` is untyped.** `v.array(v.string())` records a name with no
indication of which service it belongs to. `outboundLinks` carries `type` and an
optional `handle`, but the verification path does not read it.

## Product decision

Split one overloaded signal into two honest ones.

1. **Profile level: owned, not verified.** The question a viewer needs answered
   is whether anyone has claimed this entry. `unclaimed`,
   `community_submitted`, and `claimed` describe provenance and custody, which
   VRDex can establish. `claimed_verified` attempts to describe identity, which
   it cannot.

2. **Identity level: per-account, and named.** Verification attaches to a
   specific external account, not to the profile. The claim being made is:

   > the account that claimed this profile also controls *this* other account

   That is checkable, already evidenced, and does not depend on knowing who the
   person is.

3. **No profile-level "verified person" label.** The tempting shorthand — has
   claimed the profile and has ≥1 verified identity — reintroduces exactly what
   points 1 and 2 remove. An impersonator can claim a listing named for somebody
   else and prove their *own* VRChat account; that satisfies the predicate, and
   rendering the result as "verified person" makes the profile-level identity
   claim all over again, one word further down.

   The predicate is still useful *internally* — identity-specific filtering, and
   deciding whether to prompt someone to prove an account they have named. It
   must not be surfaced as a trust label, and it must not carry search weight:
   ranking on it rewards the same unbound proof at profile level, letting an
   impersonator's listing outrank honest unproved ones without a badge ever
   being drawn. Anything a viewer sees stays attached to the named account.

   Where it is computed, it must join `externalControlProofs` and exclude
   revoked rows. `revokeExternalControlProof` marks the proof revoked and
   deliberately leaves the link and its `verifiedByProofId` intact, so testing
   for the foreign key alone reports as verified an identity whose evidence has
   been withdrawn.

4. **Notability is editorial, not computed.** If a famous-person mark is wanted,
   it stays a human judgement recorded by an operator. Deriving it would
   reproduce the current failure — a badge implying something no mechanism
   establishes.

## What already exists

Most of this is a presentation change over data the model already carries.

| Fact | Where it lives | Status |
| --- | --- | --- |
| Which external account | `profileExternalLinks.assetType` + `assetExternalId` | Present |
| Proof behind it | `profileExternalLinks.verifiedByProofId` → `externalControlProofs` | Present |
| Whose assertion | `profileExternalLinks.linkedByUserId` (absent for operator rows) | Present |
| Display handle | `profileExternalLinks.assetDisplayName` | Present, optional |
| Profile-level label | `getProfileTrustLabel` in [`_profileStates.ts`](../../convex/_profileStates.ts) | Changes |

`claimState` is read by several permission gates, but **all of them key on the
`unclaimed` boundary and none on `claimed_verified`**:

- `canEditProfileField` in [`_profilePermissions.ts`](../../convex/_profilePermissions.ts)
  — `claimed_owner` requires `!== "unclaimed"`, `community_submitter` requires
  `=== "unclaimed"`
- [`profileAssets.ts`](../../convex/profileAssets.ts) — three `=== "unclaimed"`
  gates on asset operations
- [`_profilePrivacy.ts`](../../convex/_profilePrivacy.ts) and
  [`oauthApps.ts`](../../convex/oauthApps.ts) — same boundary

Retiring `claimed_verified` therefore changes no authorization, because nothing
authorizes on it. That is a narrower claim than "`claimState` is not a
permission gate", which is false.

## What changes

**Presentation.** Per-identity marks must name the account they attest. A bare
checkmark beside "VRChat" reproduces the overpromise at smaller scale — the
whole point is that the viewer can see *which* account was verified and judge
whether it is the one they expected. `assetDisplayName` and `assetExternalId`
already supply it, and the mark should link out to the account.

**Backend.** `assetBacksThisProfile` and the
`profile.claimState !== "claimed_verified"` upgrade condition stop deciding a
profile-level badge. If any corroboration rule survives, it should be a
*conflict* check rather than a precondition: an association on record that the
claimant's proven account contradicts is worth refusing and flagging; no
association on record is not a reason to withhold anything.

Three further surfaces have to change with it, or the model is stated but not
implemented:

- **`listProfileConnections`** reports `verified` only while the proof is
  `active` *and* inside `revalidateAfter`
  ([`profileConnections.ts`](../../convex/profileConnections.ts)), and the
  `markOverdueControlProofsStale` cron flips every overdue proof to `stale`. So
  the persist-with-date decision below is not merely unimplemented — the current
  projection actively contradicts it, and every mark still vanishes on the
  revalidation window. The projection has to treat stale-but-not-revoked as
  verified, and expose `verifiedAt` so the date can be rendered at all.
- **Claim completion** derives `verified` from
  `result.claimState === "claimed_verified"` at three points in
  [`claim-flow.tsx`](../../apps/web/src/app/claim/%5Bslug%5D/claim-flow.tsx)
  (`:357`, `:411`, `:525`), feeding completion copy, the owner-upgrade branch,
  and the `claim_completed` analytics outcome. Retiring the state without a
  replacement result field tells a claimant whose proof just succeeded that
  their listing is not verified, keeps treating them as an upgrade candidate,
  and records the weaker outcome. Completion should be defined by the identity
  that was just proven.
- **The public contract.** `PublicProfileSchema` exposes `trustLabel` and
  ordinary outbound links; the MCP consumer renders `profile.trustLabel` and
  nothing else
  ([`vrdex-mcp.ts`](../../apps/web/src/lib/server/vrdex-mcp.ts)). Dropping
  `claimed_verified` without adding a sanitized verified-identities
  representation removes the only verification signal API and MCP clients have,
  rather than replacing it.

**Schema.** No new tables. Typed identity handles captured during onboarding
write `profileExternalLinks` rows, which already distinguish an unproven
assertion (`verifiedByProofId` absent) from a proven one.

**Migration, in two deployments.** The schema literal cannot be removed in the
same deploy as the data migration. CI runs `convex deploy` and only then
`migrations:runAll` ([`baseline-checks.yml`](../../.github/workflows/baseline-checks.yml)),
so a contracted schema meets the surviving `claimed_verified` rows before the
function that would clean them up exists, and validation rejects them. The
`clerkUserId` field in [`schema.ts`](../../convex/schema.ts) documents the same
two-phase shape for the same reason.

1. **Deploy one:** keep `claimed_verified` accepted by the schema and the public
   types. Ship the per-identity signal, and run the profile and search-document
   migration.
2. **Deploy two:** contract the schema literal and the public types, once no row
   carries it.

The surfaces the migration touches are more than the profile rows:

- `ALLOWED_CLAIM_STATE_TRANSITIONS` and `getProfileTrustLabel` in
  [`_profileStates.ts`](../../convex/_profileStates.ts)
- the `/api/v0/claims/[slug]/status` contract and its `claimStateForTrustLabel`
  mapping
- the discovery cards that branch on `trustLabel === "claimed_verified"`
- `_seedImportValidators.ts` and `_seedImports.ts`, which accept the literal
- **`searchDocuments`, which cache the ranking.** `trustRankForProfile` in
  [`_searchDocuments.ts`](../../convex/_searchDocuments.ts) assigns 40 to
  `claimed_verified` against 28 to `claimed_unverified`, and the value is
  persisted as both `trustRank` and `featuredRank` and fed into the search
  score. Migrating profile rows alone leaves formerly verified profiles ranked
  above their peers indefinitely under a signal that no longer exists — every
  affected search document has to be rebuilt in the same migration.

## Resolved

**The public API breaks the contract.** `trustLabel` drops `claimed_verified`
rather than freezing it as a legacy value. There are no consumers yet, and
carrying a value that no longer means anything is worse than a break nobody
feels. `/api/v0/claims/[slug]/status` and its `claimStateForTrustLabel` mapping
change with it.

**Typed identifiers are solicited during onboarding, not bolted onto submission.**
The reason is not the notability mark — the model above does not need
corroboration. It is that a person arriving at VRDex should leave onboarding with
a profile that is theirs and identities that are proven, rather than an account
and nothing else. See the onboarding issue; [#219](https://github.com/BASIC-BIT/VRDex/issues/219)
covers the adjacent but distinct job of collecting *presentational* links on the
submit form.

**A verified identity persists with the date it was proven, and is removed only
on affirmative contradiction — never on age.**

The strongest evidence VRDex holds is inherently historical: a VRChat proof code
is a point-in-time demonstration, placed and then removed. There is no continuous
signal to re-read, so "still verified?" is not a question that path can answer.
Revoking on lapse would also produce false negatives from unrelated causes — a
Discord control proof passing its revalidation window because the owner has not
re-authenticated says nothing about whether they still run the server.

Absence is not information a viewer can weigh; a date is. So the mark carries
the date it was proven and stays.

**Candidate copy, pending BASIC's approval — not prescribed:**
`verified · 30 Jul 2026`. Recorded here as a shape rather than a decision; the
exact wording is BASIC's to set before it ships, per the copy policy in
`AGENTS.md`.

Removal needs affirmative evidence that *this* verifier lost control:

- the owner disconnects the account, or the link row is revoked
  (`profileExternalLinks.state` / `removedAt` already model this)
- the proof behind it is revoked — `externalControlProofs` marked revoked, for
  example by Discord reconciliation finding the permission gone
A second proof of the same `vrchat_user` by a different `externalControlProofs.userId`
is **a conflict to record and review, not grounds for automatic removal**. That
field identifies another *VRDex account*, not another person — the same holder
signing up twice, or moving accounts, proves the same VRChat id through both
without ever losing control. Revoking on it would delete valid evidence in
exactly the case the affirmative-contradiction rule exists to protect.

**Not** a second proof on a shared asset. Discord guilds and VRChat groups have
several legitimate administrators, so another staff member proving control says
nothing about whether the first one still has it. Treating that as
contradiction would let any co-admin silently strip a community's mark by
verifying their own access.
