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

Concierge-seeded profiles can therefore be verified, by hand. Profiles created
through public submission cannot, ever. The submit form captures `displayName`,
`aliases`, `tags`, `roleTags`, `categoryTags`, `subtype` — no service-typed
identifier — so there is nothing for an association to attach to at creation.

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

3. **A "verified person"**, if the term is kept, means: has claimed the profile
   **and** has at least one verified platform identity. That is
   `∃ profileExternalLinks row with verifiedByProofId` — reachable today by the
   claimant's own proof, because nothing in it asserts identity.

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

`claimState` is a trust label rather than a permission gate. The only
authorization that reads it is `canReadProfile`, distinguishing `unclaimed` from
claimed; nothing keys on `claimed_verified`. Retiring it as a *signal* therefore
has a small blast radius.

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

**Schema.** No new tables. Typed identity handles captured during onboarding
write `profileExternalLinks` rows, which already distinguish an unproven
assertion (`verifiedByProofId` absent) from a proven one. Retiring
`claimed_verified` from `claimState` needs a migration for existing rows and
touches `ALLOWED_CLAIM_STATE_TRANSITIONS`, `getProfileTrustLabel`, the
`/api/v0/claims/[slug]/status` contract, and the discovery cards that branch on
it.

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

Absence is not information a viewer can weigh; a date is. So the mark reads
"verified · 30 Jul 2026" and stays. It is removed when something actually
contradicts it: the owner disconnects the account, the link row is revoked
(`profileExternalLinks.state` / `removedAt` already model this), or control is
proven by somebody else.
