# SES Auth Email Terraform

This stack provisions the SES sender identity VRDex sends operational mail from.

Its original consumer was Convex Auth password and verification email, which Clerk replaced. Its consumer now is the hourly support digest, `internal.supportRequestDigest.sendSupportDigest`, which mails new `/support` requests to an operator.

Hosted baseline context and verification status are documented in `docs/deployment/aws-baseline.md` and `docs/deployment/ses-auth-email.md`.

It creates:

- SES domain identity
- Easy DKIM tokens
- optional Route 53 verification and DKIM records
- optional custom MAIL FROM domain records
- optional least-privilege IAM access key for Convex `ses:SendEmail`

## Usage

1. Copy `terraform.tfvars.example` to `terraform.tfvars` and set the real domain values.
2. Run `terraform init`.
3. Run `terraform plan` and review the SES, Route 53, and IAM changes.
4. Apply only after confirming the DNS zone and sender domain.
5. Store the sensitive outputs in Convex env, not in git.

## State Backend

Terraform state for this stack is stored in the S3 backend declared in `versions.tf`:

- bucket: `vrdex-terraform-state`
- key: `ses/terraform.tfstate`
- region: `us-east-1`
- locking: S3 native lockfile (`use_lockfile = true`)

The backend bucket has versioning, default SSE-S3 encryption, blocked public access, and a policy that denies non-TLS requests. The previous DynamoDB lock table `vrdex-terraform-locks` was removed on 2026-05-30 after confirming this repo uses S3 native lockfiles and the table had no active Terraform lock item.

Convex env values after apply:

- `AWS_SES_REGION`: `terraform output -raw aws_ses_region`
- `AWS_SES_FROM_EMAIL`: `terraform output -raw aws_ses_from_email`
- `AWS_ACCESS_KEY_ID`: `terraform output -raw aws_access_key_id`
- `AWS_SECRET_ACCESS_KEY`: `terraform output -raw aws_secret_access_key`
- `VRDEX_SUPPORT_DIGEST_TO`: the mailbox the support digest is delivered to. Not a Terraform output; choose the address an operator actually reads. **Applying this stack without setting it leaves the digest switched off**, so `/support` requests accumulate in Convex with nobody notified, which is exactly the failure the digest exists to prevent.

SES accounts can remain in sandbox mode even after domain verification. If production sending is still sandboxed, request SES production access in the AWS console before relying on real user emails.

The IAM access key secret is stored in Terraform state. Do not run this stack against a local backend.
