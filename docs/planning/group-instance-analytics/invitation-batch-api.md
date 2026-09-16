# Invitation batch backend contract

The backend accepts only explicitly supplied VRChat user IDs. A list or preview
contains at most 100 input entries. IDs are validated and deduplicated in input
order. Lists are club-scoped; access requires group-invitation or instance-management
authority. There is no all-members or all-friends audience source.

## Endpoints

- `clubInvitations.saveList`: club ID, optional list ID and expected revision,
  name, recipient IDs. Updating a stale revision fails.
- `clubInvitations.removeList`: club ID and list ID. Existing batches are unchanged.
- `clubInvitations.lists`: club ID and cursor pagination, at most 50 lists per page.
- `clubInvitations.preview`: club ID and explicit recipient IDs. Returns normalized
  recipients and duplicate count. This is recipient selection, not provider eligibility.
- `clubInvitations.enqueue`: club ID, request ID, reviewed recipient IDs, schedule,
  and destination. Returns a batch ID. Destination is `group`, `instance` with
  world/instance IDs, or `scheduled_instance` with a creation-operation ID.
- `clubInvitations.outcomes`: batch ID. Each entry contains operation ID, original
  reviewed user ID, current target user ID, state, code, and due time.
  `canCancel` is true only when at least one job remains pending or claimed and
  the caller can cancel every such job. The calculation reuses the operation
  engine's current permission and actor checks; the mutation rechecks them.
- `clubInvitations.batches`: club ID and cursor pagination, at most 20 scanned
  batches per page, newest first. Returns `id`, `createdAt`, `recipientCount`, and
  `destinationKind` (`group`, `instance`, or `scheduled_instance`). Every current
  operation permission is rechecked before returning a batch. A filtered page can
  be empty while `isDone` is false; retain and follow its continuation cursor.
- `clubInvitations.cancel`: batch ID. Cancels only unsent jobs using each operation's
  current authority check. Submitted and terminal outcomes remain intact.

Enqueue delegates to the shared transactional operation engine. A repeated request
returns the same batch; reusing its request ID for different executable content fails.
Recipients are stored in the batch and operation records, never resolved from a
mutable list during execution. List edits therefore affect only future enqueue calls.
Individual operation revisions retain their original batch review target alongside
the current executable target. The UI must explicitly review recipient changes.

The shared engine owns execution-time authorization, provider eligibility, the
15-minute deadline, event cancellation, operation revisions and creation dependencies.
Scheduled-instance destinations are resolved only from the selected successful
creation operation. The invitation API itself performs no provider requests.

Enqueue and edit reject invitation times before the selected creation time. Both
event-relative times are resolved against current event data. If later edits move
creation after the reviewed invitation time, claim and submission reject the invite
with `instance_creation_rescheduled`. Staff must deliberately reschedule it; the
system preserves the reviewed schedule and dependency rather than shifting or
detaching them automatically.

## Verification

Five focused backend tests cover input validation, snapshot immutability, enqueue
idempotency, revision conflicts, nonstaff denial, feature-disabled atomicity, and
cancellation that preserves submitted work. Backend TypeScript checking passes.
Live invitations and the browser recipient-selection flow remain unverified.

## Invitation destination context

All queued provider read caches, not only eligibility, bind to the assigned bot
and credential generation. Rotation, reassignment, account/fleet kill switches,
or inactive collector state invalidate cached results and prevent their reuse.

`clubProviderReads.context` provides `assignedBot: {userId, profileUrl} | null` to
authorized invitation staff, without collector secrets or configuration. This is
a link to the assigned account, not evidence of friendship or an invitation send.

The queued provider read kind `instances` requires `manage_instances` and the
enabled `instances` feature, independently of analytics visibility. Its items are
`{id: location, worldId, instanceId, name}`. No population, roster, or history is
included. The worker rechecks authenticated account identity and current group
membership before reading. The [group instance endpoint](https://vrchat.community/reference/get-group-instances)
has no documented pagination or additional read grant; the adapter bounds the
response to 1,000 rows and 2 MiB, validates each destination belongs to this group,
then slices pages locally. Enumeration means provider-visible instances, not a
guarantee of all group instances. Execution still rechecks the selected destination
and recipient eligibility immediately before the provider write.
