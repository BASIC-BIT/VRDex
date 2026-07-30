output "function_url" {
  description = "Set this as VRCLINKING_PROOF_ADAPTER_URL in Convex. Empty until enable_service is true."
  value       = var.enable_service ? aws_lambda_function_url.adapter[0].function_url : ""
}

output "function_name" {
  description = "Lambda function name, for logs and manual invocation."
  value       = var.enable_service ? aws_lambda_function.adapter[0].function_name : ""
}

output "role_arn" {
  description = "Execution role. Attach nothing else to it; it can read every delegated credential."
  value       = aws_iam_role.adapter.arn
}

output "aws_region" {
  description = "Region every rotation command must target. The AWS CLI otherwise uses the operator shell's region, which can miss the secret entirely or act on a same-named function elsewhere."
  value       = var.aws_region
}

output "shared_secret_arn" {
  description = "The shared-secret object the rotation runbook writes. An identifier, not a value — the secret itself is never in Terraform state."
  value       = var.shared_secret_arn
}

output "delegated_secret_arn_pattern" {
  description = "The only Secrets Manager names the adapter can read. Provision each community's credential under this prefix."
  value       = local.secret_arn_pattern
}
