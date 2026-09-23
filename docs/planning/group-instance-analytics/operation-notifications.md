# Operation notifications

Terminal rejected, indeterminate and missed operations create one notification
per operation, revision and outcome. Success, cancellation and preflight retries
do not. Notification rows contain no post content, recipient list or provider
error text. Reads recheck current club authority and the operation permission.
If the initiator has lost club access, the current owner receives the notice.
If the initiator remains staff but lacks the operation permission, the content
is withheld. Read state does not transfer to a new owner recipient.
Each recipient's dismissal remains recorded if authority later returns to them.

In-app history uses cursor pagination, with current recipient checks on each
scanned page. An empty filtered page retains its continuation and the UI offers
Load more notifications, so newer unrelated or dismissed rows cannot hide older
accessible failures. Notification links open Scheduled actions, including for
invitation-only staff who do not have member-directory permission.

Email uses the existing AWS SES transport. BASIC approved the exact subject and
body on September 16, 2026; see the [release review](release-review.md#copy-status).
Deployment enablement still requires separate approval and verification of the
deployment's sender and IAM permissions. An actual delivery test also requires
separate authorization.

- `VRDEX_CLUB_OPERATION_EMAIL_ENABLED=true`: Convex deployment opt-in, default off.

This is operator enablement, not a recipient subscription setting. The accepted Q31-Q33 behavior sends actionable failure notifications to the initiating staff member by email, with owner fallback after access loss. Recipient-level preferences are not implemented.

- `AWS_SES_FROM_EMAIL`: existing verified SES sender.
- `AWS_SES_REGION`: existing SES region.
- `VRDEX_SITE_URL`: HTTPS public origin used for the authenticated account link.
- AWS credentials use the existing SES SDK credential chain and operator-owned
  deployment secret configuration; do not add credentials to source control.

Owner: VRDex deployment operator. Recreate configuration through the existing
deployment secret setup; rotate AWS credentials using the existing IAM process.
No new credential or external email service is introduced.

Delivery claims each message once immediately after checking recipient authority
and a verified email address. SDK retries are disabled. An uncertain response or
action crash does not automatically resend. Ineligible pending rows defer their
next check by an hour so they cannot block later notices. The in-app record
remains available regardless of email outcome.

The five-minute delivery action drains at most 20 messages, claiming and checking
each recipient immediately before its one transport attempt. A failed send or
finish acknowledgement does not stop later messages. Submitted claims abandoned
for an hour become indeterminate on a subsequent bounded claim scan; they never
return to pending. Each pending scan examines at most 100 due rows. An ineligible
prefix is deferred, allowing subsequent scans to reach later notices. Batch,
revision, outcome and recipient deduplication suppresses repeated batch email.

Approved email copy:

- Subject: `VRDex action needs attention`
- Body: `An action needs your attention. Sign in to review it: {account URL}`

Verification remaining: authenticated recipient visibility tests, rendered
in-app view, configured SES delivery smoke test, and deployment wiring.
No actual messages have been sent during implementation.
