# Club staff roles and data visibility design

## Status

Approved design, 2026-09-10. This is slice 1 of the club analytics and management program described in [the discovery doc](../group-instance-analytics-discovery-2026-09-08.md). It also carries the slice 0 prerequisite. Terms follow [the glossary](CONTEXT.md). An implementation plan follows this spec; nothing here authorizes provider writes, collector changes or deployment.

Slice order accepted by BASIC on 2026-09-10:

0. Stop raw telemetry compaction deleting observations (prerequisite, in this spec).
1. Club shell, staff roles, delegated invitations, data visibility (this spec).
2. Analytics dashboard v2 on Recharts.
3. Membership events from the group audit log.
4. Group connection v2.
5. Member management.
6. Posts.
7. Instance operations.
8. Scheduled actions, bulk invitations, notifications.

## Goals

- Give a club owner VRDex-managed staff roles with editable presets, custom roles, multiple roles per person, and delegated invitations bounded by an explicit assignable set.
- Give the owner one table that decides who can read each analytics category: public, selected staff roles, or owner only.
- Put both behind a club shell at the community root so later slices add pages without moving anything.
- Make one authorization helper the single gate for web pages, the public projection, and later API and MCP responses.

## Out of scope

- Any VRChat group action, provider permission check, or member management.
- Analytics content changes. Home shows today's dashboard content unchanged.
- API or MCP reads for staff. The public projection is the only non-web surface affected.
- Ownership transfer, deletion workflows, role hierarchy, per-person permission overrides.
- Personal home layout customization. That ships with slice 2.

## Slice 0: permanent retention

The daily cron `community telemetry raw compaction` deletes exact population and instance observations older than 90 days once their hourly rollup exists. BASIC decided on permanent retention (discovery Q12). Slice 0:

- Removes the cron registration and the compaction functions and their tests.
- Adds one backend test proving that a rollup pass leaves raw observations older than 90 days in place.
- Updates the three telemetry docs (planning contract, backend, public) to state that observations, rollups and coverage are retained until deletion is requested, and removes the 90-day and 18-month statements. No other age-based deletion exists in code.

Slice 0 ships as its own PR before slice 1.

## Permissions

One validator, `clubPermission`, replaces `communityCapability`. Values and their state at the end of slice 1:

| Permission | Label in editor | Gates | Available in slice 1 |
| --- | --- | --- | --- |
| `edit_community_profile` | Edit community profile | existing profile and short-link mutations | yes |
| `manage_events` | Manage events | existing events mutations | yes |
| `manage_event_media` | Manage event media | existing events mutations | yes |
| `view_event_operations` | View event operations | existing events queries | yes |
| `manage_staff` | Invite VRDex staff | minting invitations and revoking assignments within the assignable set | yes |
| `manage_integrations` | Manage group connection | connect, disconnect, connection page | yes |
| `approve_join_requests` | Approve join requests | slice 5 | no |
| `invite_group_members` | Invite group members | slice 5 | no |
| `assign_vrchat_roles` | Assign permitted VRChat roles | slice 5 | no |
| `remove_group_members` | Remove group members | slice 5 | no |
| `manage_bans` | Ban and unban | slice 5 | no |
| `publish_posts` | Publish posts | slice 6 | no |
| `manage_instances` | Create and close instances | slice 7 | no |
| `manage_scheduled_actions` | Manage scheduled actions | slice 8 | no |
| `export_analytics` | Export analytics | slice 2 or later | no |

The unused values `manage_profile`, `manage_roster` and `manage_billing` are removed, along with the alias table in the authority helper. Tests that seed them are updated.

Unavailable permissions appear in the role editor with a "Not yet available" marker, can be checked, and are stored, so presets and saved roles do not shift when later slices land. No code path reads them until the owning slice ships.

Reading analytics is never a permission. The visibility table decides reads.

## Roles

New table `communityRoles`:

- `communityProfileId`, `key` (slug, unique per community), `label`, `description` (optional), `permissions` (array of `clubPermission`), `assignableRoleIds` (array of `communityRoles` ids this role's holders may grant), `presetKey` (optional, one of `admin`, `moderator`, `event_staff`), `state` (`active` or `deleted`), `createdAt`, `updatedAt`.
- Index `by_communityProfileId_state`.

Presets are seeded by a `seedPresetRoles` mutation that the staff page calls when the owner opens it and the community has no roles yet. Nothing is seeded on connect, so communities without staff gain no rows:

| Preset | Permissions | Assignable roles |
| --- | --- | --- |
| Admin | every value in the table above | none |
| Moderator | approve join requests, invite group members, assign VRChat roles, remove group members, ban and unban | none |
| Event Staff | manage events, manage event media, view event operations, publish posts, create and close instances | none |

Assignable sets default to empty. Delegation is inert until the owner grants it, which matches discovery Q5.

Presets are ordinary roles after seeding: the owner can rename, edit, or delete them. `presetKey` only lets the editor show "Started from the Admin preset". A role cannot list itself as assignable.

Deleting a role revokes every active assignment of it, removes it from every other role's assignable set, and removes it from every visibility category's role list. A category whose role list becomes empty by deletion falls back to owner only, and the response names the categories that changed so the page can say so.

Only the owner creates, edits, or deletes roles.

## Assignments

`communityAuthorities` changes shape. The free-form `roleKey`, `roleLabel` and `capabilities` fields go away. Each row is one person holding one role:

- `communityProfileId`, `subjectTokenIdentifier`, `subject`, `roleId`, `state` (`active` or `revoked`), `grantedAt`, `grantedBySubject`, `revokedAt` (optional), `revokedBySubject` (optional), `updatedAt`.
- Indexes `by_communityProfileId_state`, `by_subjectTokenIdentifier_state_communityProfileId`, `by_communityProfileId_roleId_state`.

Nothing outside tests has written this table, so there is no data migration. The two tests that seed it are rewritten against roles.

A person's effective permissions are the union of their active roles' permissions. The owner never holds rows; ownership stays in `profileOwners`.

Rules:

- Nobody changes their own rows. An actor cannot assign a role to themselves or revoke their own assignment, owner included.
- The owner may assign or revoke any role.
- A staff member with `manage_staff` may revoke an assignment only if the assignment's role is in the union of their own roles' assignable sets.
- Rows are never deleted. Revoking writes `revokedAt` and `revokedBySubject`.

## Invitations

New table `communityStaffInvitations`:

- `communityProfileId`, `tokenHash` (SHA-256 of the single-use token), `roleIds` (non-empty array), `createdBySubject`, `createdAt`, `expiresAt` (creation plus seven days), `state` (`pending`, `accepted`, `revoked`, `expired`), `acceptedBySubject` (optional), `acceptedAt` (optional), `revokedAt` (optional), `revokedBySubject` (optional).
- Indexes `by_tokenHash`, `by_communityProfileId_state`.

Minting: the owner, or a staff member with `manage_staff` whose assignable union contains every requested role, calls `createStaffInvitation`. The mutation returns the raw token once; only the hash is stored. The page shows the link `/account/communities/[slug]/invite/[token]` with a copy control.

Accepting: a signed-in user with an active browser session opens the link. `acceptStaffInvitation` verifies the hash, state and expiry, refuses if the user is the community owner or already holds any of the roles, creates one authority row per role with `grantedBySubject` set to the inviter, and marks the invitation accepted. The link is dead afterwards.

Revoking: the owner, or the inviter, or a `manage_staff` holder whose assignable union covers the invitation's roles. Expired invitations are shown as expired by comparing `expiresAt` at read time; no cron.

An invitation's roles are checked again at acceptance. If a role was deleted in between, acceptance fails with a message that the invitation is no longer valid.

## Data visibility

New table `communityDataVisibility`, one document per community. Reads compute the defaults below when no document exists; the document is written on the first edit:

- `communityProfileId`, `categories`, `updatedAt`. Index `by_communityProfileId`.
- `categories` is an object keyed by category, each value `{ audience, staffRoleIds }` where `audience` is `public`, `staff` or `owner`, and `staffRoleIds` is either `null` meaning all staff or a non-empty array of role ids. It is only read when `audience` is `staff`.

Categories and defaults:

| Category key | Label | Public allowed | Default |
| --- | --- | --- | --- |
| `current_population` | Current population | yes | staff, all |
| `population_history` | Population history | yes | staff, all |
| `group_size` | Group size | yes | staff, all |
| `instance_history` | Instance history | yes | staff, all |
| `membership_movement` | Membership movement | yes | staff, all |
| `individual_membership_history` | Individual membership history | no | owner |
| `event_recaps` | Event recaps | yes | staff, all |

Nothing is public by default. The validator rejects `public` for `individual_membership_history` and rejects an empty role array.

Only the owner edits visibility. `setCategoryVisibility` takes one category and its new value and writes an action log entry.

### Migration from `publicMetrics`

`communityVrchatIntegrations.publicMetrics` holds five booleans today. Mapping: `currentPopulation` to `current_population`, `populationHistory` to `population_history`, `groupMemberCount` to `group_size`, `groupMemberGrowth` to `membership_movement`, `eventRecaps` to `event_recaps`. A `true` becomes `audience: "public"`.

Two PRs:

1. Add the table, the migration (defined with the existing `@convex-dev/migrations` runner), and the read helper. The public projection reads the visibility document when it exists and falls back to `publicMetrics` otherwise. `setPublicMetric` is removed and the dashboard's toggles are replaced by the visibility page.
2. After BASIC runs the migration against production, drop `publicMetrics` from the schema and the fallback from the projection. Merging never changes live data here, so the plan states the run step explicitly.

## Authorization helper

New module `convex/_clubAccess.ts` replaces `_communityAuthority.ts`:

- `resolveClubActor(ctx, communityProfileId)` returns one of `{ kind: "owner" }`, `{ kind: "staff", subject, roleIds, permissions }` or `{ kind: "none" }`. Owner detection uses the existing active-browser-session and `userOwnsProfile` path. Staff detection uses `toAuthSubject` and the active authority rows joined to active roles, as today.
- `requireClubPermission(actor, permission)` throws unless the actor is the owner or a staff member holding it.
- `canReadCategory(actor, visibility, category)`: `public` passes anyone including anonymous; `staff` passes the owner and any staff member whose role ids intersect the list, or any staff member when the list is `null`; `owner` passes only the owner.
- `assignableRoleIdsFor(actor, roles)` returns the union for a staff actor and every active role for the owner.

Existing callers in `events.ts`, `_shortLinks.ts` and `communityTelemetry.ts` move to the new helper without behavior change beyond the permission rename. The private dashboard query changes its gate from `manage_integrations` to "actor is owner or staff", then filters each section through `canReadCategory`. The public projection `getPublicCommunityTelemetry` uses `canReadCategory` with an anonymous actor and is the only place public reads are shaped.

Mapping today's dashboard sections to categories: current population and active instances to `current_population`; population chart to `population_history`; member count chart to `group_size`; recent instances and instance history to `instance_history`; event associations and recaps to `event_recaps`. `membership_movement` and `individual_membership_history` have no data yet and gate nothing until slice 3.

## Action log

New table `communityActionLog`: `communityProfileId`, `actorSubject`, `action`, `targetSubject` (optional), `roleId` (optional), `details` (object), `createdAt`. Index `by_communityProfileId_createdAt`. Slice 1 writes role created, updated, deleted; assignment granted, revoked; invitation created, accepted, revoked; visibility changed. Later slices reuse it for provider actions with outcome states. The staff page shows the last 50 entries to the owner.

## Routes and pages

Under `apps/web/src/app/account/communities/[slug]/`:

- `layout.tsx`: the Workspace shell. Left sidebar with the community name, navigation, and a footer showing connection state. Navigation entries are filtered by the resolved actor. Narrow viewports collapse the sidebar into a horizontal scrolling row, as in the approved prototype.
- `page.tsx`: Home. Renders the existing dashboard content, minus the connection form and the public toggles.
- `staff/page.tsx`: Staff and roles. Visible to the owner and to `manage_staff` holders. Sections: club owner row, active staff with roles and revoke controls, pending invitations, invite form, roles list with permission editor, and the action log. Role editing controls render only for the owner; delegates see roles read-only and can invite only within their assignable set.
- `visibility/page.tsx`: Data visibility. Owner only. One row per category with an audience select and, when the audience is staff, a role picker with an "All staff" option, reusing the per-row select pattern from the account privacy panel.
- `connection/page.tsx`: Group connection. Visible to the owner and `manage_integrations` holders. Holds today's connect form and disconnect action.
- `invite/[token]/page.tsx`: shows the community, the roles offered, and an accept control; signed-out visitors are asked to sign in and return.
- `telemetry/page.tsx`: permanent redirect to the community root.

Sidebar order for slice 1: Home, Staff and roles, Data visibility, Group connection. Slice 2 inserts Analytics and Instances after Home.

All pages use the existing page shell, form, select and button components. No new UI dependency.

## Public copy

Every string below is new public-facing prose and needs BASIC's approval before merge, per the repo copy rule. The implementation PR lists any change to this table.

| Where | Text |
| --- | --- |
| Sidebar | Home, Staff and roles, Data visibility, Group connection |
| Staff page, owner row | Ownership is separate from roles. |
| Staff page, empty staff | No staff yet. Invite someone to get started. |
| Staff page, invite form | Invite club staff; Roles; Create invite link; Copy link; This link works once and expires in 7 days. |
| Staff page, roles note | VRDex roles control this dashboard. VRChat group roles are managed separately. |
| Role editor | Not yet available; Roles this role can assign; Started from the Admin preset (and Moderator, Event Staff variants) |
| Role delete confirm | Deleting this role removes it from everyone who holds it. Categories visible only to this role become owner only. |
| Visibility page | Who can see each category; Owner-controlled. Public settings apply to community pages and public APIs.; Public; Selected staff; Owner only; All staff; Not applicable |
| Visibility note | Historical statistics are retained permanently. Disconnecting stops collection. |
| Invite page | You have been invited to join the staff of this club.; Accept invitation; Sign in to accept; This invitation is no longer valid. |
| Access notices | You do not have access to this page. |

## Testing

Backend, with the existing convex-test pattern in `tests/backend/`:

- Permission union across multiple roles; owner passes every permission; `none` actor fails.
- Delegation: a delegate can invite only within the assignable union, cannot invite Admin when not assignable, cannot revoke outside it, cannot touch their own rows; owner cannot be invited.
- Invitation lifecycle: mint, accept, second acceptance fails, expired fails, revoked fails, deleted role fails.
- Role deletion cascades: assignments revoked, assignable sets cleaned, visibility fallback to owner with the changed categories reported.
- Visibility: validator rejects public individual history and empty role arrays; `canReadCategory` for each audience and actor kind; dashboard sections filtered; public projection matches the visibility document and, before migration, the legacy booleans.
- Migration: five booleans map to the expected categories.
- Slice 0: a rollup pass leaves raw observations older than 90 days in place.

Web: one Playwright fixture page under `apps/web/src/app/playwright/club-staff/` exercising the staff page and visibility page with seeded roles, following the community telemetry fixture. One end-to-end test covers invite link creation and acceptance through the fixture.

## Open items for later slices

- Slice 2 defines home layout customization and the Analytics and Instances pages.
- Slice 3 populates `membership_movement` and `individual_membership_history` and must gate the identifiable table through `canReadCategory`.
- API and MCP responses for staff adopt `resolveClubActor` when a slice exposes them; the helper is designed so no second gate is needed.
- Ownership transfer and deletion workflows remain deferred (discovery Q13).
