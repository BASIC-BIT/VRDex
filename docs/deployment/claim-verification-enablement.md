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
npx convex env list --prod
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

## Path 4: VRC Linking

`VRCLINKING_PROOF_ADAPTER_URL` still points at the generic adapter seam. The
API shape is now known and recorded in
[`vrclinking-api.md`](../backend/vrclinking-api.md): `GET /members/{guildId}`
with `searchBy=DiscordId` returns a member's `vrcId` and `isVerified`, which is
the attestation VRDex would consume.

A client is implemented: `workers/vrclinking-adapter` resolves a delegated
credential reference and answers the single `GET /members/{guildId}` question,
and community owners can register a delegation from `/account/connections`.

Two things still gate the path, neither of them code:

1. **The adapter is not deployed.** It needs somewhere to run with either the
   Secrets Manager task-role policy or a mounted secret directory,
   `VRCLINKING_PROOF_ADAPTER_URL` pointed at it, and
   `VRCHAT_PROOF_ADAPTER_BEARER_TOKEN` set to the same value in Convex and on
   the adapter. Its README documents the configuration and a local run.
2. **No claimant-facing entry point exists yet.** The claim UI submits only
   `vrchat_user` and `vrchat_group`, so a registered delegation cannot be
   exercised by a member until that method is added. Register delegations
   ahead of it if you like, but expect no member-visible effect yet.

API keys are minted from a logged-in VRCLinking account and member reads are
guild-scoped, so this needs a per-community delegated key or a partner
credential, and there is no published ToS for third-party server-to-server use.

## What an operator has to do

These steps change production configuration or create third-party application
credentials, so they are deliberately not automated:

1. Register the production redirect URI above (unblocks Discord claiming).
   **Done 2026-07-27.**
2. Decide whether to enable the bot path, and if so set `DISCORD_BOT_TOKEN` in
   production Convex env and invite the bot to the relevant servers. **Not
   enabled.** The OAuth round-trip covers claiming on its own; the bot path is
   kept for the deferred re-validation work.
3. Decide whether to enable collector-backed VRChat proof reading. **Enabled
   2026-07-27**, on BASIC's decision that a durable VRChat service-account
   session is an accepted operating pattern. The running deployment sets
   `enable_service = true` and `desired_count = 1` in the operator's
   `terraform.tfvars`, which is untracked — the checked-in
   `terraform.tfvars.example` ships disabled, so a clean checkout applied as-is
   would tear the fleet down. The disabled-first sequence in
   `docs/deployment/group-telemetry-collector.md` is the bring-up runbook for
   standing a fleet up, not a description of the current state.

   The collector has no separate proof gate: `VRDEX_GROUP_TELEMETRY_ENABLED` is
   its only switch, and proof checks run whenever it does.
   `VRDEX_GROUP_TELEMETRY_PROOF_ENABLED` belongs to
   `scripts/prove-vrchat-group-telemetry.mjs`, the local provider-proof harness,
   and setting it on the worker changes nothing.

Nothing else is required: the schema, functions, routes, and UI ship with the
application deploy.

## Verifying after enablement

Production analytics already instrument the funnel: `claim_journey_viewed`,
`claim_method_selected`, `claim_submitted`, `claim_completed`, and
`claim_failed` with a bounded `outcome`. Before this change none of these had
ever fired in production, because no user had reached a claim page. They are the
fastest signal that a path works end to end.
