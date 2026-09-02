output "repository_url" {
  value = aws_ecr_repository.worker.repository_url
}

output "cluster_name" {
  value = aws_ecs_cluster.worker.name
}

output "service_name" {
  value = var.enable_service ? aws_ecs_service.worker[0].name : null
}

output "container_image" {
  value = local.worker_image
}

output "release_sha" {
  value = var.release_sha
}

output "release_capabilities" {
  value = sort(var.release_capabilities)
}

output "task_definition_arn" {
  value = aws_ecs_task_definition.worker.arn
}

output "deployment_gate_parameter" {
  value = aws_ssm_parameter.enabled.name
}
