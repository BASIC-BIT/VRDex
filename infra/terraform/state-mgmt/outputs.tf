output "state_bucket_name" {
  description = "S3 bucket name used by VRDex Terraform stacks for remote state."
  value       = aws_s3_bucket.terraform_state.id
}

output "state_bucket_region" {
  description = "AWS region for the Terraform state bucket."
  value       = var.aws_region
}

output "github_actions_terraform_role_arn" {
  description = "IAM role ARN for GitHub Actions Terraform plan/apply. Store this in GitHub variable AWS_TERRAFORM_ROLE_ARN."
  value       = aws_iam_role.github_actions_terraform.arn
}
