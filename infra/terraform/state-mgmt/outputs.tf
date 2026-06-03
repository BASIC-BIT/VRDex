output "state_bucket_name" {
  description = "S3 bucket name used by VRDex Terraform stacks for remote state."
  value       = aws_s3_bucket.terraform_state.id
}

output "state_bucket_region" {
  description = "AWS region for the Terraform state bucket."
  value       = var.aws_region
}
