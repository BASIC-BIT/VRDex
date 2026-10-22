# Terraform State Bootstrap

This bootstrap stack manages the S3 bucket used by the other VRDex Terraform stacks for remote state.

It intentionally uses local Terraform state. Do not configure this stack to use the S3 backend it manages.

## Managed Resources

- S3 bucket `vrdex-terraform-state`
- S3 public access block
- S3 default SSE-S3 encryption
- S3 versioning
- S3 bucket policy that denies non-TLS requests
- GitHub Actions OIDC Terraform role `vrdex-github-terraform`
- least-privilege inline policy for Terraform state, the `vrdex.net` Route 53 zone, hosted SES identity, the Convex SES sender IAM user, and the profile asset storage baseline

The application stacks use S3 native lockfiles through `use_lockfile = true`; no DynamoDB lock table is required.

## Usage

1. Copy `terraform.tfvars.example` to `terraform.tfvars`.
2. Set `route53_zone_id` to the hosted Route 53 public zone ID in local `terraform.tfvars`.
3. Run `terraform init`.
4. If the bucket already exists, import the resources before the first plan:

```powershell
terraform import aws_s3_bucket.terraform_state vrdex-terraform-state
terraform import aws_s3_bucket_public_access_block.terraform_state vrdex-terraform-state
terraform import aws_s3_bucket_server_side_encryption_configuration.terraform_state vrdex-terraform-state
terraform import aws_s3_bucket_versioning.terraform_state vrdex-terraform-state
terraform import aws_s3_bucket_policy.terraform_state vrdex-terraform-state
```

- Run `terraform plan` and review any drift.
- Apply only after confirming the target bucket and AWS account.
- Store `terraform output -raw github_actions_terraform_role_arn` in GitHub repository variable `AWS_TERRAFORM_ROLE_ARN`.

If the GitHub Actions role already exists, import it before planning:

```powershell
terraform import aws_iam_role.github_actions_terraform vrdex-github-terraform
terraform import aws_iam_role_policy.github_actions_terraform vrdex-github-terraform:vrdex-terraform-ci
```

Apply this stack before enabling provider-backed CI plan/apply for `infra/terraform/profile-assets`. That stack needs the GitHub Actions role to manage both account-derived profile asset buckets, the Vercel OIDC identity provider, and both environment-specific Vercel runtime roles. If custom bucket or role names are set in `profile-assets`, set the matching names here before applying.

The hosted profile-assets stack previously used the Vercel team slug `basic-bit`.
`legacy_vercel_team_slugs` keeps Terraform CI authorized for that older OIDC
provider while `infra/terraform/profile-assets` state is migrated or imported to
the current `basicbit` provider. Remove the legacy slug after state no longer
references `oidc.vercel.com/basic-bit`.

## State Boundary

Do not commit local state, plans, or `terraform.tfvars`. The root `.gitignore` excludes them.

## Restream proof image permission

`enable_restream_proof_image_permissions` defaults false. Opting in creates the
`vrdex-restream-proof-image` role and its standalone inline policy. The role reuses
the existing GitHub OIDC provider and requires exact `StringEquals` matches for
STS audience `sts.amazonaws.com` and subject
`repo:${var.github_repository}:ref:refs/heads/main`. Its only permissions are registry
authentication and push/DescribeImages on the exact restream repository, plus
`ecr:BatchGetImage` and `ecr:GetDownloadUrlForLayer` on that same repository. These
two read actions let retries pull the immutable digest, verify all 13 packaged
sources and the source label on the runner, and regenerate missing provenance
without pushing again or needing a prior artifact. Source mismatch fails closed
before image code executes. It has no cross-repository, secret, ECS, IAM, Terraform
state or Route 53 permissions. The Terraform role's trust and policies are unchanged.

The main-only subject permits eligible jobs on that repository's main branch.
AWS IAM cannot directly restrict GitHub's arbitrary `job_workflow_ref` claim with
the default subject template. This configuration does not isolate one workflow;
that would require a separately reviewed GitHub OIDC subject-template change.

A reviewed owner plan/apply or bootstrap and import must establish the dedicated
role before dispatching `Restream proof image`. This change does not establish that
the role exists live. The historical ECR-only inline grant on `vrdex-github-terraform`
can be retired by a reviewed owner migration after the dedicated role is verified.
See [the rehearsal procedure](../../../docs/engineering/event-broadcast-rehearsal.md)
for import, migration and rollback. Run `terraform test` after `terraform init` to
check default-disabled and enabled plans, decoded trust and exact ECR permissions
with a mock AWS provider, without AWS credentials or apply.
