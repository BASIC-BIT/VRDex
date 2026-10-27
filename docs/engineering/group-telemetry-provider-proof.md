# Group telemetry provider proof

## Status

**Current recommendation: adjust.** Free Join membership and four-hour aggregate polling are proven with a VRDex-owned account and a consenting group. Non-empty instance visibility, active-instance cadence, Request-to-Join, and Invite-Only remain unverified.

## 2026-07-22 bounded proof

The proof retained sanitized counts and state names only. The ignored local JSON evidence contains hashed target and account identifiers; this checked-in summary intentionally omits those stable hashes.

| Check | Result |
| --- | --- |
| Read-only membership inspection | Passed. One successful provider request reported an inactive membership, Free Join policy, and public group visibility. |
| Free Join transition | Passed. The service account moved from `inactive` to `active` with transition `joined`. |
| Four-hour collection | Passed. The run completed its requested 240 minutes without interruption. |
| Aggregate polling | Passed for the empty state. The harness recorded 59 successful aggregate samples. |
| Provider requests | 122 total, 122 successful, 0 client errors, 0 server errors, and 0 live rate limits. |
| Retry behavior | No live retry was needed. The deterministic no-provider-request policy check honored a 60-second `Retry-After`. |
| Visible instances | Unverified. All 59 overnight samples contained zero visible instances. |
| Credential evidence boundary | Passed. The artifact reports `credentialsIncluded: false` and contains no cookie, password, verification code, or raw provider payload. |
| Vault-backed login | Passed. A fresh interactive login validated the account, saved only the resulting session under the VRDex_Oak alias in Windows Credential Manager, and completed one successful provider request. |
| Vault reuse | Passed. A separate process loaded the saved session without opening a login URL and completed one successful provider request with authentication mode local_keychain_reuse. |

The four-hour run used the original memory-only interactive session and finished before account-scoped operating-system vault reuse was implemented. The two subsequent zero-duration checks prove the first saved login and no-prompt reuse paths independently. The saved session remains local to the operator machine and is not a hosted-fleet credential.

## Remaining provider checks

1. Run through a known event window to capture at least one visible group instance, population count, and the 1–2 minute active cadence.
2. Exercise Request-to-Join with a consenting private group and record the pending and approved states.
3. Exercise Invite-Only with a consenting group and record both the waiting state and accepted invitation.
4. Record naturally occurring provider failures if they happen; never manufacture a live 429.
5. Both halves of the activation gate are cleared as of 2026-07-27: BASIC
   accepted durable service-account sessions, and the vault-to-AWS
   secret-transfer command (`pnpm ops:vrchat-session:transfer`) ships. AWS-hosted
   sessions and the fleet are enabled. The stop condition below still applies.

The local operating-system vault cache is a deliberate, bounded risk for VRDex-owned proof accounts. It is not evidence of a provider exemption. If VRChat objects to this use, stop proof traffic and clear the saved local session.

## Explicit statistics admission: cleanup contract (2026-10-27)

The connected provider schema identifies `cancelGroupRequest` as authenticated `DELETE /groups/{groupId}/requests`, with the group path parameter and no body. The [API reference](https://vrchat.community/reference/cancel-group-request), re-read on October 27, documents cancellation of the current account's join request and a 200 response. This confirms the request shape, not live account behavior. Its examples do not establish ordering against approval or an earlier in-flight join, read-after-write consistency, or recovery after a lost response.

The local provider implementation uses `POST /groups/{groupId}/join` for requests and accepting an exact observed invitation. The explicit path budgets uncached metadata reads, records normalized inspections, then reserves one write transactionally. Missing membership or unknown metadata cannot authorize a write. Backend attempt, account, epoch, lease, capability, policy and budget guards remain authoritative.

No withdrawal transport is implemented. A cancelled pending request stays `cleanup_pending`, retains capacity and cannot retry or switch accounts. Operators must inspect the assigned account's request in the provider UI, withdraw it manually if still pending, and reconcile any later approval before considering capacity release. A single absent read cannot prove that an earlier uncertain write is finished; this implementation has no administrative override that silently releases that reservation.

Only membership created under the grant may be left. A successful acknowledged leave completes cleanup; 404, a lost reply or later absence alone does not. Pre-existing and managed memberships are preserved. Managed adoption before leave reservation prevents cleanup; adoption after an uncertain leave reservation fails with `Membership cleanup must be reconciled before adoption.` No compensating rejoin is attempted.

These lifecycle rules are covered by fake-transport and backend tests. Live request, invitation, withdrawal and racing-cleanup behavior remains unverified. No provider membership operation was executed for this change.
