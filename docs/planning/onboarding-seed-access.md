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
- let the operator inspect and use it while it remains private
- let trusted beta users see more than the public web sees, if desired
- generate a pleasant link for a person to review and claim a prepared profile
- keep public publication as a separate, source-specific decision rather than a
  default import outcome

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
  candidate profiles, candidate fields, review state, confidence, publication
  state, safe public fields, and blockers for queueing publication. The current
  schema stores batch `receivedAt` and per-field `reviewedAt`, but not when
  the source value was observed or last rechecked.
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
- field-level source-observed and last-checked timestamps for freshness-sensitive
  imported values
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

## Review, Verification, And Freshness

Current implementation:

- A seed batch has `receivedAt`.
- Each imported field has review state, confidence, `reviewedBy`, and
  `reviewedAt`.
- Confidence can be `low`, `medium`, `high`, or
  `owner_confirmed`.
- There is no implemented timestamp for when the source value was observed or
  when VRDex last checked it.

Current recommendation:

- `Reviewed` means an operator accepted the field for its intended private
  use. It does not mean the field is current or owner-verified.
- Add optional `sourceObservedAt` metadata when a source provides a real
  snapshot or as-of date. Do not substitute import time when that date is
  unknown.
- Add optional field-level `lastCheckedAt` for values such as links after
  a human or automated reachability check. A successful link check proves the
  URL responded, not that the owner endorses it.
- Keep unknown freshness explicitly unknown. Do not infer that an older source
  is stale or a recent import is verified.
- Set `owner_confirmed` only through an owner-controlled handoff or claim
  action and preserve that action time in audit metadata.

Authorized lookup can show compact internal metadata such as `Source: NWinn`,
`Reviewed <date>`, and `Freshness unknown` or `Checked <date>`. It
must not display a verified mark based only on partner provenance or operator
review.

## Interview Notes

Observed workflow:

- NWinn has a DJ master list with names and public links gathered through event
  operations.
- The source date for the current NWinn list is not known, so imported values
  should start with unknown freshness even when the source itself is trusted.
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
  It is "import safely, inspect privately, grant beta access deliberately, and
  hand off individual records when useful."

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
- NWinn seed candidates must remain private operator or beta lookup data. Do not
  publish NWinn records directly as public unclaimed profiles.
- Server-side authorization, not a client-side feature flag or PostHog cohort,
  is the source of truth for private seed access.
- Operator review, source confidence, link reachability, and owner verification
  are distinct states and must not be collapsed into a single verified label.
- Owner confirmation is required before prefilled fields become
  `owner_confirmed`.
- Publication of an imported candidate from any other approved source into a
  public profile must be deliberate, reviewed, and limited to safe public
  fields.

Current recommendation:

- Treat the NWinn list as a permissioned partner seed source for private lookup,
  assuming NWinn is comfortable with that use.
- Start with one operator-only import path and one operator-only private lookup
  path, then add a small explicitly granted beta cohort.
- Store the private-data grant in Convex, then mirror that grant into a PostHog
  person property and cohort for UI rollout, measurement, and kill switches.
  The synchronization direction is backend to PostHog, not PostHog to backend.
- Reserve `Community submitted` for public profiles actually created through
  the community-submission path. Authorized NWinn lookup rows should show source,
  review, and freshness metadata instead of a public trust badge.
- Use handoff invitations for close-friend onboarding and for curated profiles
  that should stay private until the recipient signs in and reviews them.

Candidate direction:

- Later, let trusted community owners generate handoff links for DJs attached to
  their events, but only after abuse, opt-out, and provenance paths are clearer.
- Add a self-serve "search for yourself and claim" flow over public unclaimed
  profiles from sources that have an explicit public-publication posture after
  the direct handoff path works.
- Keep generic reviewed publication available as a separate future capability
  for other permissioned sources; it is not part of the NWinn path.

Interview later:

- Should beta grants expire automatically, and who besides the super-admin may
  grant or revoke them later?
- Which field types need active rechecks, and what age should produce a stale
  warning instead of only an unknown-freshness label?
- What expiration and reuse rules should handoff links use?
- Should close friends receive a full private profile handoff or a narrower
  candidate preview plus a claim CTA?
- What public label should other, explicitly publishable imported sources use?
  `Community submitted` remains acceptable for ordinary community-created
  records but should not erase more specific provenance.

## Minimum Viable Path

### 1. Import Real DJ Link Data Into Review Staging

Goal:

- Convert NWinn's permissioned DJ master list into private seed import candidates
  without creating public unclaimed profiles.

Scope:

- add an operator script or internal mutation that reads a local, uncommitted
  file
- normalize display names, aliases, and outbound links
- classify supported public links such as VRCDN, Twitch, VRChat, SoundCloud,
  Mixcloud, YouTube, Bandcamp, Linktree, website, and booking links
- preserve source name, import batch, source contact, importer, received time,
  review state, and field-level confidence
- preserve a real source-observed date when supplied and leave it unknown for
  the current NWinn list; add field-level last-checked time only after an actual
  recheck
- reject private notes, private contact details, raw account identifiers, and
  unsupported scraped data

Acceptance signal:

- an operator can import a small sample batch into `draft_private` candidates
  and read it back from Convex without any candidate appearing publicly.

### 2. Add Super-Admin Private Seed Lookup

Goal:

- Make `/lookup` useful against imported data without public publication.

Scope:

- add a private read query for seed candidates
- require a super-admin or reviewer capability in Convex
- make `/lookup` include private candidates only when the server authorizes the
  viewer
- visibly distinguish private seed candidates from public profiles in the
  operator UI
- show compact source, review, and freshness metadata without implying owner
  verification
- keep anonymous public lookup backed only by public profile/search data

Acceptance signal:

- the operator can search real imported candidates privately, while a signed-out
  user sees no unpublished seed data.

### 3. Add Backend Beta Grants And A PostHog Cohort

Goal:

- Let a small trusted beta group use private seed lookup while keeping Convex as
  the authorization boundary.

Scope:

- add a small auditable account grant record for
  `view_private_seed_lookup`, with grant, revoke, and optional expiry metadata
- use the same backend authorization helper for super-admin and beta lookup
  reads
- expose only the viewer's boolean access result to the web client
- identify the authorized user in PostHog with a stable beta-access property,
  build a cohort from that property, and target the seed-lookup UI flag to it
- update or clear the PostHog property after backend grant changes; never grant
  data access because a PostHog cohort or flag says true
- keep seed values, source rows, and raw account identifiers out of analytics

Acceptance signal:

- a granted beta user can use private seed lookup, an ordinary signed-in user
  cannot, and disabling PostHog does not change either authorization result.

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
- mirror backend beta-grant state into a PostHog person property and cohort for
  targeting and analysis
- keep the server-side Convex access gate authoritative when flags, cohorts, or
  PostHog itself are unavailable or stale
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

- seed lookup and handoff work can be rolled out to super-admin, then a
  backend-granted beta cohort, with analytics and kill-switch posture documented.

## Suggested Issue Slices

### Add permissioned DJ seed import tooling

Implement real partner-list import into seed staging without committing source
data or publishing candidates by default.

### Add private seed lookup access

Let super-admins search unpublished seed candidates through a server-authorized
lookup path with source, review, and freshness context.

### Add backend beta grants and PostHog cohort rollout

Grant selected accounts private seed lookup in Convex, then mirror the grant to
PostHog for cohort targeting, measurement, and UI rollout.

### Add reviewed seed publication into public unclaimed profiles later

Keep generic publication as a separate future capability for explicitly
publishable sources. NWinn records are out of scope for this issue.

### Add concierge handoff invitation links

Generate tokenized links that let a person review, sign in, claim, edit, and
publish or keep private a prepared profile.

### Add PostHog rollout controls for onboarding and seed lookup

Add feature-flag, analytics, replay/privacy, and reverse-proxy posture for the
onboarding and seed-access flows.

## Resolved Direction For NWinn

The NWinn boundary is now:

- import the list as private partner seed data
- start with operator-only lookup
- add access for a small backend-granted beta cohort after the operator path is
  proven
- do not turn NWinn candidates directly into public unclaimed profiles
- allow an individual record to enter an owner-controlled handoff flow when
  there is a real onboarding reason

This keeps the list useful for lookup and concierge onboarding without making
public-profile labeling a prerequisite. Generic reviewed publication remains a
separate capability for sources with an explicit public-use agreement.
