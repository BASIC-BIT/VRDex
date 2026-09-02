# Claim observability and collector delivery

## Status

Current recommendation for the VRChat proof repair, claim observability, and
automatic collector release lane.

## Verified incident

Production ran the only collector image pushed on 2026-07-27. Collector support
for VRChat profile proofs entered the repository on 2026-07-29, so the running
image could remain healthy in ECS while never claiming proof work. Pending proof
attempts consequently had no `lastCheckedAt` value, and the worker emitted no
health signal that distinguished an idle current release from an obsolete one.

Client-side PostHog claim events also supplied no production evidence for the
affected journey. Client events are useful for interaction and abandonment, but
they are not authoritative for backend attempt creation, collector checks, or
ownership grants.

## Locked boundaries

- Convex is authoritative for claim and verification state.
- CloudWatch and the collector control plane own operational health.
- PostHog owns sanitized product-journey and adoption analysis, not provider
  polling or authorization.
- Analytics must not contain profile slugs, proof codes, provider target IDs,
  provider account IDs, user IDs, email addresses, raw errors, or credentials.
- Collector images deploy by immutable digest. A mutable tag is never deployment
  authority.
- Routine collector image releases after a passing `main` build are automatic.
  Changes to credentials, collector identity, networking, request budgets,
  desired count, or enablement remain explicit production operations.

## Collector release contract

Every collector image carries:

- the exact source Git SHA;
- a human-readable collector version;
- a fixed capability set that currently includes `telemetry_v1` and
  `vrchat_proof_v1`.

The worker reports those values on startup and at a bounded heartbeat cadence.
The control plane stores only the latest heartbeat for each collector account.
A deployment is successful only when ECS reaches steady state and the exact
configured collector account reports a fresh heartbeat with the expected
release and capabilities.

The release workflow must:

1. run worker and worker/control-plane compatibility tests;
2. build from the exact merge SHA;
3. push to ECR and resolve the immutable digest;
4. create and apply a saved Terraform plan using production run state;
5. wait for ECS stability;
6. verify the expected release heartbeat;
7. retain the previous release metadata and reconcile both Terraform state and
   ECS to that release when verification fails.

Breaking worker protocol changes require a backward-compatible two-stage
rollout. The control plane must accept the previous and current capability set
until the fleet has converged.

## Operational claim contract

This implementation closes issue #286 and supersedes the narrower repair in
PR #287. It preserves that repair's useful availability distinction: a VRChat
proof request is `queued` only after a fresh proof-capable collector has
actually polled for work. When no eligible collector is fresh, the API reports
`unavailable` while preserving the pending attempt for automatic recovery.

Dispatch and provider checks are separate lifecycle facts. Claiming a batch
records dispatch metadata, but only a real bounded provider response records a
check. A worker that repeatedly cannot reach the control plane emits a redacted
structured failure event and exits after a bounded threshold so ECS can restart
it.

Collector-eligible proof attempts record:

- first and latest check time;
- bounded check count;
- latest bounded check outcome;
- terminal resolution time when applicable.

Allowed check outcomes are `not_found`, `found`, `rate_limited`,
`auth_required`, `provider_unavailable`, and `control_plane_error`. Provider
errors remain classified and sanitized. The worker emits structured records for
startup, heartbeat, claimed batch size, bounded provider result, backoff,
authentication failure, control-plane failure, and shutdown.

Operator health must expose, without customer identifiers:

- pending collector-eligible attempts;
- attempts with no first check;
- age of the oldest unchecked attempt;
- the maximum latency among first checks that occurred in the last fifteen
  minutes, so a slow check remains visible for one bounded diagnostic window;
- time to first check and resolution;
- collector heartbeat age, release, capability set, state, and cooldown;
- bounded failure counts.

Initial alert thresholds are:

- an eligible attempt is unchecked for two minutes;
- eligible attempts exist and no collector heartbeat is fresh within two
  minutes;
- a collector enters `auth_required`;
- three consecutive control-plane failures;
- the deployed release or capability set differs from the expected release for
  more than fifteen minutes from the first consecutive mismatch observation;
  a healthy audit resets that persistence clock.

## Product analytics contract

The claim funnel contains these milestones:

1. `claim_journey_viewed`, from the browser;
2. `claim_method_selected`, from the browser;
3. `claim_submitted`, from the browser;
4. `claim_attempt_created`, from the authoritative backend;
5. `claim_verification_started`, from the authoritative backend when the first
   external check occurs. For Discord community claims this is the start of the
   purpose-scoped OAuth round trip; the opaque journey ID is carried into that
   request before Discord is opened;
6. `claim_resolved`, from the authoritative backend for completed, rejected,
   canceled, or expired journeys.

An opaque random journey ID may correlate browser and backend milestones. It is
scoped to one claim journey and one authenticated browser session, and carries
no encoded user, profile, or provider identity. Backend delivery uses a small
durable outbox so a committed ownership
transition is not lost when PostHog is temporarily unavailable. Delivery is
best-effort with bounded retry and never blocks the claim itself.

PostHog properties are fixed enums and coarse timing buckets only: profile type,
method, entry source, outcome, connection-only state, time-to-first-check
bucket, and time-to-resolution bucket.

## Dashboards and reconciliation

The operator surface has two durable parts. The Terraform-managed CloudWatch
dashboard shows collector heartbeat, ECS task count, CPU, authentication,
control-plane failures, restarts, and recent redacted operational logs. Every
five minutes, the release audit adds the aggregate Convex proof-backlog and
analytics-outbox snapshot to its GitHub Actions summary and enforces the alert
thresholds. The PostHog dashboard covers journey conversion, method selection,
abandonment, terminal outcomes, and coarse resolution latency.

Listing coverage and user adoption remain separate metrics. Claimed listings
divided by all seeded listings is inventory coverage, not claimant conversion.

A hosted canary must reconcile one consented journey across Convex, CloudWatch,
and PostHog before the work is complete. The canary must not manufacture a live
provider throttle or expose proof material in evidence.

## Drift detection

A scheduled read-only check compares the latest successfully built `main`
release with the ECS task digest and the control-plane heartbeat. It reports a
failure after fifteen minutes of persistent disagreement and never mutates the
fleet. The normal release workflow remains the only automatic writer.

## Verification

- Unit and integration coverage for heartbeat authorization, release metadata,
  proof check lifecycle fields, analytics privacy, outbox retry, and terminal
  deduplication.
- Workflow-policy tests for path triggers, OIDC permissions, immutable digest
  deployment, production run-state use, ECS stabilization, and post-deploy
  heartbeat verification.
- Terraform formatting, validation, and a saved production plan before apply.
- Worker tests plus the complete backend and web suites.
- A production canary after the automatic release lane is configured.
