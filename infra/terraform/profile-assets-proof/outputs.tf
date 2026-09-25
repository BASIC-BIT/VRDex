output "proof_bucket_name" {
  description = "Dedicated S3 bucket for local media upload proof."
  value       = aws_s3_bucket.proof.bucket
}

output "proof_bucket_region" {
  description = "AWS region for the dedicated proof bucket."
  value       = "us-east-1"
}

output "proof_object_prefix" {
  description = "Only this prefix receives the seven-day object expiration rule."
  value       = local.proof_prefix
}
