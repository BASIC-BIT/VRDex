# SES Auth Email

## Current Recommendation

Use Amazon SES for Convex Auth password and email verification messages.

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

Proof adapters receive JSON with `targetType`, `targetExternalId`, `proofCode`, and safe profile context. They must return JSON with `verified`, `evidenceSource`, and `evidenceSummary`.

## Sandbox Note

SES domain verification and DKIM do not automatically move an AWS account out of SES sandbox mode. Request SES production access in AWS before relying on real user emails outside verified recipient addresses.

The hosted AWS account currently has a production-shaped SES quota. Keep this documented status current if the SES region, sender domain, or account changes.

## Relationship To AWS Baseline

The broader AWS baseline, including private S3 profile assets tracked by [#115](https://github.com/BASIC-BIT/VRDex/issues/115), lives in `docs/deployment/aws-baseline.md`.
