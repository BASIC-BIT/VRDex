mock_provider "aws" {
  mock_data "aws_sns_topic" {
    defaults = { arn = "arn:aws:sns:us-east-1:079358094174:vrdex-group-telemetry-alerts" }
  }
  mock_data "aws_subnet" {
    defaults = {
      id     = "subnet-0123456789abcdef0"
      vpc_id = "vpc-0123456789abcdef0"
    }
  }
  mock_data "aws_iam_policy_document" {
    defaults = { json = "{\"Version\":\"2012-10-17\",\"Statement\":[]}" }
  }
  mock_resource "aws_iam_role" {
    defaults = { arn = "arn:aws:iam::079358094174:role/mock-gateway-role" }
  }
}

override_resource {
  target = aws_ecs_cluster.gateway
  values = { name = "vrdex-discord-gateway" }
}

variables {
  enable_service  = true
  container_image = "079358094174.dkr.ecr.us-east-1.amazonaws.com/vrdex-discord-gateway@sha256:fa5515d574355d6a647ce8390285f62edec1ad4f7e6e98956230c0b1391c2548"
  convex_site_url = "https://example-123.convex.site"
}

run "default_disabled" {
  command = plan
  variables {
    enable_service  = false
    container_image = null
    convex_site_url = ""
  }
  assert {
    condition     = length(aws_ecs_service.gateway) == 0 && length(aws_cloudwatch_metric_alarm.running_tasks) == 0
    error_message = "Disabled must create no service and no alarm."
  }
  assert {
    condition     = sort(keys(aws_secretsmanager_secret.gateway)) == tolist(["DISCORD_APPLICATION_ID", "DISCORD_BOT_TOKEN", "DISCORD_INTAKE_SECRET"])
    error_message = "The three gateway secrets exist even while disabled, so values can be set before enabling."
  }
}

run "task_role_has_no_permissions" {
  command = apply
  assert {
    condition     = length(aws_iam_role_policies_exclusive.task.policy_names) == 0 && length(aws_iam_role_policy_attachments_exclusive.task.policy_arns) == 0
    error_message = "The task role must hold no inline or managed policies."
  }
  assert {
    condition     = aws_iam_role_policy.execution_secrets.role == aws_iam_role.execution.id
    error_message = "Secret reads belong to the execution role only."
  }
}

run "execution_reads_only_gateway_secrets" {
  command = apply
  assert {
    condition = jsonencode(jsondecode(aws_iam_role_policy.execution_secrets.policy)) == jsonencode({
      Version   = "2012-10-17"
      Statement = [{ Sid = "ReadGatewaySecrets", Effect = "Allow", Action = "secretsmanager:GetSecretValue", Resource = sort([for s in aws_secretsmanager_secret.gateway : s.arn]) }]
    })
    error_message = "Execution role may read exactly the three gateway secrets."
  }
  assert {
    condition     = [for s in jsondecode(aws_ecs_task_definition.gateway.container_definitions)[0].secrets : s.name] == ["DISCORD_APPLICATION_ID", "DISCORD_BOT_TOKEN", "DISCORD_INTAKE_SECRET"] && jsondecode(aws_ecs_task_definition.gateway.container_definitions)[0].environment == [{ name = "CONVEX_SITE_URL", value = "https://example-123.convex.site" }]
    error_message = "Container env must be CONVEX_SITE_URL plus the three secrets."
  }
  assert {
    condition     = jsondecode(aws_ecs_task_definition.gateway.container_definitions)[0].linuxParameters.initProcessEnabled == true
    error_message = "The container needs an init process, or every release waits out the stop timeout and SIGKILLs node."
  }
}

run "enabled_service_alarm_and_network" {
  command = apply
  assert {
    condition = (
      aws_cloudwatch_metric_alarm.running_tasks[0].alarm_actions == toset(["arn:aws:sns:us-east-1:079358094174:vrdex-group-telemetry-alerts"]) &&
      aws_cloudwatch_metric_alarm.running_tasks[0].ok_actions == toset(["arn:aws:sns:us-east-1:079358094174:vrdex-group-telemetry-alerts"]) &&
      aws_cloudwatch_metric_alarm.running_tasks[0].metric_name == "RunningTaskCount" &&
      aws_cloudwatch_metric_alarm.running_tasks[0].statistic == "Maximum" &&
      aws_cloudwatch_metric_alarm.running_tasks[0].threshold == 1 &&
      aws_cloudwatch_metric_alarm.running_tasks[0].period == 300 &&
      aws_cloudwatch_metric_alarm.running_tasks[0].evaluation_periods == 1 &&
      aws_cloudwatch_metric_alarm.running_tasks[0].treat_missing_data == "breaching"
    )
    error_message = "The running-task alarm must email through the existing alerts topic, fire only after a full five minutes with no running task, and treat no data as breaching."
  }
  assert {
    condition     = aws_ecs_service.gateway[0].desired_count == 1 && aws_ecs_service.gateway[0].deployment_minimum_healthy_percent == 0 && aws_ecs_service.gateway[0].deployment_maximum_percent == 100
    error_message = "Exactly one gateway task, and never two during a deploy."
  }
  assert {
    condition     = length(aws_security_group.gateway.ingress) == 0 && one(aws_security_group.gateway.egress).from_port == 443 && one(aws_security_group.gateway.egress).to_port == 443 && aws_ecs_service.gateway[0].network_configuration[0].assign_public_ip == false
    error_message = "Outbound HTTPS only, no ingress, no public IP."
  }
}

run "rejects_mutable_image" {
  command = plan
  variables { container_image = "079358094174.dkr.ecr.us-east-1.amazonaws.com/vrdex-discord-gateway:latest" }
  expect_failures = [var.container_image]
}

run "rejects_http_convex_site_url" {
  command = plan
  variables { convex_site_url = "http://example-123.convex.site" }
  expect_failures = [var.convex_site_url]
}
