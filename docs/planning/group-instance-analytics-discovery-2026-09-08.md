# Group and instance analytics discovery

## Status

Research and brainstorming, 2026-09-08. No new product decisions or implementation authorization. This extends the existing community telemetry work rather than introducing a second collector. Provider findings are recorded in [the companion research brief](group-instance-analytics-provider-research-2026-09-08.md). Later sections record locked decisions from the 2026-09-08 and 2026-09-09 interview rounds; those supersede this initial status line.

## Request

BASIC wants full analytics for VRChat groups: instances created, members in each instance, group joins, group leaves, total group membership, and other useful metrics. The phrase "members in each instance" needs a product decision: population counts, identifiable attendees, or the subset of occupants who belong to the group.

## Existing foundation, verified in this checkout

The [telemetry contract](community-group-telemetry.md), [backend documentation](../backend/community-group-telemetry.md), and [public documentation](../public/community-telemetry.md) describe an aggregate implementation. Local history records its addition in commit `beba995cf`, PR #186, on 2026-07-24. The architecture references epic #176.

Source inspected:

- `workers/group-telemetry/vrchat-client.mjs`: reads group metadata and visible group instances, normalizes member count and per-instance population, strips person identifiers. No group audit-log ingestion exists in this adapter.
- `convex/_communityTelemetry.ts`: randomized active and quiet cadence, two-miss session closure, five-minute interpolation limit, six-minute current-data freshness, aggregate metrics.
- `convex/communityTelemetry.ts`: stores snapshots, sessions, membership-count changes, coverage and rollups; private reads and public opt-ins; confirmed event associations.
- `apps/web/src/app/account/communities/[slug]/telemetry/community-telemetry-dashboard.tsx`: 24-hour, 7-day and 30-day views, population and membership charts, recent instances, instance history, world distribution and event associations.

This verifies repository implementation, not current production operation. The GitHub issue read was network-blocked; its current state was not verified. No provider account or production data was accessed.

## Requested metrics and gaps

| Request | Existing support | Extension or semantic gap |
| --- | --- | --- |
| Instances created | Observed instance sessions and active-instance counts | First observation is not creation. A short instance can exist entirely between polls. Reappearance creates another observed session. Use creation audit events if validated, keep distinct from observation sessions. |
| Members in each instance | Aggregate provider `memberCount` per visible instance | This is not an attendee roster or a proven count of group members among occupants. Verify provider semantics before renaming it. |
| Group joins | Net membership growth only | Requires membership events. Positive count changes cannot measure gross joins. |
| Group leaves | Net membership growth only | Requires membership events and a rule for voluntary leaves, kicks, bans and other removals. |
| Total group members | Count observations on change and heartbeat | Provider metadata is cached for five minutes. Counts are observed values, not an exact real-time guarantee. |
| Other reasonable data | Peak concurrency, player-hours, world distribution, coverage and event recaps | Better comparisons and presentation can reuse the aggregate foundation. |

If 40 people join and 35 leave, the member count grows by five. A count chart cannot recover either gross number. If a group-public instance has 60 occupants, that alone cannot establish how many are group members or how many distinct people visited over the evening.

## Candidate approaches

1. **Extend aggregate telemetry with membership and instance lifecycle events.** Current recommendation. Keep existing snapshots, add a bounded audit reader if provider evidence supports it, and produce operator reports combining occupancy, gross membership movement and observed creation events. Provider permissions and audit coverage determine availability.
2. **Improve the existing aggregate dashboard first.** Lowest collection complexity. Better range queries, instance summaries, comparisons and exports can help now, but joins and leaves remain unanswered.
3. **Add identifiable attendance analytics.** Separate design branch. Unique visitors, return visits, dwell time and member-versus-guest segmentation require dependable person-level evidence, a collection mechanism and explicit visibility/retention decisions. They cannot be calculated from aggregate populations.

## Brainstormed operator value

These are candidates, not commitments.

- Group growth: gross joins, voluntary leaves, removals, net change, daily/weekly trends, and reconciliation differences against count snapshots.
- Instance operations: observed creation events, active instances, first/last observation, population curves, observed peak, player-hours, world breakdown, and missing coverage.
- Scheduling: weekday/hour patterns and time to reach an occupancy threshold, anchored to an observed or confirmed start rather than an invented creation time.
- Event reports: manually associate multiple instances, compare population and player-hours with previous editions, show group joins during the event window. Temporal overlap is not proof the event caused those joins.
- Capacity: time above a chosen occupancy threshold; percentage full and queue metrics only after capacity and queue semantics are verified.
- Membership operations: request/approval counts and time to approval, if the source exposes matching events. Do not infer rejection from a missing request.
- Reporting: private CSV/API access with the same authorization as the dashboard, saved ranges, and optional owner-approved public aggregate recaps.
- Optional alerts: stale collection, unusually high departures, or sustained occupancy. Thresholds and delivery need a later decision; this research does not create notifications.

Avoid presenting peak concurrency as unique visitors, player-hours as average visit duration, a net count decline as voluntary leaves, or an observed session as an exact created instance.

## Design checks before promising full analytics

- Define the target as all activity visible to the authorized integration and report its coverage. Neither a successful request nor a blank response proves omniscience.
- Keep snapshot coverage and audit-event coverage separate. Healthy occupancy collection does not prove complete membership history.
- Deduplicate provider events by stable event identity, overlap incremental fetch windows, and explicitly record initial backfill limits and gaps.
- Keep provider event time, collection time and first-observed time distinct.
- Strip unnecessary identities before durable aggregate storage if aggregate membership reporting is selected. Counts can still require processing a personal-data-bearing source.
- Check range completeness. The current private query caps sessions at 100, instance observations at 2,500 and member observations at 500. A crowded group can exhaust the instance-point cap well before a selected range ends. Full-range reports need range-scoped pagination or appropriate rollups.
- Use measured observation time as the denominator for an observed mean population. Do not treat unmeasured time as zero.
- Test disconnect, permission loss, reconnect epochs, late events and duplicate events without losing or double-counting history.

## Documentation discrepancy

The older planning contract says hosted sessions and scale-out await explicit provider approval. The backend, deployment runbook and provider-proof note record BASIC's 2026-07-27 risk acceptance and enabled hosted fleet. Those documents explicitly distinguish owner acceptance from provider approval. Record the discrepancy here rather than resetting an already accepted owner decision or silently rewriting it. Current runtime health and non-empty provider evidence still need separate verification.

## Confirmed scope, 2026-09-08

BASIC answered Q1 with "all of those": aggregate population, identified attendees with attendance history, and group-member versus guest segmentation are all desired capabilities. This supersedes the aggregate-first scope recommendation for this design exercise. Provider feasibility, collection method and rollout sequencing remain unresolved. It does not authorize collecting personal data or deploying collectors.

BASIC also requested the full analytics UI specification and the UI flow for getting VRDex VRChat bots into each group. Interpret "guild" here as VRChat group, with no Discord integration inferred.

The existing dashboard already has a connection form for immutable group ID, visibility and join policy. Extend that existing flow in the design. A service account belonging to a group and a running VRChat client occupying an instance are distinct concepts; the existing worker only does API collection.

BASIC answered Q2 by expanding the design to a club staff system. Owners should control which pieces of information are public, staff-only, or owner-only, following the familiar profile visibility interaction. This replaces the earlier recommendation of a single analytics-read permission as the whole access model. Which data categories support each audience, and whether staff-only means all staff or selected staff roles, remain to be settled.

The existing `communityAuthorities` schema already stores community-scoped role keys, labels, capabilities and active/revoked assignments. `convex/_communityAuthority.ts` is the existing authorization foundation. Extend this community system for clubs rather than introducing a separate club identity or parallel permissions engine. The profile field-visibility interaction is a UI precedent, not evidence that it already supports staff audiences.

Candidate access design: separate a data category's audience from action permissions. Reading analytics does not itself authorize connecting bots, changing visibility, inviting staff, exporting records, or transferring ownership. Owner-only remains exclusive to the singleton owner. If selected roles define staff access, the UI should state exactly which roles can read each category. Web views, API/MCP responses and exports must enforce the same audience rules.

Locked decision from Q3: staff-only visibility supports owner-selected roles, with an all-staff option. BASIC also explicitly selected VRDex-managed club roles rather than importing authority from VRChat group roles. VRDex is authoritative for staff assignments and permissions. VRChat roles govern the provider account's ability to access source data; they do not grant VRDex dashboard access. VRChat membership classification for analytics remains separate from club staff membership. Renaming or removing a VRChat role must not silently change someone's VRDex staff role. Loss of provider access can still stop collection and must appear in connection health.

Locked decision from Q4: custom roles are available from the first release, with editable Admin, Moderator and Event Staff presets. Staff can hold multiple roles, and their action permissions combine. A staff-only data category is readable through any assigned eligible role. Owner remains a separate singleton position; ordinary roles cannot grant access to owner-only information. The initial system has no role hierarchy or per-person permission overrides.

Locked decision from Q5: the owner can delegate staff invitations and assignments with an explicit set of assignable roles. Delegates can invite and revoke only those role assignments. Delegates cannot change their own assignments or ownership. Only the owner can edit role definitions, role permissions and data visibility initially. Delegated assignment authority must not enable granting further delegation beyond what the owner authorized.

Locked decision from Q6: aggregate metrics support public, selected staff and owner-only audiences. Named attendance and individual membership histories support selected staff and owner-only audiences. Public personal attendance would require a separate participant-controlled publication design. Collection consent and retention remain unresolved.

Locked review requirement: BASIC wants to inspect the complete dashboard during this design process, including interactive graphs. A month view must allow selecting a day, examining that day's detail and returning to the month. The design deliverable includes a working browser prototype using clearly synthetic data, followed by review of the full dashboard and group-connection/staff/settings flows. No production collector activation is implied.

Locked decision from Q7: the default landing view is a historical overview covering the last 30 days, with current activity visible at the top. BASIC also requested consideration of a customizable home dashboard. Scope and ownership of customization remain open, particularly personal preferences versus an owner-managed shared club layout.

Locked decision from Q8: the owner sets the club's default home dashboard, and staff can apply personal overrides to show/hide and reorder predefined widgets and save a preferred default date range. Provide reset to the club default. These preferences do not change data permissions. Freeform resizing and arbitrary chart/query builders are not included in the accepted initial customization scope.

Locked library decision: BASIC explicitly selected Recharts after the independent comparisons. Use the existing VRDex UI components and selectively adapt shadcn chart presentation where useful. This supersedes earlier ECharts and side-by-side selection recommendations; no additional engine-selection prototype is required. The full interactive dashboard review and verification of the chosen Recharts integration remain required.

Locked decision from Q9: design toward full coverage, but launch may expose partial capability availability. Aggregate and membership analytics cover observable activity; named attendance is shown only where a validated source supports it. Onboarding and reports must distinguish named-attendance coverage from aggregate and membership-event coverage. Missing identity coverage is not zero attendance, and sampled identities are not a complete visitor census. The accepted scope does not authorize deploying a collection source or entering instances.

Q10 response reopened feasibility rather than approving retention. BASIC expects remote visibility to expose friends rather than all occupants, even for group admins, unless the observer is in the instance. Record this as an operator observation/hypothesis, not a verified universal API rule. BASIC floated people friending the bot as a possible future approach; this is not authorization to send friend requests or collect friend presence. The community-maintained instance schema describes a creator-account `users` exception, still unproven for this integration. Friendship-based observations would be an incomplete, self-selected sample and cannot establish a whole-instance member/guest breakdown or unique-attendee count. Q10 retention remains unanswered.

Locked decision from revised Q10: defer named instance attendance and instance member-versus-guest segmentation from the first release. Keep aggregate instance analytics and group membership movement in scope. Earlier Q1 aspiration and Q9 partial-coverage policy remain relevant to future attendance work, but do not make identity collection part of this launch.

Candidate future capability explicitly endorsed by BASIC: opt-in personal history of clubs visited and sets attended, where self-selected coverage has value to the participating person even without representing the whole audience. Potential sources include a separately designed bot-friend integration or other authorized observations. Presence overlapping a confirmed set schedule can suggest attendance; it cannot prove listening or attention. Inferred set association, participant confirmation, visibility, retention, edits/deletion and collection consent require their own design. Friendship alone is not specified as consent to tracking. No outreach or collection is authorized. This future personal capability must not silently expose a person's history to club staff.

Locked decision from Q11: first-release membership analytics includes aggregate movement charts and an identifiable membership activity table showing who joined or left. The table is restricted to owner-selected staff roles or the owner under Q6. Group membership events are not instance attendance. Source event meanings, retention and backfill completeness still require definition and verification.

Locked decision from Q12: BASIC rejected automatic 90-day expiration and requested permanent retention of all statistics until deletion is requested. Apply this to the current release's aggregate statistics, detailed population observations, instance lifecycle history, coverage and identifiable membership activity. No age-based loss of historical drill-down. Disconnect stops collection and public presentation but does not itself request deletion. This supersedes the proposed 30/60/90-day policy and requires changing the existing implementation contract, which expires exact observations after 90 days once rolled up and hourly summaries after 18 months. Do not mutate deployed retention jobs during this design discussion. Future opt-in personal attendance remains a separate design, not an enabled data family.

Implementation implications to specify: preserve data resolution and source timestamps; query historical windows without loading the full archive; budget growth from measured observation rates and active-instance counts; permit lossless compression or archival if historical access and meaning are preserved. Do not silently downsample away details required by month/day/instance inspection. Provider backfill availability is independent of VRDex retention: retained history can be permanent without older unobserved provider history being recoverable.

Locked scope decision from Q13: deletion workflows are out of scope for this release/design slice. Do not add owner or individual deletion UI, requests, permissions or implementation as a launch requirement. The proposed Q13 authority rules were not accepted. Permanent retention remains selected; deletion behavior can be designed in a later task. This scope deferral does not assert that a deletion facility already exists or authorize ignoring a future request.

Locked decision from Q14: one primary connected VRChat group per club in this release. Clubs may additionally link to other VRChat groups. Additional links do not create bot assignments, collect analytics, merge member counts, grant staff access or establish verified control. Clearly distinguish the primary connected group in setup/settings from ordinary additional group links. Preserve appropriate existing outbound-link visibility behavior; exact additional-link editing/presentation should reuse the current profile link system where supported.

## Scope expansion, 2026-09-09

BASIC rejected the analytics-only recommendation at Q15 and explicitly requested bot management actions and a complete member-management platform on a separate screen from analytics. Research actual provider permissions and limitations before treating actions as feasible. This authorizes research and design, not live group mutations or deployment. The existing staff-role, visibility and primary-group decisions still apply.

Member management concerns VRChat group members, join requests, invitations and provider-side roles. VRDex club staff roles remain independently owned by VRDex. Granting a provider role does not grant a VRDex staff role. Potential provider-role management belongs in its own clearly labeled section rather than sharing the club-staff editor.

Product action authorization should combine the actor's current VRDex capability, the club owner's enabled integration features and the bot's current provider permissions. A bot's broad provider capability must never become implicit authority for every staff member. Connection health should identify unavailable actions without treating the bot as a full administrator by default. Exact provider capability checks and ownership limitations are under research.

Keep member management, analytics, VRDex staff/settings and group connection as distinct navigation destinations with shared club context. Announcements, instance operations, bulk actions and automation depth remain candidate branches to grill separately.

Interview preference reaffirmed: ask questions directly in chat, with multiple independent questions per round when useful. Do not use the question tool.

Locked decisions from Q16-Q18, accepted with "all r":

- First-release member management includes member search/filter/detail and membership history, join-request approval/rejection, invitations, assigning/removing existing VRChat roles, member removal and ban/unban, subject to provider capability verification.
- Authorized staff execute actions directly within separately granted permissions. Removal and ban actions require clear confirmation, and action history attributes operations to the initiating VRDex staff member. No general owner-approval queue for routine authorized operations.
- Management actions are manual in the first release. No unattended approval, inactivity-removal or ban rules. Bulk operations are not settled by accepting manual execution.

Design implication: provider audit entries may identify the shared bot rather than the human initiator. VRDex must retain its own actor-attributed action history and distinguish submitted, provider-confirmed, failed and indeterminate outcomes. Never label a timed-out provider write successful or blindly retry a potentially completed mutation.

Locked decisions from Q19-Q21, accepted with "all r":

- Bulk approval/rejection of selected join requests and assignment/removal of permitted VRChat roles are included. Show exact targets before execution, report individual outcomes and allow cancellation of remaining work. Member removals and bans remain individual initially.
- The owner selects which VRChat roles each VRDex staff role can assign. Bot capability alone does not grant a staff member assignment authority. Routine member-management actions cannot change the bot's own role assignments. This is independent of delegation of VRDex staff roles under Q5.
- Include modern group Posts and instance creation/closure on separate screens with separate permissions. Allow optional association with VRDex events. Editing VRChat role definitions and broader group settings remains outside the first release.

Locked decisions from Q22-Q24:

- Q22: BASIC explicitly includes scheduled publishing alongside drafts, preview, publish-now and supported post editing/deletion. This is a scoped exception to Q18's manual-first direction; it does not enable unattended membership moderation rules.
- Q23: instance creation supports standalone instances and creation from a VRDex event. Event context prefills relevant known values for staff review, and the created instance can be associated with the event's analytics.
- Q24: onboarding supports independently enabled analytics, membership management, posts and instance operations, each with its required provider permissions. Missing permission for one feature must not disable unrelated features, and enabling an integration feature does not grant human staff permissions.

Additional candidates raised by BASIC: scheduled instance creation and bulk invitations. These are explicitly under consideration, not authorization to create instances or send invitations. Scope of bulk invite recipients and execution time remains to be settled. Group membership invitations and invitations to enter a running instance are distinct operations and must not share an ambiguous action label.

Locked decisions from Q25-Q27:

- Q25 accepted: one-time scheduled instance creation, either at a chosen time or relative to a VRDex event. Show exact execution time; event-relative schedules follow event time changes and cancel when the event is cancelled. Recurrence is not included by this acceptance. Unpublishing behavior still needs an explicit decision if it differs from cancellation.
- Q26: include bulk invitations both to join the primary VRChat group and to enter an instance. Keep these as distinct operations. Recipient selection, delivery eligibility and scheduling are not yet settled; do not carry over the earlier group-only recommendation as an accepted restriction.
- Q27 accepted: at execution, recheck initiating staff permission, integration feature enablement and bot access. Pause and notify on lost authorization. Retry transient failures only within a limited grace window, then mark missed. Reconcile indeterminate provider writes before retrying. Specific grace periods and notification delivery remain open.

Locked decisions from Q28-Q30, accepted with "all r":

- Bulk recipients come from manual selection and reusable named lists of explicitly added users. Deduplicate and show a final recipient preview. Group membership or friendship with the bot does not automatically enroll someone in an invitation audience. Provider eligibility remains an additional condition.
- Both invitation types support one-time scheduled batches. Instance invitations may depend on a selected scheduled instance-creation job. Send only after that job has a confirmed destination; failed creation blocks the batch instead of substituting a different instance/location.
- Provide a club-wide Scheduled actions screen for posts, instance creation and invitations, showing time, state and initiating staff member, with permission-controlled editing/cancellation. Each feature screen also shows its relevant scheduled items. The shared view does not broaden data visibility or action authority.

Locked decisions from Q31-Q33, accepted with "all r":

- Provide an optional friend-the-assigned-bot step for instance invitations, with a profile link and eligibility state. This is for invitations, not attendance tracking. Provider no-client sending remains a verification prerequisite.
- Notify the initiating staff member of actionable scheduling failures in-app and by email; route to the owner if the initiator no longer has club access. Avoid notifications for ordinary successes and repeated retries. Notifications must not expose content to recipients who have lost permission to read it.
- Scheduled actions may execute up to 15 minutes late, respecting provider backoff. After that, mark remaining work missed and require deliberate rescheduling. Invitation batches report individual outcomes, including unsent recipients. No duplicate retry after an uncertain provider result without reconciliation.

Locked decisions from Q34-Q36, accepted with "all r":

- Scheduled invitations freeze the reviewed recipient list. Later edits to reusable lists affect future batches. Updating pending recipients requires explicit review, and execution still checks eligibility and authorization.
- The owner or staff with both the underlying action permission and manage-scheduled-actions permission may edit another person's pending action. Preserve author/edit history. A person changing executable content, time or recipients becomes the authorizing actor for the revised action; execution checks their current permissions.
- Cancelling an event cancels pending linked jobs and stops remaining invitations, but does not automatically close an existing instance or alter already-published posts. Show live artifacts for deliberate followup actions. Only explicitly event-bound jobs participate in this cancellation behavior.

BASIC explicitly requested independent subagent consideration of alternatives to ECharts, including shadcn and custom-built charts. After that research, BASIC selected Recharts. Earlier engine recommendations below are historical rationale, superseded by that selection.

Chart-library research compares candidates against that interaction requirement. The existing app uses React 19, Next.js 16 and repo-owned Tailwind components, with no chart package in `apps/web/package.json`. Preserve those surrounding components and add a focused chart library rather than replacing the design system. See [the design-system contract](../engineering/design-system.md).

## Candidate dashboard interaction contract

- Shared selected range and community across overview graphs, membership movement and instance results.
- Monthly overview uses day buckets. Clicking a day opens finer time buckets and the matching instance list; selecting an instance opens its aggregate population curve. Named attendance is deferred.
- An explicit return-to-month control restores the prior month, filters and chart context. Browser back/forward and a range breadcrumb should follow the same navigation.
- Range brushing/zooming complements clickable drill-down; visible controls and keyboard navigation provide an alternative to gestures.
- Hover/focus details show timestamp, metric, units and source freshness/coverage. Missing observations remain gaps, not zeroes.
- Charts share a time cursor where useful. Summaries and supporting tables follow the selected range rather than mixing month totals and day detail.
- Show viewer-local date boundaries consistently, including daylight-saving days. Daily UTC rollups cannot simply be relabeled as local-day totals.
- Coarse views load aggregate buckets; narrower views load finer observations. Visual zoom alone is not equivalent to fetching finer-resolution data.
- Prototype data includes a busy multi-instance day, a quiet day, coverage gaps, join/leave activity and role-restricted detail. Owner/staff/public previews demonstrate audience behavior using synthetic records.
- Review desktop and mobile layouts, keyboard inspection, tooltip legibility, reset/back behavior and empty/loading/error states.

Recharts and a last-30-days default are locked decisions. The revised first-pass layout is approved, as recorded below.

### Candidate home widgets

| Widget | Main view | Detail interaction |
| --- | --- | --- |
| Current activity | Population, visible active instances and freshness | Open active instances and their observed populations |
| Activity history | Population/player-hours over the selected range | Select day, then inspect instances; preserve range context on return |
| Membership movement | Joins, voluntary departures, administrative removals and net change | Open period breakdown, with individual records only for authorized staff |
| Group size | Latest member count and count history | Inspect observed values and source age |
| Recent instances | World, observed times, peak and coverage | Open aggregate instance detail |
| Event comparisons | Comparable event recaps and coverage | Open event report with confirmed associated instances |
| Collection status | Readiness per capability and collection gaps | Open group connection/recovery flow |

The widget list is a candidate catalog. Home should start with a small useful subset; full reports remain reachable through navigation. Definitions and units stay fixed even when widgets are rearranged. Changing layout never changes the audience of underlying information. Public community presentation is separate from the staff home layout, and copying a club default must not copy private data or another person's filter values.

For customization, prefer a simple edit mode with show/hide controls, accessible move-up/down actions and optional drag reordering. Library comparison should not assume draggable/resizable grid infrastructure is required. A role losing access must stop future data retrieval even if the person's saved layout still references the widget. Empty permitted data and restricted data need different handling.

Current recommendation: prototype Apache ECharts as the focused chart layer. Its [event and action documentation](https://echarts.apache.org/handbook/en/concepts/event/) supports click-driven detail loading and zoom events. Keep drill-down navigation and data fetching in VRDex rather than treating chart zoom as a complete reporting workflow. Recharts is the React-native alternative, including the [shadcn chart presentation](https://ui.shadcn.com/docs/components/chart); Highcharts has [built-in drilldown](https://www.highcharts.com/docs/chart-concepts/drilldown), with licensing to evaluate against the open-source/self-hosted product. Verify accessibility and React lifecycle behavior in the prototype rather than assuming library features establish end-to-end usability.

Updated recommendation after the requested independent reviews: give Recharts with selectively adapted shadcn components and ECharts equal consideration in a small, identical-data interaction comparison before choosing the full dashboard renderer. Start with the Recharts case; month/day/instance navigation is primarily application state and querying, so richer engine zoom alone does not settle the choice. Use visx as the custom-design alternative if a demonstrated requirement exceeds the higher-level libraries. Own shared range, navigation, filter and widget state regardless of renderer. The comparison is a candidate validation step, not proof that any package has already been selected or tested. See [independent alternatives](group-analytics-chart-alternatives-2026-09-08.md) and [custom-chart assessment](group-analytics-custom-chart-assessment-2026-09-08.md).

## Candidate UI scope

- Group connection: select or resolve the group, verify control, assign a VRDex account, guide join/request/invite steps, and check the permissions each analytics capability needs.
- Readiness: distinguish account assigned, membership pending, permissions missing, connected, initial history loading, and actual data arriving. Readiness for population, membership events and management actions can differ.
- Analytics: group overview, instance list and detail, membership movement, event reports, filters and exports. Named attendance and member-versus-guest breakdowns are deferred under Q10.
- Members: searchable member directory, member detail/history, join requests, invitations, existing VRChat-role assignments, removals and bans, with separate action permissions.
- Access and history settings: staff visibility, public aggregate opt-ins, permanent retention and disconnect. Deletion workflows are deferred under Q13.
- Club staff: invitations, role assignment, capability editing, removal, and an owner-controlled visibility table. Aggregate categories support public, staff-only and owner-only audiences; individual histories support staff-only and owner-only. Exact default assignments remain open decisions.
- Recovery: permission revocation, account removal or loss, reassignment, collection gaps, and reconnect.

These are screen responsibilities to refine, not approved layouts or public copy.

## Interview frontier

### First dashboard preview, 2026-09-09

**Locked decision: first-pass dashboard design approved by BASIC.** After reviewing the revised preview, BASIC said, "this is great!! Good enough for a first pass, let's lock it in". The approved baseline includes the dashboard navigation and screen structure, customizable Home, daily activity bars, total membership line on Home, membership movement bars in Analytics, independent tooltips, and live/past instance lists. Instance rows prioritize Peak and Average beside the name, with secondary Opened/Closed timestamps; omit Coverage and State columns. Data completeness belongs in instance detail.

Use this preview as the implementation design baseline. This approval settles the first-pass visual review, not provider feasibility, production authorization behavior, durable scheduling or deployment. Illustrative permission presets and simulated actions still need implementation against the accepted requirements. The prototype limitations below remain applicable.

Instance-list hierarchy refinement, approved: population metrics outrank timestamps. Put Peak and Average immediately after the instance/world column, use stronger numeric typography, and place Opened/Closed afterward in secondary text.

Visual review refinement: omit Coverage and State from instance lists. Closed contains the closing time, Still open or Unknown. Keep data completeness available inside instance detail, with a plain explanation of missing observations and their effect on averages.

Locked decision from visual review: Home uses a total group membership line chart and daily activity bars. Preserve the joins/departures bar chart in Analytics, outside Home. Tooltips operate independently; remove synchronized hover and its highlighted cursor region. Shared range selection does not imply linked hover.

Include a full recorded instance history, separate from live instances, with world, opened/closed times, peak population, average population and coverage. The target is all group instances, including those not created through VRDex. Actual completeness depends on source visibility and collection coverage; never claim unseen history was captured. Average population should be time-weighted over observed intervals, with gaps excluded and coverage shown. Preserve unknown closing times rather than substituting last observation or close-to-new-joins time.

An isolated, synthetic-data preview covers Home, Analytics, Members, Posts, Instances, Scheduled actions, Staff & roles, Data visibility and Group connection. It uses Recharts and offers Workspace, Top navigation and Report first layout studies. The conversation preview is stored at `C:/Users/steve/.codex/visualizations/2026/09/08/01a0836d-d2cc-7352-a55b-f66f010c0af6/club-dashboard-preview.html`.

Browser checks exercised chart-to-day navigation, instance detail and return context, invitation scheduling, and the restricted public view. Desktop and narrow mobile layouts were visually inspected in dark and light appearances. Review caught and corrected an incorrect instance dependency for group invitations and date-based event cancellation; cancellation now uses explicit event association.

This is a design preview, not production functionality. Changes are in memory; permissions are illustrative presets and some permission dialogs are review-only. Provider calls, durable scheduling, real authorization, real recipient snapshots, complete time filtering and URL navigation remain implementation work. The revised first-pass layout has BASIC's approval. New public-facing wording introduced during implementation still follows the repo copy-review rule. No provider actions or app dependencies were changed.

Q34-Q36 and the revised first-pass dashboard design are accepted. The visual-review frontier is closed for this pass. Next, consolidate the implementation specification and remaining provider proofs against this approved baseline; do not reopen settled visual choices without a concrete reason.

Provider permissions research is complete at [the management capability matrix](club-management-provider-permissions-research-2026-09-09.md). Permission dependencies, own-member grants, post and close semantics are source-backed but still require bounded live verification before writes are enabled. Normal closure prevents future joins; eviction/hard-close effects are not established. Modern posts must be used instead of the legacy announcement replacement endpoint.

Provider follow-up research is captured in the companion brief. Creator-scoped API rosters and authorized local-client observations are candidate named-attendance sources; neither currently proves universal group-instance coverage. Membership classification requires time-relevant evidence with an explicit unknown state. The collection strategy and bounded proof still need design decisions.

After these answers, settle gross event definitions, visibility, historical depth, freshness, permissions, exports and delivery scope. Record resolved domain terms in a glossary and qualifying hard-to-reverse decisions separately. Do not treat candidate definitions above as approved policy.
