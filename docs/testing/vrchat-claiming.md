# VRChat claiming verification

Keep three kinds of evidence separate:

- **Collector availability:** read `communityTelemetry:collectorProofAvailable`
  and exact-release `collectorDeploymentReadiness`. These establish that the
  worker is eligible and polling, not that a claimant's code was found.
- **Isolated authorization coverage:** the backend test below uses two identity
  fixtures and synthetic collector verdicts against real application handlers.
  The browser test uses two real Clerk development accounts and the existing
  staging adapter fixture. Neither establishes live VRChat identity proof.
- **Live ownership proof:** an authorized claimant places the generated code in
  the target bio or group description and the collector reads it successfully.
  Do not substitute a fixture verdict or edit another person's account to
  manufacture this evidence.

## Automated two-user checks

Run the isolated backend lifecycle:

```sh
node --conditions=import --import tsx --test tests/backend/vrchat-two-user-claims.test.ts
```

It checks distinct codes, private attempt context, reciprocal rejection of
another user's attempt ID, cancellation isolation, a competing ownership result,
and replay safety. It asserts a single owner, control proof, external link, and
approved claim request, with no loser-owned side effects. Network calls fail
the test.

For the browser check, use the existing
[hosted Clerk development setup](playwright-visual-preview.md). Enable the
already configured staging auth and adapter helper flags in the test process,
then run:

```sh
pnpm --filter web exec playwright test e2e/auth-claim.flow.spec.ts --grep "two Clerk users" --project=desktop-chromium
```

This creates two disposable Clerk accounts, opens separate browser contexts,
and creates one run-attributed profile. Both users obtain private codes. User B
cancels their attempt; user A's survives reload and completes through the
staging adapter fixture. User B then sees the existing-owner state, while user
A retains management access after reload. Both accounts and the fixture
profile are cleaned up. A configured run fails if its adapter prerequisite is
missing; local auth-unavailable runs skip and must not be reported as coverage.

Do not enable helpers in production. Use separate run IDs and browser contexts
from other staging work. No additional auth bypass or shared helper changes are
needed for this test.

## Remaining live check

Use an existing authorized claimant and a real pending attempt. Confirm the
collector is available, let the claimant publish the code, and verify the
attempt's successful completion and resulting ownership. A `not_found` result
demonstrates a working provider read, but leaves ownership unproven. The
[collector runbook](../deployment/group-telemetry-collector.md) documents
NAT-origin session recovery if the provider rejects the collector session.
