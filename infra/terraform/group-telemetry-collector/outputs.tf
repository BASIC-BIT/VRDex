output "repository_url" {
  value = aws_ecr_repository.worker.repository_url
}

output "cluster_name" {
  value = aws_ecs_cluster.worker.name
}

output "task_definition_arn" {
  value = aws_ecs_task_definition.worker.arn
}

output "deployment_gate_parameter" {
  value = aws_ssm_parameter.enabled.name
}
