# Review Instructions

## Important findings

Reserve Important findings for concrete defects introduced by the pull request
that can break a user flow, cross an identity or authorization boundary, expose
private data or credentials, corrupt durable data, mischarge someone, publish
incorrect public information, or make deployment and recovery unsafe.

Use priorities consistently:

- `P0`: immediate security, privacy, billing, or destructive-data risk
- `P1`: correctness or operational defect likely to affect real users
- `P2`: bounded defect worth fixing before merge

Style preferences, naming, speculative abstractions, missing comments, and test
ideas are not Important unless they hide one of those concrete risks.

## Noise controls

- Review only behavior introduced by this pull request. Mention a pre-existing
  issue in the summary only when it materially changes the risk of the diff.
- Do not repeat formatting, lint, type, generated-file, or routine lockfile
  findings already enforced by CI.
- Do not recommend new abstractions without a specific correctness, security,
  privacy, cost, or operational failure they prevent.
- On follow-up reviews, suppress resolved findings and new nits unless the
  latest changes introduced them.

## Evidence bar

Every finding must include a repository-relative `file:line` reference, the
changed behavior, its concrete impact, and the smallest safe fix. Put uncertain
product questions and unavailable runtime evidence in the summary instead of
presenting them as confirmed blockers.

## VRDex invariants

- Public unclaimed people and community profiles remain visibly unverified or
  community-submitted. Claim-level actions require a verified identity.
- Ownership is singular and transferable. Role and permission changes must not
  widen tenant, person, community, event, or provider boundaries.
- Authentication and OAuth changes preserve state, nonce, redirect, token,
  session, and verified-email checks without exposing credentials in logs,
  URLs, analytics, browser bundles, or durable review artifacts.
- Billing and webhook changes preserve signature verification, idempotency,
  entitlement consistency, and retry-safe transitions.
- Public discovery, events, profiles, media, and telemetry must not infer or
  expose private presence, attendance, identity, ownership, or popularity.
- Event times render in the viewer's local timezone. Restream and watch
  surfaces appear only when the event is actually watchable.
- Convex and other durable writes preserve authorization, indexes, validation,
  migrations, retry safety, and compatibility with existing stored data.
- Infrastructure and deployment changes keep secrets out of source and state,
  use least privilege, preserve environment boundaries, and retain a documented
  rollback or recreation path.
- Public copy changes must preserve approved wording, avoid unapproved AI
  framing, and follow the repository's public-copy rules.
- Meaningful UI changes use shared primitives where practical and include the
  required visual verification evidence.

## Output

List actionable findings first, ordered by priority. Keep the summary concise.
End with exactly `Important findings found.` or `No Important findings.`
