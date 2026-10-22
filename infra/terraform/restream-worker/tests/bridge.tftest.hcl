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

variables {
  event_media_bridge = {
    convex_url         = "https://production-example.convex.cloud"
    image              = "079358094174.dkr.ecr.us-east-1.amazonaws.com/vrdex-restream-worker@sha256:fa5515d574355d6a647ce8390285f62edec1ad4f7e6e98956230c0b1391c2548"
    bundle_key         = "event-media-bridge/sha256/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.mjs"
    bundle_sha256      = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    token_secret_arn   = "arn:aws:secretsmanager:us-east-1:079358094174:secret:event-media/bridge-token-AbCdEf"
    credential_refs    = { "vrcdn:authorized-account" = "arn:aws:secretsmanager:us-east-1:079358094174:secret:event-media/output-AbCdEf" }
    subnet_ids         = ["subnet-0123456789abcdef0"]
    security_group_ids = ["sg-0123456789abcdef0"]
  }
}

run "default_disabled" {
  command = plan
  assert {
    condition = (
      length(aws_ecs_task_definition.bridge) == 0 &&
      length(aws_iam_role.bridge_task) == 0 &&
      length(aws_iam_role.bridge_execution) == 0 &&
      length(aws_iam_role_policy.bridge_task) == 0 &&
      length(aws_iam_role_policy.bridge_execution) == 0 &&
      length(aws_iam_role_policy.bridge_worker_token) == 0
    )
    error_message = "Default-off configuration must add no bridge resources or permissions."
  }
  assert {
    condition     = aws_ssm_parameter.hosted_worker_enabled.value == "false"
    error_message = "Provisioning the bridge must not enable the production switch."
  }
}

run "enabled_dispatcher_permissions" {
  command = apply
  variables {
    enable_event_media_bridge = true
  }
  assert {
    condition = jsondecode(aws_iam_role_policy.bridge_task[0].policy) == {
      Version = "2012-10-17"
      Statement = [
        {
          Sid      = "ReadVerifiedBridgeBundle", Effect = "Allow", Action = "s3:GetObject"
          Resource = "arn:aws:s3:::vrdex-restream-worker-079358094174-artifacts/event-media-bridge/sha256/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.mjs"
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
          Sid       = "ObserveAndStopWorkerClusterTasks", Effect = "Allow", Action = ["ecs:DescribeTasks", "ecs:StopTask"]
          Resource  = "arn:aws:ecs:us-east-1:079358094174:task/vrdex-restream-worker/*"
          Condition = { ArnEquals = { "ecs:cluster" = "arn:aws:ecs:us-east-1:079358094174:cluster/vrdex-restream-worker" } }
        },
        {
          Sid       = "DeregisterOwnedEventWorker", Effect = "Allow", Action = "ecs:DeregisterTaskDefinition"
          Resource  = "arn:aws:ecs:us-east-1:079358094174:task-definition/vrdex-event-media-worker-*:*"
          Condition = { StringEquals = { "aws:ResourceTag/ManagedBy" = "event-media-ecs-bridge" } }
        },
        {
          Sid       = "PassExistingWorkerRoles", Effect = "Allow", Action = "iam:PassRole"
          Resource  = ["arn:aws:iam::079358094174:role/vrdex-restream-worker-execution", "arn:aws:iam::079358094174:role/vrdex-restream-worker-task"]
          Condition = { StringEquals = { "iam:PassedToService" = "ecs-tasks.amazonaws.com" } }
        },
      ]
    }
    error_message = "Dispatcher permissions must be limited to the exact bundle, worker family, worker cluster, owned definitions and existing worker roles."
  }
  assert {
    condition = alltrue([for role in [aws_iam_role.bridge_task[0], aws_iam_role.bridge_execution[0]] : jsondecode(role.assume_role_policy) == {
      Version = "2012-10-17"
      Statement = [{
        Effect = "Allow", Action = "sts:AssumeRole", Principal = { Service = "ecs-tasks.amazonaws.com" }
        Condition = {
          StringEquals = { "aws:SourceAccount" = "079358094174" }
          ArnLike      = { "aws:SourceArn" = "arn:aws:ecs:us-east-1:079358094174:*" }
        }
      }]
    }])
    error_message = "Both dedicated roles must trust only ECS tasks from this AWS account."
  }
  assert {
    condition = jsondecode(aws_iam_role_policy.bridge_execution[0].policy) == {
      Version = "2012-10-17"
      Statement = [
        { Sid = "RegistryAuthentication", Effect = "Allow", Action = "ecr:GetAuthorizationToken", Resource = "*" },
        {
          Sid      = "PullExistingWorkerImage", Effect = "Allow"
          Action   = ["ecr:BatchCheckLayerAvailability", "ecr:GetDownloadUrlForLayer", "ecr:BatchGetImage"]
          Resource = "arn:aws:ecr:us-east-1:079358094174:repository/vrdex-restream-worker"
        },
        {
          Sid      = "WriteBridgeLogs", Effect = "Allow", Action = ["logs:CreateLogStream", "logs:PutLogEvents"]
          Resource = "arn:aws:logs:us-east-1:079358094174:log-group:/aws/ecs/vrdex-restream-worker:log-stream:bridge/*"
        },
        {
          Sid      = "ReadBridgeToken", Effect = "Allow", Action = "secretsmanager:GetSecretValue"
          Resource = "arn:aws:secretsmanager:us-east-1:079358094174:secret:event-media/bridge-token-AbCdEf"
        },
      ]
    }
    error_message = "Execution may only pull the existing repository, write bridge log streams and read the one bridge token."
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
    condition = (
      aws_ecs_task_definition.bridge[0].requires_compatibilities == toset(["FARGATE"]) &&
      aws_ecs_task_definition.bridge[0].network_mode == "awsvpc" &&
      aws_ecs_task_definition.bridge[0].cpu == "256" && aws_ecs_task_definition.bridge[0].memory == "512" &&
      jsondecode(aws_ecs_task_definition.bridge[0].container_definitions)[0].image == var.event_media_bridge.image &&
      jsondecode(aws_ecs_task_definition.bridge[0].container_definitions)[0].secrets == [{
        name = "VRDEX_EVENT_MEDIA_BRIDGE_TOKEN", valueFrom = var.event_media_bridge.token_secret_arn
      }] &&
      !contains([for entry in jsondecode(aws_ecs_task_definition.bridge[0].container_definitions)[0].environment : entry.name], "VRDEX_EVENT_MEDIA_BRIDGE_TOKEN")
    )
    error_message = "The bounded Fargate bridge must use the pinned image and inject the token only through ECS secrets."
  }
  assert {
    condition = alltrue([for name, value in {
      VRDEX_EVENT_MEDIA_ECS_CPU                = "4096"
      VRDEX_EVENT_MEDIA_ECS_MEMORY             = "8192"
      VRDEX_EVENT_MEDIA_ECS_TASK_FAMILY_PREFIX = "vrdex-event-media-worker"
      VRDEX_EVENT_MEDIA_ECS_SUBNETS            = "subnet-0123456789abcdef0"
      VRDEX_EVENT_MEDIA_ECS_SECURITY_GROUPS    = "sg-0123456789abcdef0"
      VRDEX_EVENT_MEDIA_SECRET_REF_MAP_JSON    = jsonencode(var.event_media_bridge.credential_refs)
      VRDEX_EVENT_MEDIA_ECS_BASE_ENV_JSON = jsonencode({
        AWS_REGION                               = "us-east-1"
        VRDEX_RESTREAM_KILL_SWITCH_SSM_PARAMETER = "/vrdex/restream/hosted-worker/enabled"
        VRDEX_RESTREAM_MAX_SESSION_SECONDS       = "43200"
        VRDEX_RESTREAM_MAX_CONCURRENT_WORKERS    = "1"
      })
    } : { for entry in jsondecode(aws_ecs_task_definition.bridge[0].container_definitions)[0].environment : entry.name => entry.value }[name] == value])
    error_message = "Dynamic workers must inherit explicit measured resources, production fencing, 12-hour session bound, cap one and exact owner networking/credential references."
  }
  assert {
    condition = (
      jsondecode(aws_ecs_task_definition.bridge[0].container_definitions)[0].entryPoint == ["/bin/sh", "-ec"] &&
      strcontains(jsondecode(aws_ecs_task_definition.bridge[0].container_definitions)[0].command[0], "exec timeout --signal=TERM --kill-after=30s 86400s /bin/sh -ec") &&
      strcontains(jsondecode(aws_ecs_task_definition.bridge[0].container_definitions)[0].command[0], "sha256sum --check --status") &&
      strcontains(jsondecode(aws_ecs_task_definition.bridge[0].container_definitions)[0].command[0], "while [ \"$attempt\" -lt 10 ]") &&
      !can(jsondecode(aws_ecs_task_definition.bridge[0].container_definitions)[0].restartPolicy) &&
      aws_ssm_parameter.hosted_worker_enabled.value == "false"
    )
    error_message = "The whole bootstrap/retry process needs one 24-hour deadline, verified bundle and no container restart or automatic switch enablement."
  }
}

run "enabled_requires_owner_configuration" {
  command = plan
  variables {
    enable_event_media_bridge = true
    event_media_bridge        = null
  }
  expect_failures = [aws_ecs_task_definition.bridge]
}

run "rejects_mutable_image" {
  command = plan
  variables {
    enable_event_media_bridge = true
    event_media_bridge        = merge(var.event_media_bridge, { image = "079358094174.dkr.ecr.us-east-1.amazonaws.com/vrdex-restream-worker:latest" })
  }
  expect_failures = [aws_ecs_task_definition.bridge]
}

run "rejects_unverified_bundle_key" {
  command = plan
  variables {
    enable_event_media_bridge = true
    event_media_bridge        = merge(var.event_media_bridge, { bundle_key = "event-media-bridge/latest.mjs" })
  }
  expect_failures = [aws_ecs_task_definition.bridge]
}

run "rejects_wildcard_credentials" {
  command = plan
  variables {
    enable_event_media_bridge = true
    event_media_bridge        = merge(var.event_media_bridge, { credential_refs = { "vrcdn:authorized-account" = "arn:aws:secretsmanager:us-east-1:079358094174:secret:*" } })
  }
  expect_failures = [aws_ecs_task_definition.bridge]
}

run "rejects_increased_concurrency" {
  command = plan
  variables {
    enable_event_media_bridge = true
    max_concurrent_workers    = 2
  }
  expect_failures = [aws_ecs_task_definition.bridge]
}
