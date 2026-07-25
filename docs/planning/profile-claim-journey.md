# Profile Claim Journey

## Status

Current recommendation for the focused claim/link redesign.

## Product Decision

Locked decision:

- Linking an authentication provider to an account and claiming a VRDex profile
  are distinct jobs.
- A claim starts from a specific profile. The profile record determines whether
  it is a person or community; the user is not asked to choose the type again.
- The canonical contextual entry is `/claim/<profile-slug>`.
- Existing `/account?claim=<slug>&claimType=<type>` links redirect to the
  canonical claim route.
- Generic search remains a separate product surface. It may link an eligible
  result to `/claim/<profile-slug>?source=search`, but ownership, readiness, and
  verification behavior stay in the claim journey.

Current recommendation:

- Lead with VRChat proof for people because it grants verified ownership.
- Keep the existing Discord person path as a secondary quick claim and state
  plainly that it grants owner control without verified-owner status.
- Lead with Discord Administrator verification for communities, with VRChat
  group proof as the alternative.
- Keep VRC Linking support in the backend adapter seam, but remove it from the
  core UI until its user-facing provider contract and instructions are
  verified.

## Verified Current Behavior

- Discord person claims immediately grant `claimed_unverified` owner authority
  to a verified-email account with a linked Discord account. The current
  backend does not prove that the Discord identity belongs to the represented
  person.
- Discord community claims verify owner or Administrator permission for the
  supplied guild before granting `claimed_verified` authority.
- VRChat user and group proof attempts issue a one-time code, expire after 24
  hours, and grant `claimed_verified` authority after the configured adapter
  confirms the proof.
- VRC Linking uses the same proof-attempt substrate but a separate configured
  adapter and evidence source.
- Claim requests and verification attempts persist in Convex, but the previous
  account UI kept their identifiers and proof codes only in component state.
  Refreshing the page therefore lost the resumable UI.
- Profile slugs are globally unique through the `profiles.by_slug` index, so
  the canonical claim route does not need a person/community path segment.
- Verified email remains required for every claim-level action.

## Core Journey

1. The user enters from an unclaimed public profile, a future search result, or
   a legacy account claim link.
2. Signed-out users are sent to sign in and returned to the same claim route.
3. The claim page shows the exact profile name, image, type, URL, and current
   trust state before any mutation is offered.
4. The page checks whether the viewer already owns the profile, another owner
   controls it, or it is available to claim.
5. Available profiles show a small set of outcome-oriented verification
   choices. Stronger verified paths are presented before the unverified
   Discord person shortcut.
6. Multi-session proof attempts render as a persistent pending step with a
   copyable code, expiry, tailored instructions, and a check action.
7. Success returns the user to the profile and exposes account privacy and
   appearance management without mixing those jobs into the claim form.

## State Model

- `loading`: account and claim context are resolving.
- `email_verification_required`: claim actions stay unavailable.
- `available`: show compatible verification choices for the target profile.
- `pending_discord_admin`: resume checking the viewer's community claim.
- `pending_external_proof`: restore the proof code, expiry, and verification
  action after navigation or refresh.
- `already_owned`: show the profile and owner-management actions.
- `owned_by_another`: render a calm terminal state without verification forms.
- `success_unverified`: owner control was granted through Discord person claim;
  offer profile access and keep the VRChat upgrade path available on return.
- `success_verified`: verified owner control was granted.
- `failed` or `expired`: give an accurate recovery action rather than replacing
  the error with a false profile-not-found message.
- `provider_unavailable`: preserve the pending proof and distinguish an adapter
  outage from a proof code that has not been found yet.

## Security And Privacy

- Client state never becomes claim authority. Convex remains the source of
  truth for email verification, provider linkage, active ownership, evidence,
  and claim-state transitions.
- Claim analytics contain only profile type, method, entry source, and bounded
  outcome labels. They exclude profile slugs, proof codes, guild IDs, VRChat
  IDs, provider account IDs, and error text.
- Session replay remains disabled on the claim route.
- The UI does not imply that Discord person quick claim verifies the represented
  identity.
- Claimed-by-another conflicts do not reveal the owner or private evidence.
- Canceling a visible pending step changes only that proof attempt or claim
  request; it does not silently reject another legacy pending record.

## Implementation Boundary

Included in the focused claim PR:

- the canonical profile-scoped route and legacy redirect;
- exact target preview and contextual public-profile entry;
- account-owned profile projection;
- resumable pending Discord and VRChat proof states;
- idempotent reuse of matching live proof attempts and community requests;
- stale proof-attempt expiry;
- focused claim telemetry, accessibility behavior, tests, and visual evidence.

Deferred:

- generic search, DJ Lookup unification, search indexes, shared search cards, and
  search telemetry;
- ownership transfer, release, unlinking, and structured disputes;
- claim support/admin tooling and notification delivery;
- OAuth-provider configuration changes;
- production mutations or real-account verification;
- a user-facing VRC Linking path until provider behavior is verified.

## Research Checklist

- `Verified`: profile type and claim state are available from the selected
  public profile.
- `Verified`: protected-route return paths preserve the selected claim URL.
- `Verified`: claim requests and proof attempts have profile/user indexes
  suitable for bounded resume queries.
- `Verified`: public search already indexes profiles, worlds, and events; it is
  not a dependency of this PR.
- `Verified`: current product analytics remove URL queries and do not allow
  session replay on account/form routes.
- `Open research`: durable provider instructions and support posture for VRC
  Linking.
- `Interview later`: whether Discord person quick claim should remain an
  immediate owner grant or become review/rate-limit gated.
- `Interview later`: the structured dispute and ownership-transfer experience.

## Independent Taste Review

The initial independent Fable pass reviewed the current repository and supplied
screenshot before seeing a proposed redesign. It identified the mechanism-first
tab matrix, blind target input, hidden trust difference, ephemeral proof state,
raw provider IDs, and inaccurate fallback errors as the primary defects. Its
recommended direction was a narrow profile-scoped journey, an exact target
preview, outcome-oriented method choices, and resumable proof state.

The local audit trail records:

- requested and returned model: `claude-fable-5`;
- permission mode: `plan`;
- built-in tools: `Read`, `Glob`, and `Grep` for discovery, then none for
  synthesis;
- setting sources and MCP servers: none;
- permission denials: none;
- initial input SHA-256:
  `272b693d9980c123aafa5b81edbbdb51707cbfe5dd5a7f8d03d5b5f5ca053a24`.

The implemented flow then received two separate read-only reviews:

- Fable taste review session `128e83c6-417f-47be-bd26-04e3fb42a8c0`,
  returned model `claude-fable-5`;
- Opus correctness review session `88410b1e-0f9a-4ec6-b255-fed1c9f8ed29`,
  returned model `claude-opus-4-8`.

Both used plan mode with only `Read`, `Glob`, and `Grep`, empty setting sources,
strict empty MCP configuration, and zero permission denials. Their valid
findings were applied: accessible success/pending announcements, explicit
restart controls, honest Discord trust copy, preserved retryable proof state,
claim-URL analytics redaction, community-specific default ordering, and
VRC-Linking resume isolation.
