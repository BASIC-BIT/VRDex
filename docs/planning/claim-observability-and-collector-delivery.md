# Claim observability and collector delivery

## Status

Implemented incident repair and deliberately small operating model.

## Incident and repair

Production could run a healthy but obsolete collector image that never claimed
VRChat proof work. Pending attempts then looked queued even though no worker
could process them.

Convex now returns `queued` only when a proof-capable collector has polled
recently. Otherwise it returns `unavailable` and preserves the pending attempt
for recovery. Attempt rows record dispatch time, provider-check time, bounded
outcome, and terminal resolution. The worker emits sanitized structured logs
and exits after repeated control-plane failures so ECS can restart it.

## Observability

- Convex attempt rows are the source of truth for claim troubleshooting.
- CloudWatch alarms on missing heartbeats, authentication failures,
  control-plane failures, and worker restarts.
- PostHog reports the claim journey with opaque UUIDs and bounded properties.
  It receives no profile slug, proof code, provider target, account ID, user
  ID, email address, credential, or raw error.

The PostHog dashboard stays focused on two questions: where journeys stop in
the funnel, and which terminal outcomes occur. Inventory coverage remains a
separate metric from claimant conversion.

## Deployment

After a successful `main` Baseline Checks run, the collector release workflow:

1. tests the worker and control-plane contract;
2. builds the exact source SHA and resolves an immutable ECR digest;
3. allows only the image and release metadata in the saved Terraform plan;
4. waits for ECS stability;
5. verifies a fresh heartbeat from that exact release;
6. reapplies the previous immutable release if verification fails.

This uses one scoped GitHub OIDC release role. There is no scheduled polling or
separate audit role. Runtime health belongs to CloudWatch, while release
convergence is checked once during deployment.

Credentials, collector identity, networking, request budgets, desired count,
and enablement remain explicit infrastructure operations.

## Compatibility cleanup

The former lifecycle-event and per-task-heartbeat tables remain in the schema
temporarily so deploying this cleanup does not delete existing production data.
New code no longer writes them. Remove those legacy schema definitions only
after an explicit data-retirement decision.

The existing bounded analytics outbox also remains in place. Simplifying or
retiring it changes the durability and retention of existing production
analytics, so that is a separate data-lifecycle decision rather than part of
this runtime cleanup.
