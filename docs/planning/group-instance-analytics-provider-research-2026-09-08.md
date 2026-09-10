# Group and instance analytics: provider research

Research date: 2026-09-08. Status: research findings and candidate directions, not a new implementation contract. No authenticated provider calls, account changes, or production checks were performed.

## Existing boundary

The [existing planning contract](community-group-telemetry.md) and [backend documentation](../backend/community-group-telemetry.md) already cover aggregate group membership counts, visible instances, population history, player-hours, world distribution, coverage, and event recaps. They explicitly exclude person-level presence. Gross membership events and provider creation events are the meaningful extensions researched here. These documents disagree about the activation gate: planning still describes provider approval as a prerequisite while backend records BASIC's July 27 risk acceptance. Neither is evidence of current runtime health or provider approval.

## Source quality

VRChat's own [Creator Guidelines](https://hello.vrchat.com/creator-guidelines) are authoritative for the provider's published operating posture. They describe API access as unsupported and changeable, require an identifying User-Agent, metered requests, caching, jittered polling, and error backoff, and prohibit asking for or storing users' credentials/session data. They also warn against account requests originating away from the user's device/IP. The page still says no OAuth is offered for this context. A VRDex-owned account and an owner risk decision do not constitute a published provider exemption.

The [vrchatapi specification](https://github.com/vrchatapi/specification) and its [rendered reference](https://vrchat.community/) are community-maintained source specifications, not a VRChat API guarantee. VRChat links to this unofficial documentation in its guidelines. Field existence establishes a research lead; actual account visibility, semantics, and completeness require a bounded proof.

## Requested metrics and what the sources establish

| Requested capability | Evidence | Product interpretation and remaining proof |
| --- | --- | --- |
| Total group members | Group schema has `memberCount` and `memberCountSyncedAt`. [Schema](https://raw.githubusercontent.com/vrchatapi/specification/main/openapi/components/schemas/Group.yaml) | Capture both source synchronization time and observation time. A count series gives net growth, not gross joins and departures. |
| Current instances and population per instance | Group-instance endpoint returns `instanceId`, `location`, `memberCount`, and world metadata; it documents an authentication cookie and a membership-related 403. [Reference](https://vrchat.community/reference/get-group-instances) | Promise visible observed instances. The reference does not establish whether `memberCount` means all occupants or only members of the owning group, nor complete visibility across role-restricted instances. Validate both explicitly. |
| Number of instances created | Current-instance enumeration is a snapshot, not a creation ledger. Audit endpoints expose timestamped events, and independent tools consume instance lifecycle events. [Audit reference](https://vrchat.community/reference/get-group-audit-logs), [Scarlet source project](https://github.com/SybylineNetwork/Scarlet) | Keep first observed sessions separate from provider creation events. Polling can miss an instance entirely. Creation can precede population, and disappearance is not proof of destruction. Audit creation counting is promising but needs exact event/payload confirmation. |
| People in each instance | Instance detail has a `users` field, but the source schema specifically limits its presence to instances created by the requesting user. [Instance schema](https://raw.githubusercontent.com/vrchatapi/specification/main/openapi/components/schemas/Instance.yaml) | A generic group collector cannot promise a full named roster across every group instance. Aggregate counts and named attendance are separate capabilities. |
| Group joins and leaves | Audit search supports event-type/date filters and returns event IDs and timestamps. LogDog's own product documents join/leave capture, independently demonstrating this implementation pattern. [Audit reference](https://vrchat.community/reference/get-group-audit-logs), [LogDog product](https://logdog.gg/) | Add a separate audit-derived membership event stream after proving exact types and removal semantics. Never infer gross joins/leaves by positive/negative member-count changes. |
| Kicks, bans, warns | VRChat itself announced group-instance warns and kicks in group audit logs. [Developer update](https://ask.vrchat.com/t/developer-update-11-april-2024/23928) | Instance kick, removal from group membership, and group ban must be distinct. Do not assume a ban always decreases membership or that removal produces exactly one event. |

“Members in each instance” therefore has three possible meanings: total occupants, occupants who belong to the group, or individual people. The current group-instance field name does not settle those semantics.

## Audit collection and historical backfill

The [audit endpoint](https://vrchat.community/reference/get-group-audit-logs) exposes `n` (1 to 100, default 60), offset, start/end dates, actors, event types, and targets. Its response contains `hasNext`, `totalCount`, and entries with ID, timestamp, actor, target, type, and data. This supports bounded historical paging, but the inspected contract does not promise retention duration, stable ordering, snapshot isolation, delivery latency, or complete history.

The [audit type endpoint](https://vrchat.community/reference/get-group-audit-log-entry-types) lists types for which the selected group has entries. The [type schema](https://raw.githubusercontent.com/vrchatapi/specification/main/openapi/components/schemas/GroupAuditLogEntryType.yaml) is a string, not an exhaustive enum. An absent type is not evidence that the feature is unsupported globally or that the true count is zero.

LogDog's [own FAQ](https://logdog.gg/faq) reports approximately 30 days of upstream audit retention. This is a competing implementer's claim, not a first-party VRChat retention promise. Treat the real horizon as UNKNOWN until observed or authoritatively confirmed; do not sell lifetime backfill.

Current recommendation: query overlapping bounded time windows, deduplicate by provider audit ID, commit a cursor only after complete pagination, retain an explicit backfill boundary, and periodically reconcile membership totals. Record ingestion lag and unknown event types. A successful page is not proof that the whole interval is complete. Store aggregate event facts, avoiding persistence of raw actor names, target identities, and unrestricted `data` unless separately justified.

## Additional useful metrics

These are candidate product metrics, not claims of existing implementation or provider completeness.

| Candidate | Inputs and value | Caveat |
| --- | --- | --- |
| Busy hours and weekday patterns | Existing population observations show when to schedule events or staffing. | Use coverage-qualified averages; missing intervals cannot count as empty. |
| Peak and typical instance size | Existing population series show whether activity spreads across instances or concentrates. | Compare equal windows and display observed coverage. |
| Player-hours and active instance-hours | Integrate occupancy or observed instance availability over covered intervals. | Neither is unique visitors or average personal visit duration. |
| Created versus actually populated | Audit creation plus snapshots can distinguish setup from observed use. | An unobserved instance may have been busy during a gap; never label it unused without adequate coverage. |
| Event recap and recurring-event comparison | Associate known event windows and instance locations. | Joining the group near an event is correlation, not proven event conversion. |
| Membership acquisition and departures | Audit-derived joins, voluntary leaves, and administrative removals. | Gross-flow semantics need controlled validation; count deltas are only reconciliation evidence. |
| Queue pressure and capacity utilization | Instance detail schema has `queueEnabled`, `queueSize`, `capacity`, `recommendedCapacity`, `full`, and population. [Schema](https://raw.githubusercontent.com/vrchatapi/specification/main/openapi/components/schemas/Instance.yaml) | Requires extra detail calls and field-semantic validation. Queue size is not a number of unique rejected visitors. |
| Region, access type, and platform mix | Instance detail has region, group access type, and platform counts. [Reference](https://vrchat.community/reference/get-instance) | Platform is client platform, not VR-versus-desktop or headset identity. Instance server region is not the visitor's home country. |
| Event-link hints | Nullable `calendarEntryId` exists in instance detail. [Schema](https://raw.githubusercontent.com/vrchatapi/specification/main/openapi/components/schemas/Instance.yaml) | Candidate evidence for association, not a reason to remove manual confirmation before visibility behavior is proved. |
| Moderation workload | Counts of confirmed audit action classes per day/event. | Operational workload only; avoid interpreting counts as community quality or staff effectiveness. |
| Data health | Source age, polling coverage, audit lag, backfill horizon, count reconciliation difference. | Keep unavailable distinct from zero. |

Online-member count also exists in the [group schema](https://raw.githubusercontent.com/vrchatapi/specification/main/openapi/components/schemas/Group.yaml), but completeness and privacy filtering are unspecified in the inspected source. It is a lower-priority proof candidate.

Unique attendees, return-visitor rate, personal dwell time, member-versus-guest attendance, and attendee-to-member conversion require identity-bearing longitudinal observations. None follows from aggregate occupancy. Scarlet's [README](https://github.com/SybylineNetwork/Scarlet) explicitly separates extended local-client observations from canonical audit events and explains that some need a running VRChat client in the instance. Client observations therefore cannot establish unattended coverage of every group instance.

## Bounded proof recommended before an implementation contract

1. With a separately authorized test group/account, compare visible instances under ordinary membership and the minimum relevant group role, including restricted, empty, and populated instances.
2. Compare group-instance `memberCount` against detail population with a known mix of group members and guests. Check latency and hidden/blocked-user effects without persisting identities.
3. Observe one controlled join, voluntary leave, membership kick, ban of a member, and ban of a nonmember. Establish emitted types and whether multiple events describe the same membership transition.
4. Observe creation, first occupancy, manual closure, and ordinary empty disappearance. Validate event correlation keys and whether closure is a user action or actual session termination.
5. Page a historical audit interval, then repeat it with overlap. Establish observed horizon, sort behavior, duplication, latency, and permission-loss handling.
6. Verify the extra detail fields on representative instances before budgeting an additional request per active instance.

The first product decision should be whether the requested instance membership view means counts or named people. The second is whether an audit-read role is acceptable onboarding for gross membership/lifecycle analytics. Both change scope substantially; aggregate polling alone cannot meet every interpretation of “full analytics.”

## Follow-up: named attendance and member/guest segmentation

User direction, 2026-09-08: the intended design includes counts, named attendance history, member-versus-guest segmentation, an analytics UI, and onboarding the VRDex bot into each VRChat group. This section establishes collection choices for that broader goal. It does not authorize a bot entering instances or creating them.

### Joining a group is not observing every instance

A service account's group membership enables group-scoped API access according to its permissions. It does not establish that its VRChat client is running in an instance. The [Instance source schema](https://raw.githubusercontent.com/vrchatapi/specification/main/openapi/components/schemas/Instance.yaml) documents `users` as present for instances created by the requesting user. It does not say that group ownership, staff permissions, or merely joining the group grants that roster for instances created by someone else. Group-instance enumeration has no roster in its documented response. Therefore unattended named coverage across arbitrary existing group instances remains UNKNOWN and unsupported by the inspected contract.

### Three collection alternatives

| Candidate model | Evidence and possible scope | Limitation or necessary change |
| --- | --- | --- |
| API rosters for VRDex-created instances | The instance schema describes creator-account roster access. Polling these rosters could produce observed attendance intervals without a client sitting inside. | Requires an instance-creation workflow, appropriate creation permissions, and proof that group-owned instance behavior matches the description. Does not cover unrelated staff-created instances by assumption. Sampling misses short visits and gives approximate join/leave times. |
| Authorized staff companion or submitted client observations | VRChat's [completed user-ID log feature](https://feedback.vrchat.com/feature-requests/p/provide-userids-in-output-logs) confirms join/leave log entries include user IDs. [Scarlet](https://github.com/SybylineNetwork/Scarlet) documents that extended events require a local client in the group instance. | A source observes only where and when its client is present. Multiple observers need deduplication and coverage tracking. This is a new client-contributed data family, separate from existing cloud aggregate polling. |
| Dedicated in-instance observer clients | The same client-log mechanism is a plausible technical basis. | Requires operating clients, intentional entry, resource budgets, lifecycle coordination, and a separate provider/operational assessment. Group bot onboarding alone is not permission for this. No unattended fleet feasibility was proved here. |

Current recommendation: test creator-scoped API roster access first because it could avoid the operational burden of observer clients. Keep a separately approved companion option for staff-created instances. Present named coverage per instance/source, never a silent promise of universal coverage.

World instrumentation is an additional research branch, not a shortcut established by these sources. Official [Player API](https://creators.vrchat.com/worlds/udon/players/) supports local-instance display names and player join/leave events. Official [Getting Players](https://creators.vrchat.com/worlds/udon/players/getting-players/) describes integer network player IDs, not immutable account IDs. This alone does not establish secure identity linkage, export transport, or coverage in arbitrary worlds. Do not equate an Udon player ID with a `usr_` account identifier.

### Member-versus-guest classification

The [member-list reference](https://vrchat.community/reference/get-group-members) pages at up to 100 entries, permits join-date sorting and role filtering, and explicitly excludes the requesting account. Its own membership is in `Group.myMember`. The [member schema](https://raw.githubusercontent.com/vrchatapi/specification/main/openapi/components/schemas/GroupMember.yaml) includes immutable user ID, membership status, and joined time, and can be null for a nonmember. [Statuses](https://raw.githubusercontent.com/vrchatapi/specification/main/openapi/components/schemas/GroupMemberStatus.yaml) distinguish `member` from invited, requested, banned, inactive, and userblocked.

Candidate implementation: classify observed attendee IDs against a timestamped membership snapshot plus validated membership audit changes. Use member, guest, and unknown. An incomplete page scan, stale snapshot, permission failure, or ambiguous response must produce unknown rather than guest. Do not classify “represents group” as membership: the schema explicitly defines representation as the group shown above an in-game name tag.

Historical segmentation must use membership at attendance time. Today's roster cannot establish whether a past attendee was a member then, and `joinedAt` alone cannot reconstruct leave/rejoin intervals. Membership events and roster reconciliations need their own coverage timeline. Full-roster visibility under hidden memberships, blocked accounts, and the proposed bot role remains a proof requirement. Avoid repeated per-attendee calls when a permitted, cached group roster can serve the same purpose.

For onboarding design, report independently: group joined, aggregate visibility verified, audit access verified, membership lookup verified, and named-attendance source connected. The first four states do not imply the fifth. A later permission loss should degrade only the affected metrics and preserve honest coverage gaps.
