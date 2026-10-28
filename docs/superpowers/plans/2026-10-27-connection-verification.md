# Verified connections implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Display dated verification on the exact VRChat connection proved by
the current profile owner, including existing successful proofs.

**Architecture:** Share an owner-bound historical-proof selector between the
connection query and public projection. Keep fresh-proof authorization
separate. Carry the public result through API/MCP and existing web components,
and use proof settlement rather than profile trust for connection completion.

**Tech Stack:** Node.js 24, pnpm 10.15.1, TypeScript, Convex, Next.js, Zod,
`node:test`, `convex-test`, and Playwright. No new dependency.

**Spec:** [Approved connection-verification design](../specs/2026-10-27-connection-verification-design.md).
BASIC approved the design, wording, and publication rule on October 27, 2026.
BASIC approved this plan and subagent implementation. Execution used one
implementer at a time, independent task reviews, then a whole-branch review.
The tasks share interfaces and run in order.

## Global constraints

- Retain `claimState`, `trustLabel`, profile badges, corroboration checks,
  audit action names, search weights, seed imports, and orphaned-profile
  authorization. No migration, new table, or trust-state elevation.
- A verified connection requires an active owner, active control-association
  link, correctly bound attached proof, and qualifying non-revoked evidence.
  Explicit `directory_reference` links never qualify. Legacy absent provenance
  requires actual proof, not an inferred association.
- Both `active` and `stale` evidence can support historical display. Keep
  `requireControlProof`, fresh-proof selection, and stale-proof authorization
  unchanged. Repair same-subject Discord revocation before using stale display
  evidence.
- Public additions expose only verified VRChat users/groups, their canonical
  URL, optional name, role, and proof date. Never expose owner/proof IDs,
  subjects, codes, raw summaries, or Discord guild identifiers through the new
  public field.
- Derived public links obey `outboundLinks` visibility. Preserve stored links,
  their customization/order, directory provenance, and group reconciliation
  callbacks. No additional provider calls or browser polling.
- Approved copy is `Verified`, `Verified VRChat account`,
  `Verified VRChat group`, `VRChat account verified.`, and
  `VRChat group verified.` Dates use UTC, for example `25 Oct 2026`.
- Keep analytics outcomes tied to profile state. Connection-only settlement
  does not emit ownership completion or place identity IDs in analytics.
- Merge, deployment, production mutations, and new live claim settlement
  require their own authorization. Public read acceptance can reuse an
  existing successful proof after approved deployment.

## Review focus

1. A stale proof can remain visible while being unusable for a new privileged
   action. Task 1 tests both consequences of the same row.
2. A revoked referenced proof can have a valid same-owner alternative, but a
   foreign-owner or wrong-asset reference cannot borrow one. Task 1 tests both.
3. A private link field must not leak through either public profiles or the
   anonymous connection query. Tasks 1 and 2 exercise both readers.
4. An outbound URL with a lookalike host, wrong asset type, query, or hash must
   not acquire verification; a missing outbound row must still show the proved
   connection exactly once. Task 3 tests the composition.
5. A newly settled proof and an old success first loaded on return must not
   produce the same completion announcement or analytics event. Task 3 covers
   actual query transitions, including connection-only additions.

## File map

| Task | Files and responsibility |
| --- | --- |
| 1 | New `convex/_profileConnectionVerification.ts` for the selector; `convex/profileConnections.ts` for query projection/visibility; `convex/discordVerification.ts` for revocation; new `tests/backend/profile-connection-verification.test.ts` and existing `tests/backend/external-control.test.ts` |
| 2 | `convex/profiles.ts` for the public read; the Task 1 helper for visibility-aware public projection; `packages/api-contracts/src/schemas.ts`, package contract tests, generated OpenAPI; hosted MCP in `apps/web/src/lib/server/vrdex-mcp.ts` and tests; standalone MCP API-client tests |
| 3 | `apps/web/src/lib/profile-link-verification.ts`, server profile loading, public profile/Links components and types, account Connections/status, `claim-flow.tsx`, and `convex/profileClaims.ts`; web/backend/browser tests and preview fixtures |
| Acceptance | Existing operator docs, private sanitized receipt, PR checks and visual evidence. No product code beyond Tasks 1-3 |

Use existing profile type declarations and Zod-inferred types. Update their
actual callers, not a parallel interface. Read-only references include
`_profileOwnership.ts`, `_externalControl.ts`, `_profileFieldVisibility.ts`,
`_profilePublic.ts`, `_profileLinkPresentation.ts`, and the current claim and
analytics tests. Change fresh-proof helpers only if correcting an independent
baseline defect is separately agreed.

## Task 1: Owner-bound historical verification and complete revocation

**Interfaces:** Create
`getProfileConnectionVerifications(db: DatabaseReader, profileId: Id<"profiles">, links: readonly Doc<"profileExternalLinks">[]): Promise<Map<Id<"profileExternalLinks">, number>>`
in `convex/_profileConnectionVerification.ts`. Entries map eligible links to
their selected `verifiedAt`. Resolve the active owner inside the helper and
require each supplied link to belong to the requested profile. This helper is
internal code, not a registered RPC. The public query preserves its existing
shape and derives `verified` and optional `verifiedAt` from this map.

- [ ] **Step 1: Establish the baseline.** Confirm branch/status, refresh main,
  compare affected source with the design base, and preserve unrelated work.
  Use the existing isolated worktree. Verify Node 24 and the declared pnpm;
  install the frozen lockfile only if dependencies are missing. Run
  `node --conditions=import --import tsx --test tests/backend/external-control.test.ts tests/backend/profile-claims.test.ts`
  and record any pre-existing failures.
- [ ] **Step 2: Write selector regression tests.** Use `convexTest` and real
  stored owners, links, and proofs in the new test file. Add tests named
  `historical proof belongs to the current owner and exact asset`,
  `stale display evidence cannot authorize a new attachment`, and
  `only a correctly bound reference can use an alternative proof`.
  Assert a `claimed_unverified` person yields a verified VRChat connection and
  exact stored date. Table-drive no owner, removed owner/link,
  directory-reference provenance, absent/dangling/wrong-user/wrong-ID/wrong-type
  proof references, insufficient control, and revoked-only evidence to yield
  `verified === false` with no `verifiedAt`. Assert legacy absent provenance
  and operator-authored links with valid proof still qualify.
- [ ] **Step 3: Pin lifetime and alternative-proof behavior.** Move the same
  row past `revalidateAfter`, then to `stale`; both still project its date.
  Call the real fresh-proof-gated `addVerifiedConnection` for a second owned
  profile and assert rejection. Revoke one correctly bound reference and assert
  the latest qualifying same-owner alternative supplies the date; revoking
  all alternatives removes it. Change owner and assert loss of the old mark;
  proving/attaching as the new owner restores only their date. Ignore invalid
  dates, including non-finite, negative, or future timestamps. Use proof ID
  lexical order as the stable tie break for equal dates.
- [ ] **Step 4: Pin reconciliation and privacy.** In
  `external-control.test.ts`, extend the existing complete-OAuth reconciliation
  tests to revoke stale rows for that subject while preserving another
  subject's surviving evidence. Keep reservation/generation ordering tests.
  Verify unsuccessful or incomplete provider reads never reach reconciliation
  with a fabricated empty guild list. Add query tests proving private
  `outboundLinks` yields no anonymous connections, while the manager retains
  their list and direct reads of unlisted fields follow `profile_page` rules.
- [ ] **Step 5: Run red, implement, then green.** Run the new file and existing
  `external-control.test.ts`, confirming behavioral failures rather than
  harness errors. Implement the selector with existing owner and indexed proof
  reads. Use `self` only for user assets and existing community minimums for
  group/guild assets. Return dates for active or stale non-revoked proofs.
  Replace duplicated query verification with the map and apply field
  visibility to non-manager reads. In Discord reconciliation, broaden the
  revocation filter from active to active-or-stale without changing which
  callbacks may grant. Update the old lapsing-display test to distinguish
  historical display from action authorization.
- [ ] **Step 6: Verify and commit.** Run
  `node --conditions=import --import tsx --test tests/backend/profile-connection-verification.test.ts tests/backend/external-control.test.ts tests/backend/profile-claims.test.ts`
  and `pnpm typecheck:backend`. Expect no skipped regression cases, zero
  failures, and no type errors. Update the connection semantics in
  `docs/backend/profile-access-and-claims.md` with the deliverable. Commit as
  `fix: bind connection verification to current owner evidence`.

## Task 2: Publish one dated connection contract through API and MCP

**Interfaces:** Add `PublicVerifiedConnectionSchema` in the existing schemas
module with exactly `assetType`, `assetExternalId`, `url`, optional
`displayName`, `verifiedAt`, and `linkRole`. The asset enum is
`vrchat_user | vrchat_group`; URLs use the matching canonical HTTPS VRChat
route. Add optional `verifiedConnections` array to `PublicProfileSchema` for
rollout compatibility. Export an inferred `PublicVerifiedConnection` type.

In the Task 1 helper module, add
`getPublicVerifiedConnections(db: DatabaseReader, profile: Doc<"profiles">, surface: ProfileVisibilitySurface): Promise<PublicVerifiedConnection[]>`.
It uses the same selector and existing visibility helper. The new backend
always emits an array; old responses may omit it. Keep the pure
`toPublicProfile` function synchronous.

- [ ] **Step 1: Write projection and contract tests.** Extend the new backend
  test file with `public readers expose the same dated VRChat connection`.
  Query `profiles:getPublicBySlug` for person and community profiles and assert
  exact array shape, canonical URLs, primary-first stable ordering, and an
  empty list after revocation or owner removal. Assert no outbound row is
  required and no stored outbound data changes. Use private, unlisted, hidden,
  and directory-reference fixtures. The projection helper returns no
  discovery entries for private or unlisted fields. Existing Discord
  connections must not enter the new array. Assert absence of internal IDs,
  subjects, and evidence details by checking exact object keys.
- [ ] **Step 2: Add protocol regressions.** In
  `packages/api-contracts/tests/contracts.test.ts`, parse both an old profile
  without the field and a new dated connection. Reject unsupported asset
  types, invalid dates, and URL/asset mismatches. Extend
  `tests/web/vrdex-mcp.test.ts` to assert hosted `vrdex_get_profile` structured
  output and profile-document fetch text name the exact account, URL, and date.
  Extend `packages/vrdex-mcp/tests/api-client.test.ts` to show the standalone
  consumer preserves the array. Use existing fixture transport patterns.
- [ ] **Step 3: Run red and wire the contract.** Run those focused tests before
  implementation. Implement the additive schema and projector, emit it from
  `profiles:getPublicBySlug`, and render a named/date-qualified connection line
  in hosted MCP document text. Do not derive a profile badge or alter
  `trustLabel`. Keep all person/community profile API routes on the common
  projection. Do not introduce another proof RPC.
- [ ] **Step 4: Verify, regenerate, and commit.** Run the Task 1 backend command,
  `node --import tsx --test tests/web/vrdex-mcp.test.ts`,
  `pnpm --filter @vrdex/api-contracts test`,
  `pnpm --filter @basicbit/vrdex-mcp test`, and
  `pnpm typecheck:api-contracts`, `pnpm typecheck:vrdex-mcp`,
  `pnpm typecheck:backend`. Generate with `pnpm generate:api-openapi` and verify
  with `pnpm check:api-openapi`. Include the regenerated
  `docs/api/openapi.json` and `docs/api/openapi.yaml`. Update
  `docs/developers/vrdex-mcp-read-tools.md` with exact field semantics and
  visibility. Commit as `feat: expose dated verified VRChat connections`.

## Task 3: Render the named connection and report proof completion accurately

**Interfaces:** Extend `apps/web/src/lib/profile-link-verification.ts` with
`mergeVerifiedVrchatLinks(outboundLinks: readonly OutboundLink[], verifiedConnections: readonly PublicVerifiedConnection[]): Array<OutboundLink & { verifiedAt?: number }>`.
Derive `OutboundLink` from `PublicOutboundLinkSchema` with `z.infer` and use
Task 2's inferred `PublicVerifiedConnection`. Existing supplied labels/order are retained;
missing verified identities append canonical `vrchat_profile` link items.
Keep the existing strict URL parser and match by type plus normalized ID.
Only a timestamp from a verified connection can produce a mark.

Add `targetExternalId` to the authorized `lastVerifiedProof` context. Where
direct adapter results lack a completed target, return that target to the
authorized caller too. Reuse the successful attempt's target type, timestamp,
and existing journey binding; never infer it from profile trust.

- [ ] **Step 1: Write web composition tests.** Extend
  `tests/web/profile-link-verification.test.ts` with
  `a missing outbound row still yields one dated verified identity` and
  `custom labels and ordering survive an exact identity match`. Assert
  connection-only append order, stable deduplication, correct ID/name fallback,
  legacy absence as no assertion, and removal after revocation. Retain hostile
  host, protocol, route, wrong asset, query, and fragment rejection cases.
  Unrelated links remain unmarked. Add UTC date assertions around midnight.
- [ ] **Step 2: Write completion regressions.** Extend
  `tests/backend/profile-claims.test.ts` for claimant-only completed target
  exposure without new metadata for signed-out/other viewers. Extend
  `apps/web/e2e/auth-claim.flow.spec.ts` using its real reactive query and
  existing test-only settlement mechanism. Assert a pending proof completing
  on a `claimed_unverified` profile shows `VRChat account verified.`, names the
  account, and leads to a dated Connections entry. Reopening the page shows
  the saved connection without replaying completion. Test adding a second
  connection without another ownership-completion event and preserve existing
  profile-state analytics outcomes. These are synthetic settlements, not live
  provider proof.
- [ ] **Step 3: Run red and integrate.** Use the focused web and backend test
  commands. Remove the server-only connection fetch/annotation from
  `apps/web/src/convex/server.ts`; compose visible links from the common public
  array. Extend actual public profile types and Links props to carry the date.
  Render a named account/group, existing checkmark, approved status, and UTC
  semantic date in public Links and account Connections. Use the same named
  connection data in `profile-verification-status.tsx`; keep loading from
  flashing a repeat prompt. Update collector and direct-adapter completion
  branches in `claim-flow.tsx`, separating connection success from the legacy
  profile-state analytics flag. Preserve initial-load suppression and
  connection-only handling.
- [ ] **Step 4: Verify visible cases.** Extend the existing verification preview
  and `profile-verification.fixture.spec.ts` with dated, no-outbound,
  revoked, and mobile cases. Update `claim-completion.fixture.spec.ts` and
  preview inputs to match the real contract. Run
  `node --import tsx --test tests/web/profile-link-verification.test.ts tests/web/profile-claim.test.ts tests/web/claim-analytics.test.ts`,
  the Task 1 backend command, `pnpm lint:web`, and `pnpm typecheck:web`.
  Run `pnpm --filter web exec playwright test profile-verification.fixture.spec.ts claim-completion.fixture.spec.ts --project=desktop-chromium --project=mobile-chromium`
  with the repo's local fixture setup, then the live-query
  `auth-claim.flow.spec.ts` on its configured local/test target. Do not silently
  count auth skips as success. If auth/runtime prerequisites are unavailable,
  record the missing evidence and let the selected CI lane exercise it before
  completion.
- [ ] **Step 5: Inspect visuals and commit.** Inspect desktop/mobile screenshots
  for public Links, account Connections, and completion; use visual review for
  name/date legibility, long IDs, duplicate items, and checkmark placement.
  Update relevant claim/connection docs with the approved copy and the
  unchanged profile-state distinction. Run `pnpm lint:markdown` and
  `git diff --check`. Commit as
  `fix: show verification on the proved profile connection`.

## Task 4: Integration review and separately approved rollout acceptance

- [ ] **Step 1: Complete branch verification.** Run `pnpm test:backend`,
  `pnpm test:web`, package tests, affected typechecks, web lint, Markdown lint,
  and the OpenAPI check. Confirm no table, migration, lockfile, provider
  credential, stored-link rewrite, or profile-state change entered the diff.
  Obtain independent whole-branch review. Fix valid feedback and rerun the
  affected checks.
- [ ] **Step 2: Publish within authorized scope.** Push the review branch and
  create a draft PR when implementation is authorized, attach it to this chat,
  and select `ci:browsers` and `ci:visuals` before a normal PR run. Describe the
  connection behavior and publication rule, with actual validation and missing
  evidence. Prefix posted agent prose with `[AGENT]`. If asked for merge
  readiness, observe the repo's 30-minute current-head window and final full
  feedback refresh. Do not infer merge/deploy authorization from plan approval.
- [ ] **Step 3: After explicit release approval, verify existing proof.** Deploy
  backend before or with web, verify the exact revision, and read the affected
  existing successful proof without mutations. Compare public profile/API/MCP
  identity and date, inspect its visible page, and verify private-link omission
  on a controlled fixture. The claimant's private session remains unavailable
  unless they provide access or confirm the result themselves.
- [ ] **Step 4: Save a bounded receipt.** Record source, checks, runtime target,
  sanitized projection outcomes, screenshots, and explicit unknowns. Do not
  store proof codes, bios, private IDs, or sessions. No new live settlement or
  cleanup of a user's bio is needed for this reader change. Rollback can
  restore the old display without reversing ownership or legitimate
  revocations.

## Plan validation and evidence appendix

Self-review traces owner binding, provenance, lifetime, and revocation to Task
1; public contracts/privacy to Task 2; named dated UI, deduplication,
completion, and analytics to Task 3; exact-release acceptance to Task 4.
Every Review focus item has a named regression above. Additive fields tolerate
the backend/web rollout order. Implementation choices not fixed here are local
fixture arrangement and small rendering/helper splits following existing
patterns.

Design commit: `5e1fee33d`. Reviewed source base:
`352f4b26503120137180820a9269ebdbe9ea5a8e`. Worktree:
`C:/Users/steve/.codex/worktrees/vrchat-person-proof-design/VRDex`, branch
`codex/connection-verification-design`. Refresh affected source before coding.
The implementation plan was self-reviewed and edited with unslop.

## Execution status

Tasks 1-3 are implemented with independent reviews. Review fixes cover the
JavaScript date boundary, successful collector-race responses, and preservation
of resolved destination names. Scoped backend checks, 927 web tests, 14
desktop/mobile browser fixtures, API/MCP package tests, typechecks, lint, and
OpenAPI checks passed. A claim-expiry hydration error found during visual
inspection was corrected using the existing date component.

Four authenticated browser tests skipped because local Clerk test credentials
were unavailable. The broad backend run reported a failure in unchanged media
encoder code and stalled in a Twitch-input test; its baseline runtime status
is unknown. Neither gap is a passing result. Hosted CI, merge readiness, and
production acceptance remain separate. No merge or deployment was performed.
