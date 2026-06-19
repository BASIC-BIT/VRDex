output "profile_asset_bucket_name" {
  description = "Private S3 bucket for VRDex profile media-kit assets."
  value       = aws_s3_bucket.profile_assets.bucket
}

output "profile_asset_bucket_region" {
  description = "AWS region for the private profile asset bucket."
  value       = var.aws_region
}

output "profile_asset_runtime_role_arn" {
  description = "IAM role ARN Vercel functions assume through OIDC for profile asset S3 access."
  value       = aws_iam_role.vercel_profile_assets.arn
}

output "managed_profile_asset_environment_keys" {
  description = "Vercel environment variable names managed by this stack for profile asset storage."
  value       = keys(local.runtime_env_values)
}
