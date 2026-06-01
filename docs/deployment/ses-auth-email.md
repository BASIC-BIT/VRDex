# SES Auth Email

## Current Recommendation

Use Amazon SES for Convex Auth password and email verification messages.

The Terraform stack at `infra/terraform/ses` provisions the SES domain identity, DKIM, custom MAIL FROM records, and an optional least-privilege IAM access key for Convex.

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
- `VRCHAT_PROOF_ADAPTER_BEARER_TOKEN`: optional bearer token sent to both proof adapters

Proof adapters receive JSON with `targetType`, `targetExternalId`, `proofCode`, and safe profile context. They must return JSON with `verified`, `evidenceSource`, and `evidenceSummary`.

## Sandbox Note

SES domain verification and DKIM do not automatically move an AWS account out of SES sandbox mode. Request SES production access in AWS before relying on real user emails outside verified recipient addresses.
