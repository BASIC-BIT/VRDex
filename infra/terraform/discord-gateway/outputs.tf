output "repository_url" {
  value = aws_ecr_repository.gateway.repository_url
}

output "cluster_name" {
  value = aws_ecs_cluster.gateway.name
}

output "service_name" {
  value = try(aws_ecs_service.gateway[0].name, "")
}

output "task_definition_arn" {
  value = aws_ecs_task_definition.gateway.arn
}

output "execution_role_arn" {
  value = aws_iam_role.execution.arn
}

output "task_role_arn" {
  value = aws_iam_role.task.arn
}

output "secret_arns" {
  value = { for k, s in aws_secretsmanager_secret.gateway : k => s.arn }
}
