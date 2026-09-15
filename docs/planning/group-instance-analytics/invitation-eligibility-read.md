# Explicit invitation eligibility checks

`clubProviderReads` supports `invitation_eligibility` for one explicitly chosen recipient: `n: 1`, `offset: 0`, `userId`, and optionally a paired `worldId`/`instanceId`. A supplied destination must belong to the primary integration group. The current actor needs `manage_instances` and the independently enabled `instances` feature; analytics and member-directory access are not required.

The queued read uses the existing budgeted worker transport. Before reading, the worker checks current bot identity, group membership and fresh own-member authority. Friendship-only checking makes one friend-status request. A current destination additionally uses the existing scoped destination read. Future creation uses no guessed destination and returns `destinationState: pending`.

The result contains only recipient ID, friendship (`friend` or `not_friend`), destination state (`open`, `closed` or `pending`), invitation-check result and observation time. It does not expose incoming/outgoing friend requests, presence, profile details or a friend list. Reads are explicit per recipient, not an automatic batch harvest. No friend request or invitation is sent by checking.

Cached eligibility is bounded to the existing 60-second read freshness. Retrieval verifies the current assigned bot and credential generation; cache identity includes them, so reassignment or credential rotation cannot reuse old friendship evidence. Completion rejects another recipient or inconsistent status fields. Execution still rechecks authority and eligibility immediately before an actual invitation.

An invitation check passing does not establish that the recipient can enter an age-gated, membership-limited, role-limited or banned destination. A future creation remains destination pending even if friendship is confirmed. UI uses “Invitation check passed”, not a claim of admission.

Verification: backend tests cover feature/anonymous denial, single-target bounds, foreign destination rejection, completion target integrity and cache invalidation on credential changes. Worker tests cover explicit single-user reads, malformed friend-status response, pending/closed destination projection and changed-bot rejection. No provider request was sent during tests. The UI owner separately verifies desktop/mobile explicit-check interactions.
