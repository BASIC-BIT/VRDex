# Club staff workspace

## Scope

The club workspace implements slice 1 of the [approved staff and visibility design](../planning/group-instance-analytics/2026-09-10-club-staff-and-visibility-design.md). It adds VRDex staff roles, invitation links and category visibility to the existing telemetry system. Provider operations and the Recharts dashboard remain later slices.

## Authority

Ownership remains in `profileOwners`. The owner is not a staff role. Active `communityRoles` define capabilities and explicit assignable role sets; active `communityAuthorities` join a person to one or more roles. Capabilities combine across assigned roles. Only the owner edits role definitions and category visibility.

Delegated staff management requires `manage_staff` and an explicit assignable role set. Starter roles have empty assignable sets. Removing a role revokes its assignments and removes references from delegation and visibility settings. A selected-role audience with no remaining roles becomes owner-only.

Legacy capability grants remain readable during this additive transition. Do not remove the legacy schema fields based on assumptions about deployed data. Inventory and migration verification are separate release work.

The initial implementation bounds roles and assignments: at most 100 active roles per club, 100 assignments per recipient and 500 active assignments per club. Invitation acceptance checks the resulting totals transactionally. An already-oversized legacy roster returns a bounded list with a truncation indicator so the owner can revoke assignments; role deletion requires reducing that roster first. These are implementation limits, not membership limits for the connected VRChat group.

Staff invitations are cursor paginated in the staff screen so older pending links remain discoverable and revocable. Staff workspace discovery seeks at most 100 distinct clubs and stops after a bounded assignment/role read budget in unusually large invalid rosters, reporting that more may exist. The account screen does not page beyond that discovery result yet.

`edit_community_profile` remains readable in legacy role data, but new role grants and starter roles omit it until the profile editor supports staff authority. The profile editor remains owner-only.

## Invitations

`communityStaffInvitations` stores a SHA-256 token hash. Creation returns the raw token once. Links expire after seven days and can be accepted once. The invitation preview exposes only community identity, offered role labels and expiration.

New links use exactly ten case-sensitive characters from `A-Z`, `a-z`, `0-9`, `_` and `-`. Each character uses six bits from cryptographically random bytes, for 60 bits per token. Creation checks the hash index within the insertion transaction and retries up to five candidates. A collision with any stored invitation, including an expired or revoked one, never replaces or aliases that invitation. Exhausted retries fail without creating an invitation or audit entry.

Existing 64-character lowercase hexadecimal links remain valid until expiry, revocation or acceptance. This is an additive rollout with no token migration, feature flag or new analytics event. Deploy the backend and updated web client together: `getInvitation` and `acceptStaffInvitation` are now actions, and the browser calls both with `useAction`. Preview runs on load, after sign-in and on explicit retry. Acceptance always revalidates the current invitation and permissions regardless of a previously displayed preview.

Both public actions reserve attempt quota in an internal mutation before lookup or acceptance. The reservation commits independently, so malformed tokens and failed acceptance transactions still consume quota. Preview and acceptance share 30 attempts per registered account per minute across all tokens and communities. Anonymous callers, including identities without a provisioned account, share 60 attempts per minute across both actions. Anonymous traffic cannot exhaust a registered recipient's allowance. Convex calls do not expose a trustworthy client IP, so this anonymous limit is shared across visitors rather than per IP. It can temporarily block anonymous preview during abuse; signing in uses the recipient's separate allowance.

Quota exhaustion returns `STAFF_INVITATION_RATE_LIMITED` with `retryAfterMs`. Windows reset 60 seconds after their first attempt. `staffInvitationRateLimits` stores only account-scoped keys or the anonymous key, counts and reset deadlines, never tokens or community slugs. A ten-minute sweep deletes expired counters in bounded batches. The lookup query and acceptance mutation are internal, preventing direct public calls from bypassing the limiter.

Acceptance requires an active browser session and revalidates the inviter's current authority in the same transaction as all role grants. Deleted roles, lost delegation, expired or revoked invitations, self-acceptance, owner acceptance and an already-held offered role reject the whole acceptance. No partial grants are made.

Invitation routes sit outside the protected workspace route group so a recipient can sign in before becoming staff. Analytics URL sanitization redacts the token from page URLs, persisted person properties and replay navigation records.

## Data visibility

Each category has a public, staff or owner audience. A staff audience can include all staff or selected roles. Individual membership history cannot be public. The default is all staff for aggregate categories and owner-only for individual membership history.

Category saves compare the owner's displayed setting with the current value and reject stale updates, including edits made after another owner tab removes staff access.

Until a visibility row exists, existing integration publication flags supply the corresponding public settings. The first category edit preserves those settings for untouched categories. Backend projections enforce visibility; navigation and hidden controls are not authorization boundaries.

The public projection continues to suppress telemetry after disconnect. Permanent retention does not make retained data public and does not bypass connection-epoch filtering.

Recap visibility alone permits published, same-community event recaps. Owners and staff with `manage_events` can also read unpublished recaps when they have recap visibility. The compatibility `getPrivateDashboard` query returns event labels and rollups, with independent membership-field visibility. Association records and unpublished event-picker context additionally require ownership or `manage_events`. Its association projection includes only record, event and session IDs, state and confidence, never actor subjects or audit metadata. Manual association reads and writes require both `manage_events` and recap visibility.

`migrations.runBackfillClubDataVisibility` is the explicit migration runner. It fills missing visibility documents from the legacy settings and leaves existing documents unchanged. It is intentionally absent from `runAll`. Deploying the additive schema is not evidence that the migration ran; verify the intended deployment and migration outcome before removing legacy fields or fallback reads. The owner-only `setPublicMetric` compatibility entry point updates category visibility during this transition.

## Routes

The account page links owned community profiles to their workspace and lists clubs where the signed-in person has active staff access. Revoked assignments and deleted roles do not provide discovery or workspace access. Staff discovery returns a bounded list with an explicit truncation indicator.

- `/account/communities/[slug]`: workspace home using existing telemetry content.
- `/account/communities/[slug]/staff`: assignments, invitations and owner role editing.
- `/account/communities/[slug]/visibility`: owner category controls.
- `/account/communities/[slug]/connection`: connection management.
- `/account/communities/[slug]/invite/[token]`: invitation preview and acceptance.
- `/account/communities/[slug]/telemetry`: compatibility redirect to workspace home.

Local implementation and test fixtures do not prove a deployed Clerk-to-Convex invitation flow. Release verification must distinguish fixture rendering, backend authorization tests and an authenticated end-to-end test against the intended deployment.
