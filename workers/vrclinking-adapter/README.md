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
  "delegations": [{ "guildId": "…", "secretRef": "secret://…" }]
}
```

Responds with the shared proof-adapter contract:

```jsonc
{ "verified": true, "evidenceSource": "vrclinking", "evidenceSummary": "…" }
```

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
| `PORT` | Listen port, default `8080`. |
| `VRDEX_VRCLINKING_ENABLE_AWS_SECRETS` | Set `true` to resolve `arn:aws:secretsmanager:…` references through the task role. |
| `VRDEX_VRCLINKING_SECRET_DIR` | Directory backing `secret://<name>` references. Used for local runs and as a file-mounted alternative to Secrets Manager. |
| `VRDEX_VRCLINKING_BASE_URL` | Provider base URL, default `https://vrclinking.com/api`. Override to point at a stub. |

At least one secret backend must be configured or every request resolves to
`503`.

## Running locally

```bash
mkdir -p /tmp/vrclinking-secrets && printf 'my-token' > /tmp/vrclinking-secrets/community-a
VRCHAT_PROOF_ADAPTER_BEARER_TOKEN=dev-token \
VRDEX_VRCLINKING_SECRET_DIR=/tmp/vrclinking-secrets \
pnpm --filter @vrdex/vrclinking-adapter start
```

Then point Convex at it with `VRCLINKING_PROOF_ADAPTER_URL=http://127.0.0.1:8080`.

## Deployment

Not deployed by this repo yet. It needs somewhere to run with either the
Secrets Manager task-role policy (mirroring
`infra/terraform/group-telemetry-collector/main.tf`) or a mounted secret
directory, and `VRCLINKING_PROOF_ADAPTER_URL` in Convex pointed at it.

## Tests

```bash
pnpm test:vrclinking-adapter
```
