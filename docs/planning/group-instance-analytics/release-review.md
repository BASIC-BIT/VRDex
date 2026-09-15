# Club workspace release review

Snapshot: 2026-09-14, current local implementation. This is a review packet, not approval to deploy, send email or operate a VRChat group. The approved dashboard layout is evidence of design approval; it does not establish approval of every later sentence.

## Copy status

The staff design's Public copy table already proposed exact wording but explicitly required BASIC's review before merge. No separate exact-copy approval was found during this audit. Treat matching sentences below as **previously proposed, approval still unproven**, rather than silently marking them approved. Obvious utility labels and existing approved patterns can proceed under AGENTS.md; new substantive sentences below await review. Dynamic club, person, event and list names are user data, not new authored copy.

### Staff, invitations and visibility: previously proposed

- “Ownership is separate from roles.”
- “No staff yet. Invite someone to get started.”
- “This link works once and expires in 7 days.”
- “VRDex roles control this dashboard. VRChat group roles are managed separately.”
- “Deleting this role removes it from everyone who holds it. Categories visible only to this role become owner only.”
- “Owner-controlled. Public settings apply to community pages and public APIs.”
- “Historical statistics are retained permanently. Disconnecting stops collection.”
- “You have been invited to join the staff of this club.”
- “This invitation is no longer valid.”
- “You do not have access to this page.”

Source: accepted staff design Public copy table; current club-staff, club-visibility, club-invitation and club-workspace components. New overflow sentence: “Showing the first 500 assignments. Additional staff are not shown here.” New clipboard guidance: “Select and copy the invite link.”

### Group connection: review exact explanatory copy

- “VRDex assigns one of its own service accounts. Your VRChat credentials are never requested.”
- “Disconnect stops collection and public presentation immediately. Existing private history is retained.”
- “Approve the pending service-account membership request in VRChat to begin collection.”
- “Invite service account {VRChat user ID or ‘shown above’} to this VRChat group.”

Source: club-connection.tsx. Feature and provider-role controls mostly use utility labels. Primary/additional-group-link refinements are in progress and must be rechecked before final review.

### Analytics, membership and instances: review exact empty/error/help copy

- “No observations in this range.”
- “No event recaps in this range.”
- “No telemetry yet.”
- “Unable to load this range.”
- “Some days exceed the available summary size. Their values are omitted.”
- “No widgets selected.”
- “Membership movement unavailable.”
- “No recorded membership events.”
- “No recorded instances.”
- “Instance unavailable.”
- “Instance history is restricted.”
- “{percentage}% observed time. Average population excludes missing intervals.”
- “Close this instance to prevent new joins?”
- “No group roles available.”
- “Instance management is disabled.”
- “Unable to queue closure. Try again.”

Sources: club-chart, club-analytics, club-membership, club-instances and club-instance-actions. Event association adds the short statuses “Event associated.” and “Association failed.” All chart labels and dates remain utility/data presentation; do not add explanatory paragraphs merely to fill space.

### Member management: review exact notices

- “Refresh to continue.”
- “Member management is disabled.”
- “No results.”

Source: club-members.tsx. The confirmation panel presents the selected action and exact selected member targets with “Confirm action” and “Cancel”. Those are utility labels; reviewer should inspect actual ban/removal confirmation layout and target identity rather than approve it from labels alone.

### Posts: review exact confirmations

- “Queue changes to this post?”
- “Queue this post?”
- “Group members will be notified.”
- “No group notification.”
- “Choose an event and a valid offset.”
- “Choose a future date and time.”
- “No draft selected.”
- “No drafts.”
- “No posts.”
- “Posts are disabled.”

Source: club-posts.tsx. Short result statuses: “Draft saved.”, “Post queued.”, “Post deletion queued.” Content/title previews are user-authored data. Notification opt-in is off by default; review that interaction along with the wording.

### Invitation batches: review exact guidance and confirmations

- “Eligibility is checked when each invitation is sent.”
- “Invitations wait for this instance creation to succeed.”
- “Up to 100 entries, separated by spaces, commas, or new lines.”
- “Delete {list name}?”
- “Cancel invitations that have not been submitted?”
- “Choose an instance.”
- “Choose an instance creation.”
- “Choose an invitation destination.”
- “Choose an event and a valid offset.”
- “Choose a future invitation time.”
- “Invitation time must be at or after instance creation.”
- “No invitation batches.”

Source: club-invitation-batches.tsx. Short result statuses: “Invitations queued.”, “List saved.”, “List deleted.” The bot action currently reads “Open assigned bot in VRChat”. Final recipient IDs, destination and execution time must remain visible in the actual review screen. This file is still being refined by its owner; refresh exact strings before obtaining final approval.

### Scheduled actions and notifications

- “No actions in this view.”
- “Could not dismiss notification.”

Sources: club-scheduled.tsx and club-notifications.tsx. Short states are utility labels: “Pending”, “Preparing”, “Submitted”, “Sent”, “Failed”, “Outcome unknown”, “Cancelled”, “Missed”. Failure reason labels come from club-operation-model.ts; inspect them in the assembled view, especially “Instance creation moved after this invitation” and “Outcome unknown”. Do not render raw provider errors as authored help prose.

### Common short fallback messages

These are new utility/status patterns rather than marketing prose, but include them in the final screen review: “Unable to save changes.”, “Unable to create preset roles.”, “Unable to save roles.”, “Unable to save features.”, “Unable to save post.”, “Unable to update post.”, “Unable to save invitations.”, “Unable to cancel invitations.”, “Unable to save action.”, “Unable to cancel action.”, “The telemetry change failed.”. Loading indicators and one/two-word controls are omitted from the substantive approval list. Backend validation errors are also surfaced by some catch handlers, so error-state testing must check their final user-visible text.

### Email: exact proposed content

Source: convex/clubNotificationEmail.ts.

- Subject: “VRDex action needs attention”
- Plain-text body: “An action needs your attention. Sign in to review it: {URL}”
- URL: configured HTTPS site origin plus `/account/communities/{encoded club slug}/scheduled`.

No group/member/post content appears in the email. Sending remains off unless `VRDEX_CLUB_OPERATION_EMAIL_ENABLED=true`; sender/region/site origin use the documented SES configuration. This packet does not enable it or authorize sending.

## Required live proof and release steps

1. Present the complete assembled owner/staff experience at desktop and mobile widths, including empty/loading/error/restricted states, destructive confirmations and notification-disabled state. Obtain exact new-copy approval with any edits incorporated first.
2. Use a specifically authorized non-production environment and test identities. Prove real sign-in return, single-use staff invitation acceptance, direct-route denial, permission revocation, multi-role union and owner-only categories. Fixture tests do not substitute for this browser journey.
3. Verify primary group plus two ordinary additional links through editing and public projection. Only the primary group receives an integration; ordinary links must not imply control or aggregate collection.
4. Obtain authorization naming the actual VRChat test group, bot and allowed operations before live mutation. Verify actual own-member permissions for each independent feature, current member reads/search, protected targets, role allowlists, posts and instance operations. Record endpoint behavior and no-client invitation feasibility without claiming universal provider support.
5. Verify real observations feed month/day/instance inspection, membership audit ingestion and event association/recaps. Distinguish unobserved history from zero activity and retained history from provider backfill coverage.
6. Exercise authorized scheduled posts/creation/invitations, event rescheduling/cancellation, dependent destination confirmation, remaining-recipient cancellation and the 15-minute cutoff. Demonstrate lost-authority failures and indeterminate outcomes without duplicate writes.
7. Once an actual email environment/recipient is approved, verify actionable-failure delivery, initiator access recheck/owner fallback and absence of success/retry spam. Review the received email and its authenticated destination.
8. Complete exact-head combined checks and review feedback, docs and schema/codegen review. Name target deployment and operation for release approval; run any required visibility migration explicitly and verify deployed state separately from merged code.

## Separate unresolved feature findings

- **Locked Q31, resolved locally after initial inventory:** explicit per-recipient eligibility checks now use the queued provider read path and show friendship, destination-pending and invitation-check states. The invitation UI owner reports eight desktop/mobile browser tests passing. Refresh the final UI strings/screenshots for approval; live provider proof remains outstanding. See invitation-eligibility-read.md.
- **Locked Q14:** profile links are reusable, but primary/additional setup and end-to-end proof were still being finalized during this snapshot.
- **Q27/Q33:** indeterminate jobs are not blindly retried. An evidence-backed reconciliation/recovery workflow is not implemented; preserve the uncertainty rather than presenting a duplicate enqueue as reconciliation.
- Rich comparisons, exports and private staff API/MCP endpoints remain candidate/later scope in the audited discovery/accepted staff design. Do not manufacture a missing launch requirement from a reserved permission value.

The event-association gap is now addressed by deliberate association of an actual observed session. Automatic mapping of successful creation results to sessions is not present and is not needed to invent observations. Additional accepted requirements beyond these specific findings remain tracked in implementation-status.md; this review packet is not a completion certificate.
