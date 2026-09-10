# Club management: VRChat permissions and action research

Research date: 2026-09-09. Status: source-backed capability research and current recommendations. No authenticated requests, credentials, provider writes, or application changes. This extends the analytics research into the separately requested member-management screen and bot actions.

## Findings

VRChat exposes a usable set of group-management operations in the community API specification: member lookup, join requests, invitations, removals, bans, role assignment/editing, posts, and instance creation/closure. The bot can be an ordinary group member with explicit permissions; ownership is not the minimum for these routine features. However, most endpoint pages do not specify the complete authorization predicate. The matrix below is a candidate minimum role configuration, not a claim of successful live execution.

Three identities must stay distinct: the VRDex staff member requesting the action, the VRChat service account executing it, and the target member. Analytics access must not automatically grant management powers.

## Evidence levels

- The [official VRChat Groups page](https://wiki.vrchat.com/wiki/Groups) describes UI permissions and their dependencies. It identifies itself as reviewed official information.
- The [community-maintained permission enum](https://raw.githubusercontent.com/vrchatapi/specification/main/openapi/components/schemas/GroupPermissions.yaml) supplies machine keys. It is source code for the unofficial specification, not a first-party stable API contract.
- Endpoint references below establish methods, paths, request shapes, and documented responses. An undocumented permission condition, role restriction, or failure remains UNKNOWN until a bounded proof.

## Capability matrix

All group-relative paths below begin `/groups/{groupId}`. Permission mapping combines the official UI descriptions with the community enum. A plus sign means a dependency/additional grant, not an alternative.

| Capability | Documented endpoint | Candidate minimum bot permission | Confidence and detail |
| --- | --- | --- | --- |
| Member directory | [GET `/members`](https://vrchat.community/reference/get-group-members) | `group-members-viewall`; add `group-members-manage` for management sorting/filtering | UI-derived. Directory excludes caller; merge its `myMember` separately. |
| Search members | [GET `/members/search`](https://vrchat.community/reference/search-group-members) | `group-members-viewall` + candidate `group-members-manage` | Exact minimum UNKNOWN. Search is display-name based; query minimum three characters, page maximum 100. |
| Member detail | [GET `/members/{userId}`](https://vrchat.community/reference/get-group-member) | Candidate `group-members-viewall`; `group-members-manage` for management data | Exact field visibility UNKNOWN. Do not assume all returned management fields belong in analytics. |
| Audit history | [GET `/auditLogs`](https://vrchat.community/reference/get-group-audit-logs) | `group-audit-view` | UI-derived. Independent of permission to perform the logged action. |
| List requests | [GET `/requests`](https://vrchat.community/reference/get-group-requests) | `group-invites-manage` | UI-derived; verify read behavior with the intended role. |
| Accept/deny join request | [PUT `/requests/{userId}`](https://vrchat.community/reference/respond-group-join-request) | `group-invites-manage` | API documents accept/deny; accept example uses `action: accept`. Exact block-request payload not verified. |
| List/send/cancel invitations | [GET `/invites`](https://vrchat.community/reference/get-group-invites), [POST `/invites`](https://vrchat.community/reference/create-group-invite), [DELETE `/invites/{userId}`](https://vrchat.community/reference/delete-group-invite) | `group-invites-manage` | Invite body identifies user. Sending an invitation does not accept it for the recipient. |
| Remove group member | [DELETE `/members/{userId}`](https://vrchat.community/reference/kick-group-member) | `group-members-remove` + `group-members-manage` | Endpoint explicitly names Remove Group Members; dependency comes from official UI. This removes group membership, not merely presence in one instance. |
| Ban/unban and ban list | [POST `/bans`](https://vrchat.community/reference/ban-group-member), [DELETE `/bans/{userId}`](https://vrchat.community/reference/unban-group-member) | `group-bans-manage` + `group-members-manage` | UI-derived; verify effects for current members and nonmembers. Do not treat unban as automatic rejoin. |
| Assign/remove a member's role | [PUT](https://vrchat.community/reference/add-group-member-role) / [DELETE](https://vrchat.community/reference/remove-group-member-role) `/members/{userId}/roles/{groupRoleId}` | `group-roles-assign` + `group-members-manage` | UI-derived. Assignment is a distinct permission from editing role definitions. |
| Create/edit/delete role | [POST `/roles`](https://vrchat.community/reference/create-group-role), [PUT](https://vrchat.community/reference/update-group-role) / [DELETE](https://vrchat.community/reference/delete-group-role) `/roles/{groupRoleId}` | `group-roles-manage` | UI-derived. Grantable permissions, management roles, and target restrictions need validation. |
| Edit Everyone permissions | Same role-edit family | `group-default-role-manage` + `group-roles-manage` | Separate high-impact capability. Do not bundle into routine member operations. |
| Publish announcements as posts | [POST `/posts`](https://vrchat.community/reference/add-group-post) | Candidate `group-announcement-manage` | Payload includes title/text, visibility, and `sendNotification`; exact permission and limits need proof. |
| Create public group instance | [POST `/instances`](https://vrchat.community/reference/create-instance), absolute path | `group-instance-public-create` | UI-derived. Private groups cannot create public instances. |
| Create Group+ instance | Same instance-create endpoint | `group-instance-plus-create` | UI-derived. |
| Create members-only instance | Same instance-create endpoint | Candidate `group-instance-open-create` | UI-to-key mapping inferred; confirm against live permission catalog help text. |
| Restrict members-only instance by role | Same instance-create family | Candidate `group-instance-restricted-create` + `group-instance-open-create` | Inferred key mapping plus official dependency. |
| Add age restriction / calendar link | Same instance-create family | `group-instance-age-gated-create` / `group-instance-calendar-link`, in addition to base creation permission | UI-derived; selected instance options add requirements. |
| Close group instance | [DELETE `/instances/{worldId}:{instanceId}`](https://vrchat.community/reference/close-instance), absolute path | `group-instance-manage` | Explicit endpoint authorization for group-owned instances. Personal instances may instead be closed by their owner. |
| Live in-instance moderation | No corresponding remote warn/mute/kick route established here | `group-instance-moderate` exists | Permission existence is not proof of a remote management endpoint. Keep separate from group remove/ban and from closing an instance. |

The dependencies for role assignment, bans, member removal, and Everyone editing are documented in the [official permission table](https://wiki.vrchat.com/wiki/Groups). Do not request `*` as a convenience. Unknown minima should be tested with a purpose-built role, not resolved by permanently granting every permission.

## Discovering actual bot capability

[GET `/groups/{groupId}/permissions`](https://vrchat.community/reference/get-group-permissions) returns the available permission catalog, not a statement that the caller possesses every listed permission. Its [schema](https://raw.githubusercontent.com/vrchatapi/specification/main/openapi/components/schemas/GroupPermission.yaml) includes `allowedToAdd`, `dependsOn`, machine name, display name, help text, and management classification. `allowedToAdd` means the caller may add that permission to a role; it is not the same fact as the bot holding the permission itself.

The [GroupMyMember schema](https://raw.githubusercontent.com/vrchatapi/specification/main/openapi/components/schemas/GroupMyMember.yaml) exposes the bot's own permissions, role IDs, membership status, and `has2FA`. The [role schema](https://raw.githubusercontent.com/vrchatapi/specification/main/openapi/components/schemas/GroupRole.yaml) includes `requiresTwoFactor`, self-assignment, automatic-on-join, management classification, default-role flag, order, and purchase requirements.

Current recommendation: onboarding compares the selected VRDex features with refreshed own-member grants and catalog metadata, then shows missing permissions per capability. Perform a fresh authorization check before writes. Revoke a capability when its grants disappear, without disabling unrelated analytics. Role names such as Admin are not authorization evidence.

The official page says 2FA-gated roles only apply permissions to members meeting that requirement. It also protects owner permissions and the Everyone role. The inspected sources do **not** establish a Discord-style numeric hierarchy rule for editing or assigning higher roles. An `order` field alone does not prove such a rule. Test management-role assignment, roles with permissions the bot lacks, self-role changes, and protected targets before exposing them. [Official roles](https://wiki.vrchat.com/wiki/Groups), [role schema](https://raw.githubusercontent.com/vrchatapi/specification/main/openapi/components/schemas/GroupRole.yaml)

## Important action semantics

**Announcements:** the [legacy POST `/announcement` endpoint](https://vrchat.community/reference/create-group-announcement) warns that it removes existing announcements and directs callers to posts instead. Use the modern post family for a new composer. The [post response](https://vrchat.community/reference/add-group-post) exposes author/editor IDs. Notification delivery should be an explicit composer choice, separately previewed from saving/publishing content.

**Instance closure:** the [close reference](https://vrchat.community/reference/close-instance) supports a future `closedAt` and `hardClose`, default false. Its description defines closedAt as preventing subsequent joins. Do not label normal closure as kicking all current occupants or final instance destruction. Hard-close effects need their own proof and confirmation copy. Re-closing an already closed instance can return 403, so not every 403 means a missing grant.

**Invitations:** a manager sends or cancels another user's invitation; the recipient joins as themselves. The [join endpoint](https://vrchat.community/reference/join-group) uses the authenticated account and optionally an invite ID. Bot onboarding may accept an invitation for the bot, but the bot cannot use its session to accept an invitation as a human recipient.

**Ownership:** [transfer initiation](https://vrchat.community/reference/initiate-or-accept-group-transfer) explicitly requires authentication as current owner; acceptance requires the targeted recipient. A management role does not substitute. Keep transfer outside routine bot permissions. The [delete-group endpoint](https://vrchat.community/reference/delete-group) exists but the inspected page does not establish its complete authorization requirements. Exclude deletion from routine club management until separately scoped; do not claim an unverified owner-only predicate as fact.

## Actor attribution and execution design

The [audit entry schema](https://raw.githubusercontent.com/vrchatapi/specification/main/openapi/components/schemas/GroupAuditLogEntry.yaml) records actor, target, event type, ID, and time. Inference: when a shared bot performs a provider action, upstream account attribution identifies the bot, not automatically the human who clicked VRDex. No impersonation field was established by these action references.

Current recommendation: retain a private VRDex action record containing requesting staff ID, executing service-account reference, immutable group/target IDs, requested operation, time, result, and correlated provider audit ID where available. Display the requester and bot actor separately. A provider audit row is valuable corroboration, but its delay or absence cannot prove a timed-out write failed.

Permission to use an action is the intersection of the human's VRDex capability, connected group's feature enablement, and the bot's current provider grant. Giving the bot ban permission must not give every analytics viewer ban permission. Role changes must not allow a user to escalate their own VRDex authority indirectly.

## Limits, failures, and proof checklist

Member listing supports maximum 100 per page; search additionally requires a three-character query. Pagination is not a point-in-time snapshot. [Member list](https://vrchat.community/reference/get-group-members), [search](https://vrchat.community/reference/search-group-members)

The action references document combinations of 400, 401, 403, and 404, but their lists/examples are not exhaustive. For example, canceling a nonexistent invitation can return 400. Treat already-changed state separately from insufficient permission; refresh the target before offering a retry. [Cancel invite](https://vrchat.community/reference/delete-group-invite)

VRChat requires identifying User-Agent, caching, metering, randomized polling, and error backoff. No stable numeric write quota or general mutation-idempotency guarantee was established. Its guidelines also retain restrictions on credentials and acting from a different device/IP; expanded write scope is not a new provider exemption. [Creator Guidelines](https://hello.vrchat.com/creator-guidelines)

Before enabling writes, perform a separately authorized test-group proof of each chosen permission bundle, dependency, 2FA state, protected target, duplicate/already-completed action, permission revocation, and upstream audit attribution. Use an internal action ID and serialize conflicting actions for the same target. A network timeout after submission is indeterminate: reconcile state before retrying, especially for invitations, posts, and instance creation. Bulk operations require per-target outcomes and bounded concurrency, not a single misleading success banner.

Recommended onboarding bundles for discussion: directory and audit; membership operations; announcements; instance operations; role administration. Each is optional and exposes its actual provider requirements. A single bot can execute multiple bundles if granted them; the product should not require role editing, ownership, or live-instance entry merely to show analytics or approve a join request.

## Follow-up: bulk invitations to running instances

User direction: bulk invitations cover both group membership and running instances. These require separate execution paths and recipient eligibility rules.

| Question | Evidence and disposition |
| --- | --- |
| Membership versus instance route | Membership invitations use the previously documented `/groups/{groupId}/invites`. Instance invitations use [POST `/invite/{userId}`](https://vrchat.community/reference/invite-user), with a target instance and optional message slot. No separate group-instance bulk-invite route was established in the inspected specification. |
| Friendship requirement | The instance-invite reference documents 403 when the sender and recipient are not friends. Plan eligibility around friendship with the **executing bot account**, not friendship with the VRDex staff requester. Group membership alone does not prove eligibility. No group-role exemption was established. |
| Sender location or ownership | The request explicitly supplies an instance identifier, but the reference does not establish whether the sender must occupy, own, or merely access that instance. Therefore sending while the bot has no running VRChat client remains UNKNOWN, not impossible and not proved. Test bot-created and staff-created instances separately. |
| Self invite | [POST `/invite/myself/to/{worldId}:{instanceId}`](https://vrchat.community/reference/invite-myself-to) invites the authenticated account itself. It is not a way for the bot to send an arbitrary person's self-invite. |
| Offline recipients | Official [2024.3.2 release notes](https://docs.vrchat.com/docs/vrchat-202432) added invites to friends active on the website/mobile app or receiving mobile push notifications. Do not categorically exclude everyone labeled offline. Actual API behavior and totally offline retention/expiry remain unverified. |
| Group access and restrictions | An invitation should not be presented as bypassing membership, role restrictions, bans, age gating, or other entry checks. Exact invite-versus-entry enforcement needs proof. Official release notes explicitly mention an error when accepting an invite request where the requester cannot be invited. [Release notes](https://docs.vrchat.com/docs/vrchat-202432) |
| Capacity | Invite success is not a reserved seat. Whether a full/queued instance accepts invite submissions is UNKNOWN here; the existing instance capacity/queue fields are observations, not delivery guarantees. |
| Meaning of success | The invite endpoint says it returns the sent notification. That supports “sent” or “provider accepted”, not received, read, accepted by the person, or joined. Its generic example misleadingly shows a friend-request notification, so validate actual response shape. [Invite reference](https://vrchat.community/reference/invite-user) |
| Rate limits and bulk | No stable numeric invitation quota, bulk atomicity, delivery receipt, or idempotency guarantee was established. Use bounded per-recipient work and provider backoff; do not copy a guessed “safe invites per minute” figure. |

Current recommendation for recipient selection: resolve immutable user IDs, distinguish bot-friend eligibility from group membership, display unknown eligibility separately, and recheck destination availability and current access before dispatch. Keep membership invitations separate from event-instance invitations even when the same person receives both. Never silently send a friend request to make someone eligible.

For scheduled event invitations, save the intended event/instance association, recipient selection, staff authorization, and send window. At execution, resolve a still-valid running destination; do not substitute another instance without an explicit rule. Skip already-observed occupants when reliable presence is available, record per-recipient outcomes, and expire unsent work when its destination or send window ends. A timeout after submission is indeterminate; avoid automatic repeated notifications unless reconciliation establishes that retry is appropriate. These are proposed VRDex safeguards, not provider guarantees.

Required bounded proof before advertising bot-sent instance invites: bot-friend and nonfriend recipients; group member and guest; members-only, Group+, and public instances; bot-created versus staff-created destinations; sender with no client versus actually present; online, web/mobile, and offline recipients; full, queued, closed, and role-restricted destinations. Verify notification identity and observed arrival separately. This research does not authorize entering instances or sending test invitations.
