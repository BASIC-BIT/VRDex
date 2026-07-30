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

output "delegated_secret_arn_pattern" {
  description = "The only Secrets Manager names the adapter can read. Provision each community's credential under this prefix."
  value       = local.secret_arn_pattern
}
