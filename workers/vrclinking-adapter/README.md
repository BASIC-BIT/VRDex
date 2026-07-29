# VRCLinking proof adapter

Answers one question for the Convex control plane:

> Does VRCLinking report this Discord user as linked to this VRChat account, in
> a guild whose operator delegated a credential to VRDex, and is that link
> verified?

This service exists because VRDex holds delegated VRCLinking API keys that grant
broader read than the use they are put to. Keeping them here means Convex never
holds a third-party token — it stores only a reference, matching
`collectorAccounts` and event media control. See
[`docs/backend/vrclinking-api.md`](../../docs/backend/vrclinking-api.md) for the
provider contract and the delegation model.

## Contract

`POST /` with `Authorization: Bearer <VRCHAT_PROOF_ADAPTER_BEARER_TOKEN>`:

```jsonc
{
  "targetType": "vrclinking",
  "discordUserId": "123456789012345678",
  "targetExternalId": "usr_…",              // the VRChat account being claimed
  "delegations": [
    {
      "guildId": "…",
      "secretRef": "secret://vrdex/vrclinking/<guildId>",
      "expiresAt": 1767225600000,           // ms epoch; short-lived
      "capability": "<64 hex chars>"        // HMAC-SHA256 over
                                            // `guildId\nsecretRef\nexpiresAt`
    }
  ]
}
```

A delegation missing `expiresAt` or carrying an absent, expired, or unverifiable
`capability` is dropped, and a request left with none answers `no_delegations`.
The signing key is `VRDEX_VRCLINKING_CAPABILITY_KEY` here and
`VRCLINKING_ADAPTER_CAPABILITY_KEY` in Convex — the same value, and a different
one from the bearer token.

Responds with:

```jsonc
{
  "verified": true,
  "evidenceSource": "vrclinking",
  "evidenceSummary": "…",
  "matchedDelegationIndex": 0,              // required on a positive result
  "matchedGuildId": "…",                    // optional
  "consultedDelegationIndexes": [0]         // delegations actually asked
}
```

`matchedDelegationIndex` is not optional on a positive: Convex re-reads that
delegation before accepting the attestation and refuses a positive that names
none. `consultedDelegationIndexes` is what the operator-visible "last queried"
stamp is written from, and is present on negative responses too.

`GET /healthz` returns `{ "status": "ok" }`.

A `503` means no delegation could be consulted — a credential was rejected, the
provider was unreachable, or a secret would not resolve. Convex reads a non-200
as "adapter unavailable" and leaves the attempt pending, which is the correct
outcome: the user's claim did not fail, we could not ask.

## Guarantees

- A match requires `isVerified === true` **and** `vrcId` exactly equal to the
  claimed account. An unverified or mismatched link never attests ownership.
- Provider data is never echoed back. The response carries a boolean and a
  summary naming only the guild — no display names, handles, or VRChat ids. A
  test asserts this.
- Search is fuzzy by provider contract, so results are matched on exact Discord
  id rather than trusting the first row.
- Delegation fan-out is capped at five per request.
- Resolved tokens are never logged and are cached in memory only.

## Configuration

| Variable | Purpose |
| --- | --- |
| `VRCHAT_PROOF_ADAPTER_BEARER_TOKEN` | Required. Shared secret with Convex; must match the Convex env of the same name. |
| `VRDEX_VRCLINKING_CAPABILITY_KEY` | Required. Signing key for per-delegation capabilities; must match Convex's `VRCLINKING_ADAPTER_CAPABILITY_KEY`. Keep it distinct from the bearer token — the point is that a leaked bearer token cannot mint one. |
| `PORT` | Listen port, default `8080`. |
| `VRDEX_VRCLINKING_ENABLE_AWS_SECRETS` | Set `true` to resolve `arn:aws:secretsmanager:…` references through the task role. |
| `VRDEX_VRCLINKING_SECRET_DIR` | Directory backing `secret://<name>` references. Used for local runs and as a file-mounted alternative to Secrets Manager. |
| `VRDEX_VRCLINKING_BASE_URL` | Provider base URL, default `https://vrclinking.com/api`. Override to point at a stub. |

At least one secret backend must be configured or every request resolves to
`503`.

Secrets are named `vrdex/vrclinking/<guildId>` — Convex only accepts a delegation
whose reference names the guild it is for, so provision the secret under that
name (or the matching Secrets Manager ARN) before the operator registers it.

That naming rule is a shape check on both sides, not authorization: the names
are derived from the guild id, so anyone who reaches this endpoint can construct
a matching pair. Each delegation therefore also carries a short-lived capability
signed with `VRDEX_VRCLINKING_CAPABILITY_KEY`, which the bearer token does not
carry — so a leaked bearer token alone cannot make this adapter spend a
community's key.

## Running locally

`workers/*` are not pnpm workspace members, so this runs on bare Node rather
than through a workspace filter. Install its one optional dependency first only
if you need AWS-backed secrets; the file backend below needs nothing.

```bash
# The file has to sit at the reference Convex accepts for that guild:
# secret://vrdex/vrclinking/<guildId>. A flat name resolves to nothing and
# every request comes back unavailable.
mkdir -p /tmp/vrclinking-secrets/vrdex/vrclinking
printf 'my-token' > /tmp/vrclinking-secrets/vrdex/vrclinking/100000000000000001
VRCHAT_PROOF_ADAPTER_BEARER_TOKEN=dev-token \
VRDEX_VRCLINKING_CAPABILITY_KEY=dev-capability-key \
VRDEX_VRCLINKING_SECRET_DIR=/tmp/vrclinking-secrets \
node workers/vrclinking-adapter/src/server.mjs
```

Then point Convex at it with `VRCLINKING_PROOF_ADAPTER_URL=http://127.0.0.1:8080`,
`VRCHAT_PROOF_ADAPTER_BEARER_TOKEN=dev-token`, and
`VRCLINKING_ADAPTER_CAPABILITY_KEY=dev-capability-key`. All three have to match
or the adapter answers every request with `no_delegations` — plain `http` is
accepted here only because this is loopback.

## Deployment

Not deployed by this repo yet. It needs somewhere to run with either the
Secrets Manager task-role policy (mirroring
`infra/terraform/group-telemetry-collector/main.tf`) or a mounted secret
directory, and `VRCLINKING_PROOF_ADAPTER_URL` in Convex pointed at it.

## Tests

```bash
pnpm test:vrclinking-adapter
```
