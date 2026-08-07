# SES Auth Email

## Current Recommendation

**Retired for authentication, live for the support digest.** Clerk sends its own
verification and password email, so SES is no longer part of sign-in — see
[`auth-sessions.md`](../backend/auth-sessions.md).

This section previously asked whether any other feature had adopted SES before
anyone removed the infrastructure. One has: the hourly
`internal.supportRequestDigest.sendSupportDigest` cron mails new `/support`
requests through this identity. Deleting the domain identity or the IAM key now
breaks it, and the breakage is silent, because requests keep landing in
`supportRequests` with nobody told about them.

Do not wire it back into an auth flow.

The Terraform stack at `infra/terraform/ses` provisions the SES domain identity, DKIM, custom MAIL FROM records, and an optional least-privilege IAM access key for Convex.

Current hosted baseline:

- domain identity: `vrdex.net`
- sender: `no-reply@vrdex.net`
- region: `us-east-1`
- Route 53 hosted zone: `vrdex.net` hosted zone; provider-generated hosted zone IDs stay in provider configuration, Terraform state, or operator records rather than public docs
- Terraform state key: `ses/terraform.tfstate`

As of the AWS baseline pass, SES identity verification and DKIM verification are both `Success`, and Terraform reports no drift for the hosted SES stack.

## Convex Environment Variables

Set these in each Convex deployment that sends email:

- `AWS_SES_REGION`
- `AWS_SES_FROM_EMAIL`
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `VRDEX_APP_NAME` optional display name for email copy
- `VRDEX_SUPPORT_DIGEST_TO`: where the hourly `/support` digest is delivered.
  Without it the cron returns `configured: false` and sends nothing, which is
  the correct state for a deployment that has no operator mailbox. Requests keep
  their unset `notifiedAt` meanwhile, so setting this later delivers the backlog
  rather than starting from whatever arrives next.

`configured: true` is not proof of delivery. It means the three variables are
present, not that SES accepted the message, so confirm a real digest arrived
after setting the recipient for the first time.

## Support Digest Rollout Order

`/support` accepts requests whether or not anyone is listening, and tells every
requester it succeeded. That is correct behaviour, since a request kept with an
unset `notifiedAt` is delivered whenever the recipient is configured, but it
means the window between shipping the route and configuring delivery is one
where people are told they have been heard and have not been. Keep it short and
deliberate:

1. Set `VRDEX_SUPPORT_DIGEST_TO` on the deployment.
2. Run `internal.supportRequestDigest.sendSupportDigest` by hand from the Convex
   dashboard and confirm the mail actually arrives. SPF and DMARC failures are
   silent from Convex's side, and `configured: true` does not see them.
3. Only then announce the route.

Until step 1 is done, the hourly cron logs a warning naming the number of
requests waiting, so an operator wondering why nobody has answered has
something to find. It is deliberately quiet when nothing is waiting, which is
the ordinary state of a deployment with no operator mailbox.

## Adapter Environment Variables

Discord community Administrator verification:

- `DISCORD_BOT_TOKEN`: Discord bot token for reading guild, member, and role state
- `DISCORD_API_BASE_URL`: optional override, defaults to `https://discord.com/api/v10`

The bot must be present in claimed guilds and able to read members and roles.

VRChat and VRCLinking proof-code verification:

- `VRCHAT_PROOF_ADAPTER_URL`: POST endpoint for VRChat user/group proof checks
- `VRCLINKING_PROOF_ADAPTER_URL`: POST endpoint for VRCLinking proof checks
- `VRCHAT_PROOF_ADAPTER_BEARER_TOKEN`: **required** whenever either adapter URL
  is set, and must match the value the adapter itself requires. Convex refuses
  to call an adapter without it rather than sending an unauthenticated request
  that the adapter would answer with a 401 — which the claim path reads as the
  non-terminal `unavailable`, so the claim would stall with the
  misconfiguration reported nowhere.
- `VRCLINKING_ADAPTER_CAPABILITY_KEY`: **required** whenever
  `VRCLINKING_PROOF_ADAPTER_URL` is set. Signs the per-delegation capability the
  adapter verifies as `VRDEX_VRCLINKING_CAPABILITY_KEY`. Keep it a different
  value from the bearer token: the bearer token authenticates the channel, and
  this authorizes the individual guild, so a leak of the first must not confer
  the second.

Adapter URLs must use `https`, or `http` only on loopback for a local stub.
Every request carries the bearer token.

The two adapters receive different payloads, and an implementation written
against the wrong one waits for fields it never gets:

- `VRCHAT_PROOF_ADAPTER_URL` receives `targetType` (`vrchat_user` or
  `vrchat_group`), `targetExternalId`, `proofCode`, and safe profile context.
  It answers whether the code is present on that target.
- `VRCLINKING_PROOF_ADAPTER_URL` receives `targetType: "vrclinking"`,
  `targetExternalId`, `discordUserId`, and a `delegations` array of
  `{ guildId, secretRef, expiresAt, capability }`. It receives no proof code
  and no profile context — it answers from a delegated key, so neither is of
  any use to it. See `docs/backend/vrclinking-api.md` for the delegation
  contract and what a positive result must carry back.

Both return JSON with `verified`, `evidenceSource`, and `evidenceSummary`.

## Sandbox Note

SES domain verification and DKIM do not automatically move an AWS account out of SES sandbox mode. Request SES production access in AWS before relying on real user emails outside verified recipient addresses.

The hosted AWS account currently has a production-shaped SES quota. Keep this documented status current if the SES region, sender domain, or account changes.

## Relationship To AWS Baseline

The broader AWS baseline, including private S3 profile assets tracked by [#115](https://github.com/BASIC-BIT/VRDex/issues/115), lives in `docs/deployment/aws-baseline.md`.
