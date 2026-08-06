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
      "secretRef": "secret://vrdex/vrclinking/<guildId>/<credentialId>",
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
| `VRDEX_VRCLINKING_SECRET_DIR` | Directory backing `secret://<name>` references. Used for local runs and as a file-mounted alternative to Secrets Manager. Set the same variable on the web app and delegation writes land here instead of Secrets Manager, which is what makes a self-hosted deployment able to *create* a delegation rather than only resolve one. |
| `VRDEX_VRCLINKING_BASE_URL` | Provider base URL, default `https://vrclinking.com/api`. Override to point at a stub. |

At least one secret backend must be configured or every request resolves to
`503`.

Secrets are named `vrdex/vrclinking/<guildId>/<credentialId>`, one per delegation
row. VRDex writes them itself when a community owner pastes a key, so there is
nothing to provision by hand outside local runs. The trailing segment is what
lets a replacement write a new object instead of overwriting the key its
predecessor is still answering with, and what keeps two profiles delegating the
same guild from sharing one secret.

The guild-only form, `secret://vrdex/vrclinking/<guildId>`, is still accepted
here. That is a deliberate rollout overlap: Convex deploys automatically on
merge while this Lambda is deployed by hand, so the two are never upgraded in
one step, and accepting only one shape breaks whichever side moves first. Drop
it once this Lambda is deployed everywhere.

The ARN form is rejected at both ends, because its pattern admitted any region
and account while the execution role reads only its own.

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
# The file has to sit at the reference the delegation actually carries:
# secret://vrdex/vrclinking/<guildId>/<credentialId>. A flat name resolves to
# nothing and every request comes back unavailable.
#
# The credential id is the Convex row id — read it from the delegation you are
# testing with, or use any value while hand-signing a capability.
mkdir -p /tmp/vrclinking-secrets/vrdex/vrclinking/100000000000000001
printf 'my-token' > /tmp/vrclinking-secrets/vrdex/vrclinking/100000000000000001/k17localdevcredential000000000
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

`infra/terraform/vrclinking-adapter` deploys this as a Lambda behind a Function
URL, with the Secrets Manager execution-role policy it needs; that stack's
README carries the sequence and what stays outside Terraform. `server.mjs` and
the Dockerfile remain for local runs and for anyone hosting the container
themselves, which needs a mounted secret directory or its own task role.

## Tests

```bash
pnpm test:vrclinking-adapter
```
