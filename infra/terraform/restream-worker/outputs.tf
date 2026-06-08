output "ecr_repository_url" {
  description = "ECR repository URL for the restream worker image."
  value       = aws_ecr_repository.worker.repository_url
}

output "ecs_cluster_name" {
  description = "ECS cluster name for one-task-per-event restream worker benchmarks."
  value       = aws_ecs_cluster.worker.name
}

output "task_definition_arn" {
  description = "Fargate task definition ARN for hosted restream worker benchmarks."
  value       = aws_ecs_task_definition.worker.arn
}

output "log_group_name" {
  description = "CloudWatch log group for restream worker logs."
  value       = aws_cloudwatch_log_group.worker.name
}

output "kill_switch_parameter_name" {
  description = "SSM parameter name workers must read before running hosted output."
  value       = aws_ssm_parameter.hosted_worker_enabled.name
}
