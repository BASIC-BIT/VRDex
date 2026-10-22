# A manually launched, bounded dispatcher. No ECS service restarts it after expiry.
variable "enable_event_media_bridge" {
  description = "Provision the opt-in 24-hour event dispatcher task definition and exact runtime grants. Does not start a task or enable the production switch."
  type        = bool
  default     = false
}

variable "event_media_bridge" {
  description = "Owner-reviewed production configuration. Secret references only. Publish the standalone bridge JS bundle under its SHA256 key before launching."
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
      Effect = "Allow", Action = "sts:AssumeRole", Principal = { Service = "ecs-tasks.amazonaws.com" }
      Condition = {
        StringEquals = { "aws:SourceAccount" = data.aws_caller_identity.current.account_id }
        ArnLike      = { "aws:SourceArn" = "arn:${data.aws_partition.current.partition}:ecs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:*" }
      }
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
    VRDEX_EVENT_MEDIA_BRIDGE_BUNDLE_S3_URI = "s3://${aws_s3_bucket.artifacts.bucket}/${local.bridge.bundle_key}"
    VRDEX_EVENT_MEDIA_BRIDGE_BUNDLE_SHA256 = local.bridge.bundle_sha256
    AWS_REGION                             = var.aws_region
  }
  # timeout owns the complete process group, including retries and download.
  # Validate static config once. Retry a failed control-plane connection at most
  # ten times; the outer deadline never renews when a child exits.
  bridge_command = <<-SHELL
    exec timeout --signal=TERM --kill-after=30s 86400s /bin/sh -ec '
      aws s3 cp "$VRDEX_EVENT_MEDIA_BRIDGE_BUNDLE_S3_URI" /tmp/event-media-ecs-bridge.mjs --only-show-errors
      printf "%s  %s\n" "$VRDEX_EVENT_MEDIA_BRIDGE_BUNDLE_SHA256" /tmp/event-media-ecs-bridge.mjs | sha256sum --check --status
      VRDEX_EVENT_MEDIA_ECS_BRIDGE_CONFIG_CHECK_ONLY=true node /tmp/event-media-ecs-bridge.mjs
      attempt=0
      while [ "$attempt" -lt 10 ]; do
        node /tmp/event-media-ecs-bridge.mjs && exit 0
        attempt=$((attempt + 1))
        if [ "$attempt" -lt 10 ]; then sleep 30; fi
      done
      exit 1
    '
  SHELL
}

resource "aws_iam_role" "bridge_task" {
  count              = var.enable_event_media_bridge ? 1 : 0
  name               = "${var.name_prefix}-event-bridge-task"
  assume_role_policy = local.bridge_assume_role_policy
  tags               = local.tags
}

resource "aws_iam_role" "bridge_execution" {
  count              = var.enable_event_media_bridge ? 1 : 0
  name               = "${var.name_prefix}-event-bridge-execution"
  assume_role_policy = local.bridge_assume_role_policy
  tags               = local.tags
}

resource "aws_iam_role_policy" "bridge_task" {
  count = var.enable_event_media_bridge ? 1 : 0
  name  = "event-media-bridge-runtime"
  role  = aws_iam_role.bridge_task[0].id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "ReadVerifiedBridgeBundle", Effect = "Allow", Action = "s3:GetObject"
        Resource = "${aws_s3_bucket.artifacts.arn}/${local.bridge.bundle_key}"
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
        Sid       = "ObserveAndStopWorkerClusterTasks", Effect = "Allow", Action = ["ecs:DescribeTasks", "ecs:StopTask"]
        Resource  = local.bridge_cluster_task_arn
        Condition = { ArnEquals = { "ecs:cluster" = aws_ecs_cluster.worker.arn } }
      },
      {
        Sid       = "DeregisterOwnedEventWorker", Effect = "Allow", Action = "ecs:DeregisterTaskDefinition"
        Resource  = local.bridge_worker_family_arn
        Condition = { StringEquals = { "aws:ResourceTag/ManagedBy" = "event-media-ecs-bridge" } }
      },
      {
        Sid       = "PassExistingWorkerRoles", Effect = "Allow", Action = "iam:PassRole"
        Resource  = [aws_iam_role.execution.arn, aws_iam_role.task.arn]
        Condition = { StringEquals = { "iam:PassedToService" = "ecs-tasks.amazonaws.com" } }
      },
    ]
  })
}

resource "aws_iam_role_policy" "bridge_execution" {
  count = var.enable_event_media_bridge ? 1 : 0
  name  = "event-media-bridge-execution"
  role  = aws_iam_role.bridge_execution[0].id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Sid = "RegistryAuthentication", Effect = "Allow", Action = "ecr:GetAuthorizationToken", Resource = "*" },
      {
        Sid      = "PullExistingWorkerImage", Effect = "Allow"
        Action   = ["ecr:BatchCheckLayerAvailability", "ecr:GetDownloadUrlForLayer", "ecr:BatchGetImage"]
        Resource = aws_ecr_repository.worker.arn
      },
      {
        Sid      = "WriteBridgeLogs", Effect = "Allow", Action = ["logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "${aws_cloudwatch_log_group.worker.arn}:log-stream:bridge/*"
      },
      { Sid = "ReadBridgeToken", Effect = "Allow", Action = "secretsmanager:GetSecretValue", Resource = local.bridge.token_secret_arn },
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

resource "aws_ecs_task_definition" "bridge" {
  count                    = var.enable_event_media_bridge ? 1 : 0
  family                   = "${var.name_prefix}-event-bridge"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = "256"
  memory                   = "512"
  execution_role_arn       = aws_iam_role.bridge_execution[0].arn
  task_role_arn            = aws_iam_role.bridge_task[0].arn
  tags                     = local.tags
  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }
  container_definitions = jsonencode([{
    name        = "event-media-bridge", image = local.bridge.image, essential = true
    entryPoint  = ["/bin/sh", "-ec"]
    command     = [local.bridge_command]
    stopTimeout = 30
    environment = [for name, value in local.bridge_environment : { name = name, value = value }]
    secrets     = [{ name = "VRDEX_EVENT_MEDIA_BRIDGE_TOKEN", valueFrom = local.bridge.token_secret_arn }]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group = aws_cloudwatch_log_group.worker.name, awslogs-region = var.aws_region, awslogs-stream-prefix = "bridge"
      }
    }
  }])
  lifecycle {
    precondition {
      condition = (
        can(regex("^https://[a-z0-9-]+\\.convex\\.cloud$", local.bridge.convex_url)) &&
        can(regex("^${data.aws_caller_identity.current.account_id}\\.dkr\\.ecr\\.${var.aws_region}\\.amazonaws\\.com/${var.name_prefix}@sha256:[a-f0-9]{64}$", local.bridge.image)) &&
        can(regex("^[a-f0-9]{64}$", local.bridge.bundle_sha256)) &&
        local.bridge.bundle_key == "event-media-bridge/sha256/${local.bridge.bundle_sha256}.mjs" &&
        can(regex("^arn:${data.aws_partition.current.partition}:secretsmanager:${var.aws_region}:${data.aws_caller_identity.current.account_id}:secret:[A-Za-z0-9/_+=.@-]+$", local.bridge.token_secret_arn)) &&
        length(local.bridge.credential_refs) > 0 &&
        alltrue([for ref, arn in local.bridge.credential_refs : trimspace(ref) != "" && can(regex("^arn:${data.aws_partition.current.partition}:secretsmanager:${var.aws_region}:${data.aws_caller_identity.current.account_id}:secret:[A-Za-z0-9/_+=.@-]+$", arn))]) &&
        length(local.bridge.subnet_ids) > 0 && alltrue([for id in local.bridge.subnet_ids : can(regex("^subnet-[a-f0-9]+$", id))]) &&
        length(local.bridge.security_group_ids) > 0 && alltrue([for id in local.bridge.security_group_ids : can(regex("^sg-[a-f0-9]+$", id))]) &&
        contains(["ENABLED", "DISABLED"], local.bridge.assign_public_ip) &&
        var.max_concurrent_workers == 1
      )
      error_message = "Bridge enablement requires a production Convex URL, existing-repository digest image, SHA256-addressed standalone JS bundle, exact token and credential secret ARNs, networking, and concurrency cap 1."
    }
  }
}

output "event_media_bridge_task_definition_arn" {
  description = "Launch this task once with the configured worker networking; it exits within 24 hours plus a 30-second kill grace. No service restarts it."
  value       = try(aws_ecs_task_definition.bridge[0].arn, null)
}
