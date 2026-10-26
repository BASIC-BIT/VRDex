mock_provider "aws" {
  mock_resource "aws_iam_role" {
    defaults = { arn = "arn:aws:iam::079358094174:role/mock-bridge-role" }
  }
  mock_data "aws_caller_identity" {
    defaults = { account_id = "079358094174" }
  }
  mock_data "aws_partition" {
    defaults = { partition = "aws", dns_suffix = "amazonaws.com" }
  }
  mock_data "aws_iam_policy_document" {
    defaults = { json = "{\"Version\":\"2012-10-17\",\"Statement\":[]}" }
  }
}

override_resource {
  target = aws_ecs_cluster.worker
  values = { arn = "arn:aws:ecs:us-east-1:079358094174:cluster/vrdex-restream-worker" }
}
override_resource {
  target = aws_iam_role.execution
  values = { arn = "arn:aws:iam::079358094174:role/vrdex-restream-worker-execution" }
}
override_resource {
  target = aws_iam_role.task
  values = { arn = "arn:aws:iam::079358094174:role/vrdex-restream-worker-task" }
}
override_resource {
  target = aws_s3_bucket.artifacts
  values = {
    arn    = "arn:aws:s3:::vrdex-restream-worker-079358094174-artifacts"
    bucket = "vrdex-restream-worker-079358094174-artifacts"
  }
}
override_resource {
  target = aws_ecr_repository.worker
  values = { arn = "arn:aws:ecr:us-east-1:079358094174:repository/vrdex-restream-worker" }
}
override_resource {
  target = aws_cloudwatch_log_group.worker
  values = { arn = "arn:aws:logs:us-east-1:079358094174:log-group:/aws/ecs/vrdex-restream-worker" }
}

override_resource {
  target = aws_cloudwatch_log_group.bridge
  values = { arn = "arn:aws:logs:us-east-1:079358094174:log-group:/aws/lambda/vrdex-restream-worker-event-bridge" }
}
override_resource {
  target = aws_lambda_function.bridge
  values = { arn = "arn:aws:lambda:us-east-1:079358094174:function:vrdex-restream-worker-event-bridge" }
}
override_resource {
  target = aws_cloudwatch_event_rule.bridge
  values = { arn = "arn:aws:events:us-east-1:079358094174:rule/vrdex-restream-worker-event-bridge" }
}

variables {
  event_media_bridge = {
    convex_url         = "https://production-example.convex.cloud"
    image              = "079358094174.dkr.ecr.us-east-1.amazonaws.com/vrdex-restream-worker@sha256:fa5515d574355d6a647ce8390285f62edec1ad4f7e6e98956230c0b1391c2548"
    bundle_key         = "event-media-bridge/sha256/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.zip"
    bundle_sha256      = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    token_secret_arn   = "arn:aws:secretsmanager:us-east-1:079358094174:secret:event-media/bridge-token-AbCdEf"
    credential_refs    = { "vrcdn:authorized-account" = "arn:aws:secretsmanager:us-east-1:079358094174:secret:event-media/output-AbCdEf" }
    subnet_ids         = ["subnet-0123456789abcdef0"]
    security_group_ids = ["sg-0123456789abcdef0"]
  }
}

run "default_disabled" {
  command = plan
  variables {
    event_media_bridge = null
  }
  assert {
    condition = (
      length(aws_lambda_function.bridge) == 0 &&
      length(aws_iam_role.bridge) == 0 &&
      length(aws_iam_role_policy.bridge) == 0 &&
      length(aws_iam_role_policy.bridge_worker_token) == 0 &&
      length(aws_cloudwatch_log_group.bridge) == 0 &&
      length(aws_cloudwatch_event_rule.bridge) == 0 &&
      length(aws_cloudwatch_event_target.bridge) == 0 &&
      length(aws_lambda_permission.bridge_schedule) == 0 &&
      length(aws_lambda_function_event_invoke_config.bridge) == 0 &&
      output.event_media_bridge_function_arn == null
    )
    error_message = "Default-off must add no dispatcher, schedule, logs or runtime grants."
  }
  assert {
    condition     = aws_ssm_parameter.hosted_worker_enabled.value == "false"
    error_message = "Default configuration must preserve the publication emergency switch."
  }
}

run "enabled_dispatcher_permissions_and_runtime" {
  command = apply
  variables {
    enable_event_media_bridge   = true
    kill_switch_enabled_default = true
  }
  assert {
    condition = jsondecode(aws_iam_role_policy.bridge[0].policy) == {
      Version = "2012-10-17"
      Statement = [
        {
          Sid      = "ReadBridgeToken", Effect = "Allow", Action = "secretsmanager:GetSecretValue"
          Resource = "arn:aws:secretsmanager:us-east-1:079358094174:secret:event-media/bridge-token-AbCdEf"
        },
        {
          Sid      = "WriteBridgeLogs", Effect = "Allow", Action = ["logs:CreateLogStream", "logs:PutLogEvents"]
          Resource = "arn:aws:logs:us-east-1:079358094174:log-group:/aws/lambda/vrdex-restream-worker-event-bridge:log-stream:*"
        },
        {
          Sid = "RegisterTaggedEventWorker", Effect = "Allow", Action = "ecs:RegisterTaskDefinition", Resource = "*"
          Condition = { StringEquals = {
            "aws:RequestTag/Project" = "VRDex", "aws:RequestTag/Component" = "event-media-worker", "aws:RequestTag/ManagedBy" = "event-media-ecs-bridge"
          } }
        },
        {
          Sid       = "TagRegisteredEventWorker", Effect = "Allow", Action = "ecs:TagResource"
          Resource  = "arn:aws:ecs:us-east-1:079358094174:task-definition/vrdex-event-media-worker-*:*"
          Condition = { StringEquals = { "ecs:CreateAction" = "RegisterTaskDefinition" } }
        },
        {
          Sid       = "RunEventWorkerInWorkerCluster", Effect = "Allow", Action = "ecs:RunTask"
          Resource  = "arn:aws:ecs:us-east-1:079358094174:task-definition/vrdex-event-media-worker-*:*"
          Condition = { ArnEquals = { "ecs:cluster" = "arn:aws:ecs:us-east-1:079358094174:cluster/vrdex-restream-worker" } }
        },
        {
          Sid       = "TagLaunchedEventWorker", Effect = "Allow", Action = "ecs:TagResource"
          Resource  = "arn:aws:ecs:us-east-1:079358094174:task/vrdex-restream-worker/*"
          Condition = { StringEquals = { "ecs:CreateAction" = "RunTask" } }
        },
        {
          Sid      = "ObserveAndStopOwnedEventWorkerTasks", Effect = "Allow", Action = ["ecs:DescribeTasks", "ecs:StopTask"]
          Resource = "arn:aws:ecs:us-east-1:079358094174:task/vrdex-restream-worker/*"
          Condition = {
            ArnEquals    = { "ecs:cluster" = "arn:aws:ecs:us-east-1:079358094174:cluster/vrdex-restream-worker" }
            StringEquals = { "aws:ResourceTag/ManagedBy" = "event-media-ecs-bridge" }
          }
        },
        {
          Sid = "DeregisterEventWorkerDefinition", Effect = "Allow", Action = "ecs:DeregisterTaskDefinition", Resource = "*"
        },
        {
          Sid       = "PassExistingWorkerRoles", Effect = "Allow", Action = "iam:PassRole"
          Resource  = ["arn:aws:iam::079358094174:role/vrdex-restream-worker-execution", "arn:aws:iam::079358094174:role/vrdex-restream-worker-task"]
          Condition = { StringEquals = { "iam:PassedToService" = "ecs-tasks.amazonaws.com" } }
        },
      ]
    }
    error_message = "Dispatcher permissions must retain exact token and logs, worker family, cluster, ownership tag and existing role scopes, with the AWS-required unconditioned deregistration wildcard."
  }
  assert {
    condition = jsondecode(aws_iam_role_policy.bridge_worker_token[0].policy) == {
      Version = "2012-10-17"
      Statement = [{
        Effect = "Allow", Action = "secretsmanager:GetSecretValue"
        Resource = [
          "arn:aws:secretsmanager:us-east-1:079358094174:secret:event-media/bridge-token-AbCdEf",
          "arn:aws:secretsmanager:us-east-1:079358094174:secret:event-media/output-AbCdEf",
        ]
      }]
    } && aws_iam_role_policy.bridge_worker_token[0].role == aws_iam_role.execution.id
    error_message = "Worker execution must read the exact token and configured output credentials without relying on rehearsal grants."
  }
  assert {
    condition = jsondecode(aws_iam_role.bridge[0].assume_role_policy) == {
      Version = "2012-10-17"
      Statement = [{
        Effect = "Allow", Action = "sts:AssumeRole", Principal = { Service = "lambda.amazonaws.com" }
      }]
    } && aws_iam_role_policy.bridge[0].role == aws_iam_role.bridge[0].id
    error_message = "Only Lambda may assume the dedicated dispatcher runtime role."
  }
  assert {
    condition = (
      length(aws_lambda_function.bridge) == 1 &&
      length(aws_iam_role.bridge) == 1 &&
      length(aws_iam_role_policy.bridge) == 1 &&
      length(aws_iam_role_policy.bridge_worker_token) == 1 &&
      length(aws_cloudwatch_log_group.bridge) == 1 &&
      length(aws_cloudwatch_event_rule.bridge) == 1 &&
      length(aws_cloudwatch_event_target.bridge) == 1 &&
      length(aws_lambda_permission.bridge_schedule) == 1 &&
      length(aws_lambda_function_event_invoke_config.bridge) == 1 &&
      aws_lambda_function.bridge[0].runtime == "nodejs22.x" &&
      aws_lambda_function.bridge[0].handler == "index.handler" &&
      aws_lambda_function.bridge[0].architectures == tolist(["x86_64"]) &&
      aws_lambda_function.bridge[0].memory_size == 256 &&
      aws_lambda_function.bridge[0].timeout == 180 &&
      aws_lambda_function.bridge[0].reserved_concurrent_executions == 1 &&
      aws_lambda_function.bridge[0].role == aws_iam_role.bridge[0].arn &&
      aws_lambda_function.bridge[0].s3_bucket == aws_s3_bucket.artifacts.bucket &&
      aws_lambda_function.bridge[0].s3_key == var.event_media_bridge.bundle_key &&
      output.event_media_bridge_function_arn == aws_lambda_function.bridge[0].arn
    )
    error_message = "The immutable Lambda ZIP must run index.handler on Node 22 x86_64 with 256 MiB, 180-second timeout and reserved concurrency one."
  }
  assert {
    condition = aws_lambda_function.bridge[0].environment[0].variables == tomap({
      CONVEX_URL                                = var.event_media_bridge.convex_url
      VRDEX_EVENT_MEDIA_ECS_REGION              = "us-east-1"
      VRDEX_EVENT_MEDIA_ECS_CLUSTER             = "arn:aws:ecs:us-east-1:079358094174:cluster/vrdex-restream-worker"
      VRDEX_EVENT_MEDIA_ECS_IMAGE               = var.event_media_bridge.image
      VRDEX_EVENT_MEDIA_ECS_EXECUTION_ROLE_ARN  = "arn:aws:iam::079358094174:role/vrdex-restream-worker-execution"
      VRDEX_EVENT_MEDIA_ECS_TASK_ROLE_ARN       = "arn:aws:iam::079358094174:role/vrdex-restream-worker-task"
      VRDEX_EVENT_MEDIA_ECS_LOG_GROUP           = "/aws/ecs/vrdex-restream-worker"
      VRDEX_EVENT_MEDIA_ECS_TASK_FAMILY_PREFIX  = "vrdex-event-media-worker"
      VRDEX_EVENT_MEDIA_ECS_CPU                 = "4096"
      VRDEX_EVENT_MEDIA_ECS_MEMORY              = "8192"
      VRDEX_EVENT_MEDIA_ECS_SUBNETS             = "subnet-0123456789abcdef0"
      VRDEX_EVENT_MEDIA_ECS_SECURITY_GROUPS     = "sg-0123456789abcdef0"
      VRDEX_EVENT_MEDIA_ECS_ASSIGN_PUBLIC_IP    = "ENABLED"
      VRDEX_EVENT_MEDIA_SECRET_REF_MAP_JSON     = jsonencode(var.event_media_bridge.credential_refs)
      VRDEX_EVENT_MEDIA_WORKER_TOKEN_SECRET_ARN = var.event_media_bridge.token_secret_arn
      VRDEX_EVENT_MEDIA_ECS_BASE_ENV_JSON = jsonencode({
        AWS_REGION                               = "us-east-1"
        VRDEX_RESTREAM_KILL_SWITCH_SSM_PARAMETER = "/vrdex/restream/hosted-worker/enabled"
        VRDEX_RESTREAM_MAX_SESSION_SECONDS       = "43200"
        VRDEX_RESTREAM_MAX_CONCURRENT_WORKERS    = "1"
      })
    })
    error_message = "Preserve exact worker settings and secret references without plaintext token, CLI, bootstrap, drain or dispatcher-deadline environment. Lambda supplies its reserved AWS_REGION itself."
  }
  assert {
    condition = (
      aws_cloudwatch_log_group.bridge[0].name == "/aws/lambda/vrdex-restream-worker-event-bridge" &&
      aws_cloudwatch_log_group.bridge[0].retention_in_days == var.log_retention_days &&
      aws_cloudwatch_event_rule.bridge[0].schedule_expression == "rate(1 minute)" &&
      aws_cloudwatch_event_rule.bridge[0].state == "ENABLED" &&
      aws_cloudwatch_event_target.bridge[0].rule == aws_cloudwatch_event_rule.bridge[0].name &&
      aws_cloudwatch_event_target.bridge[0].arn == aws_lambda_function.bridge[0].arn &&
      aws_cloudwatch_event_target.bridge[0].retry_policy[0].maximum_event_age_in_seconds == 60 &&
      aws_cloudwatch_event_target.bridge[0].retry_policy[0].maximum_retry_attempts == 0 &&
      aws_lambda_function_event_invoke_config.bridge[0].function_name == aws_lambda_function.bridge[0].function_name &&
      aws_lambda_function_event_invoke_config.bridge[0].maximum_event_age_in_seconds == 60 &&
      aws_lambda_function_event_invoke_config.bridge[0].maximum_retry_attempts == 0 &&
      aws_lambda_permission.bridge_schedule[0].action == "lambda:InvokeFunction" &&
      aws_lambda_permission.bridge_schedule[0].function_name == aws_lambda_function.bridge[0].function_name &&
      aws_lambda_permission.bridge_schedule[0].principal == "events.amazonaws.com" &&
      aws_lambda_permission.bridge_schedule[0].source_arn == aws_cloudwatch_event_rule.bridge[0].arn &&
      aws_lambda_permission.bridge_schedule[0].source_account == "079358094174" &&
      aws_ssm_parameter.hosted_worker_enabled.value == "true"
    )
    error_message = "Opt-in must enable the minute schedule with exact invocation permission, dedicated retained logs, both retry/age bounds and unchanged enabled emergency switch."
  }
}

run "custom_worker_network_and_log_retention" {
  command = apply
  variables {
    enable_event_media_bridge = true
    log_retention_days        = 30
    event_media_bridge = merge(var.event_media_bridge, {
      subnet_ids         = ["subnet-0123456789abcdef0", "subnet-abcdef01234567890"]
      security_group_ids = ["sg-0123456789abcdef0", "sg-abcdef01234567890"]
      assign_public_ip   = "DISABLED"
    })
  }
  assert {
    condition = (
      aws_lambda_function.bridge[0].environment[0].variables.VRDEX_EVENT_MEDIA_ECS_SUBNETS == "subnet-0123456789abcdef0,subnet-abcdef01234567890" &&
      aws_lambda_function.bridge[0].environment[0].variables.VRDEX_EVENT_MEDIA_ECS_SECURITY_GROUPS == "sg-0123456789abcdef0,sg-abcdef01234567890" &&
      aws_lambda_function.bridge[0].environment[0].variables.VRDEX_EVENT_MEDIA_ECS_ASSIGN_PUBLIC_IP == "DISABLED" &&
      aws_cloudwatch_log_group.bridge[0].retention_in_days == 30 &&
      aws_ssm_parameter.hosted_worker_enabled.value == "false"
    )
    error_message = "Owner networking and log retention must flow through, without changing a disabled publication switch."
  }
}

run "enabled_requires_owner_configuration" {
  command = plan
  variables {
    enable_event_media_bridge = true
    event_media_bridge        = null
  }
  expect_failures = [aws_lambda_function.bridge]
}

run "rejects_nonproduction_convex_url" {
  command = plan
  variables {
    enable_event_media_bridge = true
    event_media_bridge        = merge(var.event_media_bridge, { convex_url = "http://localhost:3210" })
  }
  expect_failures = [aws_lambda_function.bridge]
}

run "rejects_mutable_image" {
  command = plan
  variables {
    enable_event_media_bridge = true
    event_media_bridge        = merge(var.event_media_bridge, { image = "079358094174.dkr.ecr.us-east-1.amazonaws.com/vrdex-restream-worker:latest" })
  }
  expect_failures = [aws_lambda_function.bridge]
}

run "rejects_foreign_image_repository" {
  command = plan
  variables {
    enable_event_media_bridge = true
    event_media_bridge        = merge(var.event_media_bridge, { image = "079358094174.dkr.ecr.us-east-1.amazonaws.com/other@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" })
  }
  expect_failures = [aws_lambda_function.bridge]
}

run "rejects_unverified_bundle_key" {
  command = plan
  variables {
    enable_event_media_bridge = true
    event_media_bridge        = merge(var.event_media_bridge, { bundle_key = "event-media-bridge/latest.zip" })
  }
  expect_failures = [aws_lambda_function.bridge]
}

run "rejects_legacy_mjs_bundle" {
  command = plan
  variables {
    enable_event_media_bridge = true
    event_media_bridge        = merge(var.event_media_bridge, { bundle_key = "event-media-bridge/sha256/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.mjs" })
  }
  expect_failures = [aws_lambda_function.bridge]
}

run "rejects_mismatched_bundle_digest" {
  command = plan
  variables {
    enable_event_media_bridge = true
    event_media_bridge        = merge(var.event_media_bridge, { bundle_sha256 = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" })
  }
  expect_failures = [aws_lambda_function.bridge]
}

run "rejects_invalid_bundle_digest" {
  command = plan
  variables {
    enable_event_media_bridge = true
    event_media_bridge        = merge(var.event_media_bridge, { bundle_sha256 = "" })
  }
  expect_failures = [aws_lambda_function.bridge]
}

run "rejects_wildcard_token" {
  command = plan
  variables {
    enable_event_media_bridge = true
    event_media_bridge        = merge(var.event_media_bridge, { token_secret_arn = "arn:aws:secretsmanager:us-east-1:079358094174:secret:*" })
  }
  expect_failures = [aws_lambda_function.bridge]
}

run "rejects_foreign_account_token" {
  command = plan
  variables {
    enable_event_media_bridge = true
    event_media_bridge        = merge(var.event_media_bridge, { token_secret_arn = "arn:aws:secretsmanager:us-east-1:111111111111:secret:token-AbCdEf" })
  }
  expect_failures = [aws_lambda_function.bridge]
}

run "rejects_foreign_region_token" {
  command = plan
  variables {
    enable_event_media_bridge = true
    event_media_bridge        = merge(var.event_media_bridge, { token_secret_arn = "arn:aws:secretsmanager:us-west-2:079358094174:secret:token-AbCdEf" })
  }
  expect_failures = [aws_lambda_function.bridge]
}

run "rejects_empty_credentials" {
  command = plan
  variables {
    enable_event_media_bridge = true
    event_media_bridge        = merge(var.event_media_bridge, { credential_refs = {} })
  }
  expect_failures = [aws_lambda_function.bridge]
}

run "rejects_blank_credential_reference" {
  command = plan
  variables {
    enable_event_media_bridge = true
    event_media_bridge        = merge(var.event_media_bridge, { credential_refs = { " " = "arn:aws:secretsmanager:us-east-1:079358094174:secret:output-AbCdEf" } })
  }
  expect_failures = [aws_lambda_function.bridge]
}

run "rejects_wildcard_credentials" {
  command = plan
  variables {
    enable_event_media_bridge = true
    event_media_bridge        = merge(var.event_media_bridge, { credential_refs = { "vrcdn:authorized-account" = "arn:aws:secretsmanager:us-east-1:079358094174:secret:*" } })
  }
  expect_failures = [aws_lambda_function.bridge]
}

run "rejects_foreign_account_credentials" {
  command = plan
  variables {
    enable_event_media_bridge = true
    event_media_bridge        = merge(var.event_media_bridge, { credential_refs = { "vrcdn:authorized-account" = "arn:aws:secretsmanager:us-east-1:111111111111:secret:output-AbCdEf" } })
  }
  expect_failures = [aws_lambda_function.bridge]
}

run "rejects_foreign_region_credentials" {
  command = plan
  variables {
    enable_event_media_bridge = true
    event_media_bridge        = merge(var.event_media_bridge, { credential_refs = { "vrcdn:authorized-account" = "arn:aws:secretsmanager:us-west-2:079358094174:secret:output-AbCdEf" } })
  }
  expect_failures = [aws_lambda_function.bridge]
}

run "rejects_empty_subnets" {
  command = plan
  variables {
    enable_event_media_bridge = true
    event_media_bridge        = merge(var.event_media_bridge, { subnet_ids = [] })
  }
  expect_failures = [aws_lambda_function.bridge]
}

run "rejects_invalid_subnets" {
  command = plan
  variables {
    enable_event_media_bridge = true
    event_media_bridge        = merge(var.event_media_bridge, { subnet_ids = ["subnet-*"] })
  }
  expect_failures = [aws_lambda_function.bridge]
}

run "rejects_empty_security_groups" {
  command = plan
  variables {
    enable_event_media_bridge = true
    event_media_bridge        = merge(var.event_media_bridge, { security_group_ids = [] })
  }
  expect_failures = [aws_lambda_function.bridge]
}

run "rejects_invalid_security_groups" {
  command = plan
  variables {
    enable_event_media_bridge = true
    event_media_bridge        = merge(var.event_media_bridge, { security_group_ids = ["sg-*"] })
  }
  expect_failures = [aws_lambda_function.bridge]
}

run "rejects_invalid_public_ip_assignment" {
  command = plan
  variables {
    enable_event_media_bridge = true
    event_media_bridge        = merge(var.event_media_bridge, { assign_public_ip = "true" })
  }
  expect_failures = [aws_lambda_function.bridge]
}

run "rejects_increased_concurrency" {
  command = plan
  variables {
    enable_event_media_bridge = true
    max_concurrent_workers    = 2
  }
  expect_failures = [aws_lambda_function.bridge]
}
