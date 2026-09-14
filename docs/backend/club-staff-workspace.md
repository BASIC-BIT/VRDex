# Club staff workspace

## Scope

The club workspace implements slice 1 of the [approved staff and visibility design](../planning/group-instance-analytics/2026-09-10-club-staff-and-visibility-design.md). It adds VRDex staff roles, invitation links and category visibility to the existing telemetry system. Provider operations and the Recharts dashboard remain later slices.

## Authority

Ownership remains in `profileOwners`. The owner is not a staff role. Active `communityRoles` define capabilities and explicit assignable role sets; active `communityAuthorities` join a person to one or more roles. Capabilities combine across assigned roles. Only the owner edits role definitions and category visibility.

Delegated staff management requires `manage_staff` and an explicit assignable role set. Starter roles have empty assignable sets. Removing a role revokes its assignments and removes references from delegation and visibility settings. A selected-role audience with no remaining roles becomes owner-only.

Legacy capability grants remain readable during this additive transition. Do not remove the legacy schema fields based on assumptions about deployed data. Inventory and migration verification are separate release work.

The initial implementation bounds roles and assignments: at most 100 active roles per club, 100 assignments per recipient and 500 active assignments per club. Invitation acceptance checks the resulting totals transactionally. An already-oversized legacy roster returns a bounded list with a truncation indicator so the owner can revoke assignments; role deletion requires reducing that roster first. These are implementation limits, not membership limits for the connected VRChat group.

## Invitations

`communityStaffInvitations` stores a SHA-256 token hash. Creation returns the raw token once. Links expire after seven days and can be accepted once. The invitation preview exposes only community identity, offered role labels and expiration.

Acceptance requires an active browser session and revalidates the inviter's current authority in the same transaction as all role grants. Deleted roles, lost delegation, expired or revoked invitations, self-acceptance, owner acceptance and an already-held offered role reject the whole acceptance. No partial grants are made.

Invitation routes sit outside the protected workspace route group so a recipient can sign in before becoming staff. Analytics URL sanitization redacts the token from page URLs, persisted person properties and replay navigation records.

## Data visibility

Each category has a public, staff or owner audience. A staff audience can include all staff or selected roles. Individual membership history cannot be public. The default is all staff for aggregate categories and owner-only for individual membership history.

Until a visibility row exists, existing integration publication flags supply the corresponding public settings. The first category edit preserves those settings for untouched categories. Backend projections enforce visibility; navigation and hidden controls are not authorization boundaries.

The public projection continues to suppress telemetry after disconnect. Permanent retention does not make retained data public and does not bypass connection-epoch filtering.

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
