# Terraform State Bootstrap

This bootstrap stack manages the S3 bucket used by the other VRDex Terraform stacks for remote state.

It intentionally uses local Terraform state. Do not configure this stack to use the S3 backend it manages.

## Managed Resources

- S3 bucket `vrdex-terraform-state`
- S3 public access block
- S3 default SSE-S3 encryption
- S3 versioning
- S3 bucket policy that denies non-TLS requests

The application stacks use S3 native lockfiles through `use_lockfile = true`; no DynamoDB lock table is required.

## Usage

1. Copy `terraform.tfvars.example` to `terraform.tfvars`.
2. Run `terraform init`.
3. If the bucket already exists, import the resources before the first plan:

```powershell
terraform import aws_s3_bucket.terraform_state vrdex-terraform-state
terraform import aws_s3_bucket_public_access_block.terraform_state vrdex-terraform-state
terraform import aws_s3_bucket_server_side_encryption_configuration.terraform_state vrdex-terraform-state
terraform import aws_s3_bucket_versioning.terraform_state vrdex-terraform-state
terraform import aws_s3_bucket_policy.terraform_state vrdex-terraform-state
```

- Run `terraform plan` and review any drift.
- Apply only after confirming the target bucket and AWS account.

## State Boundary

Do not commit local state, plans, or `terraform.tfvars`. The root `.gitignore` excludes them.
