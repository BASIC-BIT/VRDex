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

Apply this stack before enabling provider-backed CI plan/apply for `infra/terraform/profile-assets`. That stack needs the GitHub Actions role to manage the private profile asset S3 bucket, the Vercel OIDC identity provider, and the Vercel profile asset runtime role.

## State Boundary

Do not commit local state, plans, or `terraform.tfvars`. The root `.gitignore` excludes them.
