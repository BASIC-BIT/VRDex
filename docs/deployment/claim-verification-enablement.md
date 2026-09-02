# Claim verification enablement

How to turn on profile claiming in production, and what each path needs.

## Why claiming was failing

Both claim routes create their pending record in a mutation that works fine,
then verify in an action that reads configuration production never had:

| Route | Verifying function | Required env | Present in production |
| --- | --- | --- | --- |
| VRChat proof | `profileClaims:verifyVrchatProofViaAdapter` | `VRCHAT_PROOF_ADAPTER_URL` | No |
| Discord community | `profileClaims:verifyDiscordCommunityAdminClaim` | `DISCORD_BOT_TOKEN` | No |

Both names appear only under **Hosted E2E Helpers** in
[`convex-environments.md`](./convex-environments.md), pointing at the staging
stub, and nothing in CI or terraform sets them. The stub itself refuses to run
in production. Users therefore received a proof code or a pending request and
then hit a generic error forever.

Confirm the current state with:

```bash
pnpm cx -- prod env list
```

## Path 1: Discord via OAuth (recommended, no new secrets)

`discordVerification:startGuildVerification` sends the user through a
purpose-scoped Discord OAuth round-trip with the `identify guilds` scope,
reads their guild list once, records an `externalControlProofs` row for every
guild where they are owner, Administrator, or hold Manage Server, then revokes
the access token. No provider token is stored, and normal sign-in consent is
unchanged.

This reuses `AUTH_DISCORD_ID`, `AUTH_DISCORD_SECRET`, and `SITE_URL`, which
production already has. **The only change required is one redirect URI.**

In the Discord Developer Portal, for the production application, add this to
OAuth2 → Redirects:

```text
https://vrdex.net/api/discord/verify/callback
```

Staging needs the equivalent entry on the staging application:

```text
https://staging.vrdex.net/api/discord/verify/callback
```

No bot, no invite, and no new Convex environment variables. Once the redirect
URI is registered, community claiming works.

## Path 2: Discord via bot (optional, for ongoing re-validation)

The original bot-token path still exists behind
`profileClaims:verifyDiscordCommunityAdminClaim`. It re-checks permission
server-side without the user present, which OAuth cannot do, so it is the right
mechanism for periodically confirming that an owner still administers a linked
server.

It needs, in production Convex env:

- `DISCORD_BOT_TOKEN` — bot token for the production Discord application.

It also requires the bot to be a member of every guild being verified, which
means an invite per server with the `bot` scope. `DISCORD_API_BASE_URL` is
optional and defaults to `https://discord.com/api/v10`.

## Path 3: VRChat proof via the collector

`communityTelemetry:claimPendingProofChecks` hands pending attempts to the
group-telemetry collector, which reads the target's bio or group description,
looks for the one-time code, and reports only a boolean back through
`proof_result`. Bio and description text is never returned, cached, or logged.

This runs on the existing collector fleet and therefore inherits its gates:

- `VRDEX_GROUP_TELEMETRY_ENABLED=true` on the worker,
- a ready `collectorAccounts` row with its kill switch off,
- the global `collectorFleetSettings` kill switch off.

Both gates are cleared as of 2026-07-27 and the fleet is enabled: BASIC accepted
durable service-account sessions as an operating pattern, and the vault-to-AWS
transfer command (`pnpm ops:vrchat-session:transfer`) ships. See
`workers/group-telemetry/README.md` for the credential lifecycle and
`docs/deployment/group-telemetry-collector.md` for the runbook.

Proof reading is real VRChat API access. The stop condition in
`docs/planning/community-group-telemetry.md` still applies: if VRChat objects,
stop proof traffic and clear the saved session.

`VRCHAT_PROOF_ADAPTER_URL` remains supported as an alternative external adapter
seam and is no longer required for VRChat proofs to work.

`profileClaims:verifyVrchatProofViaAdapter` returns `queued` only when an
eligible collector has reached the proof-claim gate within the last two
minutes. It returns `unavailable` when that proof-path heartbeat is missing or
stale while preserving the pending attempt for recovery. Generic ECS health or
a runtime heartbeat does not substitute for this proof-path signal.

For deployment convergence, query
`communityTelemetry:collectorDeploymentReadiness` with the expected exact Git
SHA, required capabilities, heartbeat age bound, and current time. The response
contains counts and bounded issue codes only. It is healthy only when at least
one eligible fresh collector reports that exact release and every required
capability. Runtime diagnostics are structured JSON. In particular,
`collector_auth_required`, `collector_control_plane_failure`, and
`collector_worker_restart` carry bounded classifications without exception
messages, proof material, provider payloads, target IDs, or credentials.

## Path 4: VRC Linking

`VRCLINKING_PROOF_ADAPTER_URL` still points at the generic adapter seam. The
API shape is now known and recorded in
[`vrclinking-api.md`](../backend/vrclinking-api.md): `GET /members/{guildId}`
with `searchBy=DiscordId` returns a member's `vrcId` and `isVerified`, which is
the attestation VRDex would consume.

A client is implemented: `workers/vrclinking-adapter` resolves a delegated
credential reference and answers the single `GET /members/{guildId}` question,
and community owners can register a delegation from `/account/connections`.

`infra/terraform/vrclinking-adapter` deploys the adapter, and the claim form
offers VRCLinking on person profiles. Three Convex variables gate the method,
and `getClaimJourneyContext` hides it unless all three are set — an environment
holding only some of them would offer a method that throws:

- `VRCLINKING_PROOF_ADAPTER_URL`, the deployed Function URL.
- `VRCHAT_PROOF_ADAPTER_BEARER_TOKEN`, the same value on both sides.
- `VRCLINKING_ADAPTER_CAPABILITY_KEY`, the signing key, which must be a
  different value from the bearer token.

One thing still gates the path, and it is not code: **no community has delegated
a credential.** Until one has, the method is offered wherever those three
variables are set, and every attempt short-circuits to `unavailable` before the
adapter is called — `verifyVrchatProofViaAdapter` has nothing to ask, so it does
not post the claimant's Discord id anywhere. The claim page renders that as
"VRCLinking could not be reached", which is the state to expect from a
pre-delegation smoke test; a genuine no-match looks different and only becomes
reachable once a delegation exists.

API keys are minted from a logged-in VRCLinking account and member reads are
guild-scoped, so this needs a per-community delegated key or a partner
credential, and there is no published ToS for third-party server-to-server use.

## What an operator has to do

These steps change production configuration or create third-party application
credentials, so they are deliberately not automated:

1. Register the production redirect URI above (unblocks Discord claiming).
   **Reported done by BASIC on 2026-07-27**, in session. Not independently
   verified from the repo — nothing here can read the Discord Developer Portal.
   If guild verification returns `failed` for every attempt, re-check this
   first: without the redirect URI Discord rejects the code exchange after
   consent, which looks identical to a provider outage.
2. Decide whether to enable the bot path, and if so set `DISCORD_BOT_TOKEN` in
   production Convex env and invite the bot to the relevant servers. **Not
   enabled.** The OAuth round-trip covers claiming on its own; the bot path is
   kept for the deferred re-validation work.
3. Decide whether to enable collector-backed VRChat proof reading. **Enabled
   2026-07-27**, on BASIC's decision that a durable VRChat service-account
   session is an accepted operating pattern. The run state is checked in at
   `infra/terraform/group-telemetry-collector/environments/production.tfvars`;
   apply production with `-var-file=environments/production.tfvars` or the
   defaults will take the fleet down. The disabled-first sequence in
   `docs/deployment/group-telemetry-collector.md` is the bring-up runbook for
   standing a fleet up, not a description of the current state.

   The collector has no separate proof gate: `VRDEX_GROUP_TELEMETRY_ENABLED` is
   its only switch, and proof checks run whenever it does.
   `VRDEX_GROUP_TELEMETRY_PROOF_ENABLED` belongs to
   `scripts/prove-vrchat-group-telemetry.mjs`, the local provider-proof harness,
   and setting it on the worker changes nothing.

4. Record which external assets back which listings, for any listing that should
   be able to reach `claimed_verified`. **Nothing does this automatically, and
   without it no claim reaches verified** — proving control of a server or group
   shows the claimant runs that asset, not that the asset is the one a listing
   represents, so VRDex requires an association it did not get from the
   claimant:

   ```bash
   pnpm cx -- prod run profileConnections:recordOperatorAssociation '{"profileSlug":"example-community","assetType":"discord_guild","assetExternalId":"123456789012345678"}'
   ```

   `assetType` is `discord_guild`, `vrchat_group`, or `vrchat_user`. Claims
   still grant ownership without it, at `claimed_unverified`; the association is
   what allows the upgrade. It is internal on purpose — a self-service version
   would be the claimant corroborating their own claim, which is the takeover
   this rule exists to prevent.

Nothing else is required: the schema, functions, routes, and UI ship with the
application deploy.

## Verifying after enablement

The browser emits `claim_journey_viewed`, `claim_method_selected`, and
`claim_submitted`. Convex is authoritative for `claim_attempt_created`,
`claim_verification_started`, and `claim_resolved`. One opaque random journey
UUID correlates those milestones across an OAuth return or page reload without
encoding a user, profile, provider, or target identity.

Convex writes authoritative milestones to `claimAnalyticsOutbox` with the
claim transition. Delivery to PostHog happens later with an idempotent insert
key and a ten-second request bound. Each fast retry cycle is capped at five
attempts; a bounded hourly sweep requeues dead-letter and configuration-disabled
rows so a temporary PostHog outage or configuration loss recovers automatically.
PostHog availability never blocks a claim. Missing `POSTHOG_PROJECT_API_KEY` disables
delivery safely for local work, forks, previews, and self-hosted deployments
that do not opt in.

BASIC BIT production reuses the hosted public project key that Terraform
supplies to Vercel. `baseline-checks.yml` provisions it into production Convex
from `TERRAFORM_POSTHOG_PUBLIC_KEY` before deployment and fails the hosted
production deploy if that key is absent or malformed. Local work, forks,
previews, and self-hosted deployments may still omit it. Do not commit the key
or substitute a PostHog personal API key. `POSTHOG_INGEST_HOST` is optional and
defaults to `https://us.i.posthog.com`; a configured override must use HTTPS.

The collector audit also checks aggregate outbox delivery health. Any disabled
or currently failed row, a scan-limit condition, or an oldest outstanding
delivery over fifteen minutes fails the audit without exposing a journey ID.

The checked-in PostHog stack declares the claim dashboard and reconciliation
views. Apply it separately with a reviewed Terraform plan; repository changes
do not mutate hosted PostHog state.
