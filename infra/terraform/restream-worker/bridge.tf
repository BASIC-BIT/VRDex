# Each scheduled invocation reconciles once; media workers own their lifetimes.
variable "enable_event_media_bridge" {
  description = "Provision and enable the opt-in minute event dispatcher schedule and exact runtime grants. Preserves the production emergency switch."
  type        = bool
  default     = false
}

variable "event_media_bridge" {
  description = "Owner-reviewed production configuration. Secret references only. Publish the Lambda ZIP with index.handler under its SHA256 key before enabling."
  type = object({
    convex_url         = string
    image              = string
    bundle_key         = string
    bundle_sha256      = string
    token_secret_arn   = string
    credential_refs    = map(string)
    subnet_ids         = list(string)
    security_group_ids = list(string)
    assign_public_ip   = optional(string, "ENABLED")
  })
  default = null
}

locals {
  bridge = var.event_media_bridge != null ? var.event_media_bridge : {
    convex_url      = "", image = "", bundle_key = "", bundle_sha256 = "", token_secret_arn = ""
    credential_refs = {}, subnet_ids = [], security_group_ids = [], assign_public_ip = "ENABLED"
  }
  bridge_worker_family_arn = "arn:${data.aws_partition.current.partition}:ecs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:task-definition/vrdex-event-media-worker-*:*"
  bridge_cluster_task_arn  = "arn:${data.aws_partition.current.partition}:ecs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:task/${aws_ecs_cluster.worker.name}/*"
  bridge_assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow", Action = "sts:AssumeRole", Principal = { Service = "lambda.amazonaws.com" }
    }]
  })
  bridge_environment = {
    CONVEX_URL                                = local.bridge.convex_url
    VRDEX_EVENT_MEDIA_ECS_REGION              = var.aws_region
    VRDEX_EVENT_MEDIA_ECS_CLUSTER             = aws_ecs_cluster.worker.arn
    VRDEX_EVENT_MEDIA_ECS_IMAGE               = local.bridge.image
    VRDEX_EVENT_MEDIA_ECS_EXECUTION_ROLE_ARN  = aws_iam_role.execution.arn
    VRDEX_EVENT_MEDIA_ECS_TASK_ROLE_ARN       = aws_iam_role.task.arn
    VRDEX_EVENT_MEDIA_ECS_LOG_GROUP           = aws_cloudwatch_log_group.worker.name
    VRDEX_EVENT_MEDIA_ECS_TASK_FAMILY_PREFIX  = "vrdex-event-media-worker"
    VRDEX_EVENT_MEDIA_ECS_CPU                 = "4096"
    VRDEX_EVENT_MEDIA_ECS_MEMORY              = "8192"
    VRDEX_EVENT_MEDIA_ECS_SUBNETS             = join(",", local.bridge.subnet_ids)
    VRDEX_EVENT_MEDIA_ECS_SECURITY_GROUPS     = join(",", local.bridge.security_group_ids)
    VRDEX_EVENT_MEDIA_ECS_ASSIGN_PUBLIC_IP    = local.bridge.assign_public_ip
    VRDEX_EVENT_MEDIA_SECRET_REF_MAP_JSON     = jsonencode(local.bridge.credential_refs)
    VRDEX_EVENT_MEDIA_WORKER_TOKEN_SECRET_ARN = local.bridge.token_secret_arn
    VRDEX_EVENT_MEDIA_ECS_BASE_ENV_JSON = jsonencode({
      AWS_REGION                               = var.aws_region
      VRDEX_RESTREAM_KILL_SWITCH_SSM_PARAMETER = aws_ssm_parameter.hosted_worker_enabled.name
      VRDEX_RESTREAM_MAX_SESSION_SECONDS       = "43200"
      VRDEX_RESTREAM_MAX_CONCURRENT_WORKERS    = "1"
    })
  }
}

resource "aws_iam_role" "bridge" {
  count              = var.enable_event_media_bridge ? 1 : 0
  name               = "${var.name_prefix}-event-bridge"
  assume_role_policy = local.bridge_assume_role_policy
  tags               = local.tags
}

resource "aws_iam_role_policy" "bridge" {
  count = var.enable_event_media_bridge ? 1 : 0
  name  = "event-media-bridge-runtime"
  role  = aws_iam_role.bridge[0].id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "ReadBridgeToken", Effect = "Allow", Action = "secretsmanager:GetSecretValue"
        Resource = local.bridge.token_secret_arn
      },
      {
        Sid      = "WriteBridgeLogs", Effect = "Allow", Action = ["logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "${aws_cloudwatch_log_group.bridge[0].arn}:log-stream:*"
      },
      {
        Sid = "RegisterTaggedEventWorker", Effect = "Allow", Action = "ecs:RegisterTaskDefinition", Resource = "*"
        Condition = { StringEquals = {
          "aws:RequestTag/Project" = "VRDex", "aws:RequestTag/Component" = "event-media-worker", "aws:RequestTag/ManagedBy" = "event-media-ecs-bridge"
        } }
      },
      {
        Sid       = "TagRegisteredEventWorker", Effect = "Allow", Action = "ecs:TagResource"
        Resource  = local.bridge_worker_family_arn
        Condition = { StringEquals = { "ecs:CreateAction" = "RegisterTaskDefinition" } }
      },
      {
        Sid       = "RunEventWorkerInWorkerCluster", Effect = "Allow", Action = "ecs:RunTask"
        Resource  = local.bridge_worker_family_arn
        Condition = { ArnEquals = { "ecs:cluster" = aws_ecs_cluster.worker.arn } }
      },
      {
        Sid       = "TagLaunchedEventWorker", Effect = "Allow", Action = "ecs:TagResource"
        Resource  = local.bridge_cluster_task_arn
        Condition = { StringEquals = { "ecs:CreateAction" = "RunTask" } }
      },
      {
        Sid      = "ObserveAndStopOwnedEventWorkerTasks", Effect = "Allow", Action = ["ecs:DescribeTasks", "ecs:StopTask"]
        Resource = local.bridge_cluster_task_arn
        Condition = {
          ArnEquals    = { "ecs:cluster" = aws_ecs_cluster.worker.arn }
          StringEquals = { "aws:ResourceTag/ManagedBy" = "event-media-ecs-bridge" }
        }
      },
      # AWS exposes no resource or condition scope for DeregisterTaskDefinition.
      # This account-wide permission trusts the owner-verified bridge bundle to
      # deregister only definitions it registered for event workers.
      {
        Sid = "DeregisterEventWorkerDefinition", Effect = "Allow", Action = "ecs:DeregisterTaskDefinition", Resource = "*"
      },
      {
        Sid       = "PassExistingWorkerRoles", Effect = "Allow", Action = "iam:PassRole"
        Resource  = [aws_iam_role.execution.arn, aws_iam_role.task.arn]
        Condition = { StringEquals = { "iam:PassedToService" = "ecs-tasks.amazonaws.com" } }
      },
    ]
  })
}

resource "aws_iam_role_policy" "bridge_worker_token" {
  count = var.enable_event_media_bridge ? 1 : 0
  name  = "read-event-media-worker-startup-secrets"
  role  = aws_iam_role.execution.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow", Action = "secretsmanager:GetSecretValue"
      Resource = sort(distinct(concat([local.bridge.token_secret_arn], values(local.bridge.credential_refs))))
    }]
  })
}

resource "aws_cloudwatch_log_group" "bridge" {
  count             = var.enable_event_media_bridge ? 1 : 0
  name              = "/aws/lambda/${var.name_prefix}-event-bridge"
  retention_in_days = var.log_retention_days
  tags              = local.tags
}

resource "aws_lambda_function" "bridge" {
  count                          = var.enable_event_media_bridge ? 1 : 0
  function_name                  = "${var.name_prefix}-event-bridge"
  role                           = aws_iam_role.bridge[0].arn
  runtime                        = "nodejs22.x"
  handler                        = "index.handler"
  architectures                  = ["x86_64"]
  memory_size                    = 256
  timeout                        = 180
  reserved_concurrent_executions = 1
  s3_bucket                      = aws_s3_bucket.artifacts.bucket
  # The immutable ZIP key changes with the artifact SHA. source_code_hash accepts
  # base64 SHA256, not this owner's hex digest. Verify deployed CodeSha256 at rollout.
  s3_key = local.bridge.bundle_key
  tags   = local.tags
  environment {
    variables = local.bridge_environment
  }
  depends_on = [aws_iam_role_policy.bridge, aws_cloudwatch_log_group.bridge]
  lifecycle {
    precondition {
      condition = (
        can(regex("^https://[a-z0-9-]+\\.convex\\.cloud$", local.bridge.convex_url)) &&
        can(regex("^${data.aws_caller_identity.current.account_id}\\.dkr\\.ecr\\.${var.aws_region}\\.amazonaws\\.com/${var.name_prefix}@sha256:[a-f0-9]{64}$", local.bridge.image)) &&
        can(regex("^[a-f0-9]{64}$", local.bridge.bundle_sha256)) &&
        local.bridge.bundle_key == "event-media-bridge/sha256/${local.bridge.bundle_sha256}.zip" &&
        can(regex("^arn:${data.aws_partition.current.partition}:secretsmanager:${var.aws_region}:${data.aws_caller_identity.current.account_id}:secret:[A-Za-z0-9/_+=.@-]+$", local.bridge.token_secret_arn)) &&
        length(local.bridge.credential_refs) > 0 &&
        alltrue([for ref, arn in local.bridge.credential_refs : trimspace(ref) != "" && can(regex("^arn:${data.aws_partition.current.partition}:secretsmanager:${var.aws_region}:${data.aws_caller_identity.current.account_id}:secret:[A-Za-z0-9/_+=.@-]+$", arn))]) &&
        length(local.bridge.subnet_ids) > 0 && alltrue([for id in local.bridge.subnet_ids : can(regex("^subnet-[a-f0-9]+$", id))]) &&
        length(local.bridge.security_group_ids) > 0 && alltrue([for id in local.bridge.security_group_ids : can(regex("^sg-[a-f0-9]+$", id))]) &&
        contains(["ENABLED", "DISABLED"], local.bridge.assign_public_ip) &&
        var.max_concurrent_workers == 1
      )
      error_message = "Bridge enablement requires a production Convex URL, existing-repository digest image, SHA256-addressed Lambda ZIP, exact token and credential secret ARNs, networking, and concurrency cap 1."
    }
  }
}

# Bound both scheduler delivery and Lambda's asynchronous queue. A later tick
# discovers current work instead of replaying a failed or stale invocation.
resource "aws_lambda_function_event_invoke_config" "bridge" {
  count                        = var.enable_event_media_bridge ? 1 : 0
  function_name                = aws_lambda_function.bridge[0].function_name
  maximum_event_age_in_seconds = 60
  maximum_retry_attempts       = 0
}

resource "aws_cloudwatch_event_rule" "bridge" {
  count               = var.enable_event_media_bridge ? 1 : 0
  name                = "${var.name_prefix}-event-bridge"
  description         = "Reconcile event media workers once per minute."
  schedule_expression = "rate(1 minute)"
  state               = "ENABLED"
  tags                = local.tags
}

resource "aws_lambda_permission" "bridge_schedule" {
  count          = var.enable_event_media_bridge ? 1 : 0
  statement_id   = "AllowEventBridgeSchedule"
  action         = "lambda:InvokeFunction"
  function_name  = aws_lambda_function.bridge[0].function_name
  principal      = "events.amazonaws.com"
  source_arn     = aws_cloudwatch_event_rule.bridge[0].arn
  source_account = data.aws_caller_identity.current.account_id
}

resource "aws_cloudwatch_event_target" "bridge" {
  count     = var.enable_event_media_bridge ? 1 : 0
  rule      = aws_cloudwatch_event_rule.bridge[0].name
  target_id = "event-media-bridge"
  arn       = aws_lambda_function.bridge[0].arn
  retry_policy {
    maximum_event_age_in_seconds = 60
    maximum_retry_attempts       = 0
  }
  depends_on = [aws_lambda_permission.bridge_schedule, aws_lambda_function_event_invoke_config.bridge]
}

output "event_media_bridge_function_arn" {
  description = "Singleton dispatcher invoked by the enabled minute schedule; media workers retain their own session lifetimes."
  value       = try(aws_lambda_function.bridge[0].arn, null)
}
