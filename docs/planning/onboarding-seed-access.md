# Onboarding Seed Access

## Status

Current recommendation from the July 9, 2026 onboarding and seed-access pass.

This document captures the minimum viable path for turning permissioned DJ link
lists into useful VRDex onboarding, lookup, and claim/handoff workflows without
making private seed data public by accident.

## Why This Exists

VRDex already has planning and backend foundations for:

- reviewed seed imports
- unclaimed and claimed profile states
- public lookup and search
- concierge or handoff profiles
- PostHog product analytics direction

The current gap is the connective product slice:

- import a real permissioned DJ list
- let the operator inspect and use it before publication
- let trusted beta users see more than the public web sees, if desired
- generate a pleasant link for a person to review and claim a prepared profile
- publish only safe, reviewed public fields when the record is ready

Do not call this `draft users`. The useful object is a profile or import
candidate, not a user account. User accounts should be created by the real
person during claim, handoff, or ordinary signup.

## Live Context Checked

- `main` was refreshed on July 9, 2026 before this pass.
- Open PRs at the time of review:
  - [#159 Public API and MCP platform foundation](https://github.com/BASIC-BIT/VRDex/pull/159)
  - [#152 Add gated production auth smoke](https://github.com/BASIC-BIT/VRDex/pull/152)
- The design-system/home-direction worktree adds product direction around
  operator-first utility, direct search, dense `/lookup`, and home as a
  data-forward scene utility.
- Existing issue searches found PostHog and seed-import coverage, but no single
  issue for private seeded lookup, invite/handoff claim links, or beta access to
  unpublished seed data.

## Existing Coverage

Covered:

- `docs/planning/product-spec.md` already names concierge or handoff profiles,
  partner and list seed imports, and dense DJ lookup mode.
- `docs/planning/seed-import-model.md` already defines seed import batches,
  candidate profiles, candidate fields, review state, publication state, safe
  public fields, and blockers for queueing publication.
- `docs/backend/profile-access-and-claims.md` already defines `draft_private`,
  public read boundaries, claim states, owner authority, and field visibility.
- `docs/backend/search-discovery.md` already requires lookup/search to enforce
  publication state, surfacing state, field visibility, and safe PostHog
  discovery events.
- `docs/agentic/product-analytics-and-feature-flags.md` already selects PostHog
  as the first-pass analytics and feature-flag default.

Missing or only partly covered:

- real partner-list ingestion from a non-committed operator file
- super-admin private lookup over unpublished seed candidates
- beta user access to private seed lookup, if product-approved
- handoff invitation links tied to a candidate or concierge profile
- owner confirmation of prefilled fields before claim/publication
- PostHog feature-flag implementation, session replay privacy posture, and
  reverse-proxy setup

## Terminology

Current recommendation:

- `Seed candidate`: an imported possible profile record in staging.
- `Private seed candidate`: a seed candidate that is not publicly readable.
- `Concierge profile`: a richer private profile prepared by a trusted operator
  for a real owner to review.
- `Handoff invitation`: a tokenized link that lets the real owner review,
  sign in, claim, edit, and publish or keep private.
- `Published unclaimed profile`: a public profile created only after review,
  still clearly labeled as unclaimed or partner-provided.
- `Beta seed access`: a permissioned read path for trusted users to see more
  seed data than anonymous public users.

Avoid:

- `draft user`
- public copy that says or implies VRDex owns the identity before claim
- public copy that exposes import mechanics or provider uncertainty

## Interview Notes

Observed workflow:

- NWIN has a DJ master list with names and public links gathered through event
  operations.
- Close friends can be sent a direct profile or handoff link with minimal
  explanation.
- Less-close contacts need a short, human-written paragraph that explains why
  VRDex exists and what they are being asked to do.
- `vrc.club`-style event confirmation links are a useful analogue: a person can
  receive a link, confirm their participation or identity, and create an account
  if needed.
- A populated lookup page is useful immediately for operators, even before the
  public directory is broadly launched.

Implication:

- The smallest useful onboarding loop is not "launch all imported profiles."
  It is "import safely, inspect privately, publish or hand off deliberately."

Risk:

- Operator-added identity records can feel creepy if they appear public before
  the subject understands them, especially when the source is not already public
  and permissioned.
- A beta flag cannot be the only access control for private data. Backend reads
  must enforce capability checks.

## Decisions

Locked decision:

- Real partner spreadsheets, raw exports, and private list files must not be
  committed to the repo.
- Private seed candidates must not enter public search documents, public API
  responses, or anonymous lookup results.
- Server-side authorization, not a client-side feature flag, is the source of
  truth for private seed access.
- Owner confirmation is required before prefilled fields become
  `owner_confirmed`.
- Publication of an imported candidate into a public profile must be deliberate,
  reviewed, and limited to safe public fields.

Current recommendation:

- Treat the NWIN list as a permissioned partner seed source if NWIN is comfortable
  with that use.
- Start with one operator-only import path and one operator-only private lookup
  path before broad beta access.
- Use PostHog flags to stage UI access, measure adoption, and provide kill
  switches, but mirror private-data access in Convex authorization.
- Use `published_unclaimed` only for records with safe public links that have
  been reviewed and are acceptable to show as partner-provided or unclaimed.
- Use handoff invitations for close-friend onboarding and for curated profiles
  that should stay private until the recipient signs in and reviews them.

Candidate direction:

- Let a small beta cohort view private seed lookup after the super-admin path is
  proven.
- Later, let trusted community owners generate handoff links for DJs attached to
  their events, but only after abuse, opt-out, and provenance paths are clearer.
- Add a self-serve "search for yourself and claim" flow over public unclaimed
  profiles after the direct handoff path works.

Interview later:

- What public label feels least awkward for a reviewed imported profile:
  `partner-provided`, `community-submitted`, `unclaimed`, or something else?
- Does NWIN explicitly approve using the list for private import only, public
  lookup, or both?
- Which fields from the NWIN list are acceptable for public display on day one?
- Should beta seed access be granted by a small allowlist, a role, a PostHog
  cohort mirrored into Convex, or a manual operator grant table?
- What expiration and reuse rules should handoff links use?
- Should close friends receive a full profile handoff, or just a public unclaimed
  link plus a claim CTA?

## Minimum Viable Path

### 1. Import Real DJ Link Data Into Review Staging

Goal:

- Convert NWIN's permissioned DJ master list into seed import candidates without
  publishing anything by default.

Scope:

- add an operator script or internal mutation that reads a local, uncommitted
  file
- normalize display names, aliases, and outbound links
- classify supported public links such as VRCDN, Twitch, VRChat, SoundCloud,
  Mixcloud, YouTube, Bandcamp, Linktree, website, and booking links
- preserve source name, import batch, source contact, importer, received time,
  and field-level confidence
- reject private notes, private contact details, raw account identifiers, and
  unsupported scraped data

Acceptance signal:

- an operator can import a small sample batch into `draft_private` candidates
  and read it back from Convex without any candidate appearing publicly.

### 2. Add Super-Admin Private Seed Lookup

Goal:

- Make `/lookup` useful against imported data before public publication.

Scope:

- add a private read query for seed candidates
- require a super-admin or reviewer capability in Convex
- make `/lookup` include private candidates only when the server authorizes the
  viewer
- visibly distinguish private seed candidates from public profiles in the
  operator UI
- keep anonymous public lookup backed only by public profile/search data

Acceptance signal:

- the operator can search real imported candidates privately, while a signed-out
  user sees no unpublished seed data.

### 3. Add Reviewed Public Publication For Safe Link Records

Goal:

- Make selected NWIN records useful to real public users through normal lookup
  without exposing unreviewed data.

Scope:

- extend the existing seed publication marker into actual public profile create
  or merge behavior
- allow only safe public fields and HTTPS outbound links
- block opted-out, suppressed, duplicate, or matched claimed profiles
- create or refresh search documents after publication
- render the public entry as unclaimed or partner-provided without overexplaining

Acceptance signal:

- a reviewed candidate can become a public unclaimed profile and appear in
  `/lookup`, `/search`, and `/p/<slug>` with only safe public fields.

### 4. Add Handoff Invitation Links

Goal:

- Let a person receive a direct link to a prepared profile and claim it with low
  friction.

Scope:

- generate tokenized handoff invitations from a seed candidate, private
  concierge profile, or published unclaimed profile
- support expiry, revocation, one-time or limited-use policy, and audit metadata
- show a calm review page with the prepared profile, safe source context, and
  direct CTA to sign in or create an account
- require verified email before claim-level actions when email/password is used
- let the recipient edit, remove, confirm, publish, or keep fields private

Acceptance signal:

- an invited person can open a link, sign in, claim the existing record, review
  prefilled fields, and land on their owner-controlled profile without creating
  a duplicate identity.

### 5. Add PostHog Flag, Replay, And Proxy Foundation

Goal:

- Make staged rollout observable without relying on blind deploys.

Current repo state:

- `posthog-js` is installed.
- the app initializes PostHog when `NEXT_PUBLIC_POSTHOG_KEY` is set.
- discovery events are already emitted.
- Terraform records the hosted PostHog project and Vercel public env vars.
- feature-flag checks, session replay privacy settings, and reverse-proxy
  routing are not yet implemented.

Scope:

- add a small PostHog helper for client-side flags and event capture
- add a server-side or Convex-side access gate for private seed data that does
  not depend on client-side flags
- add onboarding and lookup events that avoid private fields and raw account
  identifiers
- decide whether session replay is disabled, sampled, or route-limited for
  admin/import/handoff paths
- add a reverse proxy path only if replay or flag polling reliability justifies
  the Vercel transfer and edge-request cost

Provider notes from current PostHog docs:

- PostHog feature flags support phased rollouts, kill switches, targeting, beta
  programs, experiments, and remote config.
- PostHog's Next.js reverse proxy guidance routes events, recordings, flag
  polls, and SDK assets through the app domain, but calls out Vercel data
  transfer and edge-request cost, especially for session recordings.
- PostHog session replay masks input elements by default, and browser-side
  privacy controls mean masked data is not sent to PostHog.

References:

- [PostHog feature flags](https://posthog.com/docs/feature-flags)
- [PostHog Next.js rewrites reverse proxy](https://posthog.com/docs/advanced/proxy/nextjs)
- [PostHog session replay privacy controls](https://posthog.com/docs/session-replay/privacy)
- [PostHog Node.js SDK](https://posthog.com/docs/libraries/node)

Acceptance signal:

- seed lookup and handoff work can be rolled out to super-admin, then a small
  beta cohort, with analytics and kill-switch posture documented.

## Suggested Issue Slices

### Add permissioned DJ seed import tooling

Implement real partner-list import into seed staging without committing source
data or publishing candidates by default.

### Add private seed lookup access

Let super-admins and later approved beta users search unpublished seed
candidates through a server-authorized lookup path.

### Add reviewed seed publication into public unclaimed profiles

Convert selected, reviewed seed candidates into safe public unclaimed profiles
with normal search, lookup, public profile, provenance, and opt-out boundaries.

### Add concierge handoff invitation links

Generate tokenized links that let a person review, sign in, claim, edit, and
publish or keep private a prepared profile.

### Add PostHog rollout controls for onboarding and seed lookup

Add feature-flag, analytics, replay/privacy, and reverse-proxy posture for the
onboarding and seed-access flows.

## Open Product Question

The main decision before implementation is the public/private boundary for the
NWIN list:

- private operator seed only
- private operator seed plus small beta lookup
- reviewed public unclaimed profiles for safe public links

The recommended first implementation supports all three as states, but starts
with private operator seed access until permission and public-label language are
confirmed.
