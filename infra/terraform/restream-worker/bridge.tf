# A manually launched, bounded dispatcher. No ECS service restarts it after expiry.
variable "enable_event_media_bridge" {
  description = "Provision the opt-in 24-hour event dispatcher task definition and exact runtime grants. Does not start a task or enable the production switch."
  type        = bool
  default     = false
}

variable "event_media_bridge" {
  description = "Owner-reviewed production configuration. Secret references only. Publish the standalone bridge JS bundle and AWS CLI archive under their SHA256 keys before launching."
  type = object({
    convex_url         = string
    image              = string
    bundle_key         = string
    bundle_sha256      = string
    cli_archive_key    = string
    cli_archive_sha256 = string
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
    convex_url      = "", image = "", bundle_key = "", bundle_sha256 = "", cli_archive_key = "", cli_archive_sha256 = "", token_secret_arn = ""
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
    VRDEX_EVENT_MEDIA_BRIDGE_CLI_S3_URI    = "s3://${aws_s3_bucket.artifacts.bucket}/${local.bridge.cli_archive_key}"
    VRDEX_EVENT_MEDIA_BRIDGE_CLI_SHA256    = local.bridge.cli_archive_sha256
    VRDEX_EVENT_MEDIA_AWS_COMMAND          = "/tmp/vrdex-event-media-awscli/aws/dist/aws"
    AWS_REGION                             = var.aws_region
  }
  # timeout owns the complete process group, including retries and download.
  # Validate static config once. Retry a failed control-plane connection at most
  # ten times; the outer deadline never renews when a child exits. Compute one
  # inherited drain deadline before bootstrap, leaving ten minutes for cleanup.
  # Keep the shell alive while a signaled foreground child drains, then latch
  # shutdown so no retry can claim work after TERM or INT.
  bridge_command = <<-SHELL
    exec timeout --signal=TERM --kill-after=30s 86400s /bin/sh -ec '
      export VRDEX_EVENT_MEDIA_BRIDGE_DRAIN_AT_MS=$((($(date +%s) + 85800) * 1000))
      stopping=0
      trap "stopping=1; export VRDEX_EVENT_MEDIA_BRIDGE_DRAIN_AT_MS=0" TERM INT
      umask 077
      aws s3 cp "$VRDEX_EVENT_MEDIA_BRIDGE_BUNDLE_S3_URI" /tmp/event-media-ecs-bridge.mjs --only-show-errors
      aws s3 cp "$VRDEX_EVENT_MEDIA_BRIDGE_CLI_S3_URI" /tmp/vrdex-event-media-awscli.zip --only-show-errors
      printf "%s  %s\n" "$VRDEX_EVENT_MEDIA_BRIDGE_BUNDLE_SHA256" /tmp/event-media-ecs-bridge.mjs | sha256sum --check --status
      printf "%s  %s\n" "$VRDEX_EVENT_MEDIA_BRIDGE_CLI_SHA256" /tmp/vrdex-event-media-awscli.zip | sha256sum --check --status
      python3 - <<PYTHON
    import os
    from pathlib import Path, PurePosixPath
    import stat
    import zipfile

    root = Path("/tmp/vrdex-event-media-awscli")
    limit = 1024 * 1024 * 1024
    with zipfile.ZipFile("/tmp/vrdex-event-media-awscli.zip") as archive:
        members = archive.infolist()
        if len(members) > 10000 or sum(entry.file_size for entry in members) > limit:
            raise ValueError("AWS CLI archive exceeds extraction limits")
        destinations = set()
        for entry in members:
            path = PurePosixPath(entry.filename)
            if not path.parts or path.is_absolute() or ".." in path.parts or stat.S_ISLNK(entry.external_attr >> 16):
                raise ValueError("Unsafe AWS CLI archive member")
            destination = root.joinpath(*path.parts)
            if root not in destination.parents or destination in destinations:
                raise ValueError("Unsafe or duplicate AWS CLI archive destination")
            destinations.add(destination)
        root.mkdir(mode=0o700)
        extracted = 0
        for entry in members:
            destination = root.joinpath(*PurePosixPath(entry.filename).parts)
            if entry.is_dir():
                destination.mkdir(mode=0o700, parents=True, exist_ok=True)
                continue
            destination.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
            with archive.open(entry) as source, destination.open("xb") as output:
                while True:
                    chunk = source.read(65536)
                    if not chunk:
                        break
                    extracted += len(chunk)
                    if extracted > limit:
                        raise ValueError("AWS CLI archive exceeds extraction limits")
                    output.write(chunk)
    os.chmod(root / "aws/dist/aws", 0o755)
    PYTHON
      export PATH="/tmp/vrdex-event-media-awscli/aws/dist:$PATH"
      "$VRDEX_EVENT_MEDIA_AWS_COMMAND" --version
      "$VRDEX_EVENT_MEDIA_AWS_COMMAND" ecs run-task --generate-cli-skeleton input > /tmp/vrdex-event-media-run-task-skeleton.json
      python3 - <<PYTHON
    import json
    with open("/tmp/vrdex-event-media-run-task-skeleton.json") as source:
        skeleton = json.load(source)
    if not isinstance(skeleton, dict) or "clientToken" not in skeleton:
        raise ValueError("Pinned AWS CLI must support ECS RunTask clientToken")
    PYTHON
      VRDEX_EVENT_MEDIA_ECS_BRIDGE_CONFIG_CHECK_ONLY=true node /tmp/event-media-ecs-bridge.mjs
      attempt=0
      while [ "$attempt" -lt 10 ] && [ "$stopping" -eq 0 ]; do
        node /tmp/event-media-ecs-bridge.mjs && exit 0
        attempt=$((attempt + 1))
        if [ "$attempt" -lt 10 ] && [ "$stopping" -eq 0 ]; then sleep 30; fi
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
        Sid = "ReadVerifiedBridgeBundle", Effect = "Allow", Action = "s3:GetObject"
        Resource = [
          "${aws_s3_bucket.artifacts.arn}/${local.bridge.bundle_key}",
          "${aws_s3_bucket.artifacts.arn}/${local.bridge.cli_archive_key}",
        ]
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
        can(regex("^[a-f0-9]{64}$", local.bridge.cli_archive_sha256)) &&
        local.bridge.cli_archive_key == "event-media-bridge/awscli/sha256/${local.bridge.cli_archive_sha256}.zip" &&
        can(regex("^arn:${data.aws_partition.current.partition}:secretsmanager:${var.aws_region}:${data.aws_caller_identity.current.account_id}:secret:[A-Za-z0-9/_+=.@-]+$", local.bridge.token_secret_arn)) &&
        length(local.bridge.credential_refs) > 0 &&
        alltrue([for ref, arn in local.bridge.credential_refs : trimspace(ref) != "" && can(regex("^arn:${data.aws_partition.current.partition}:secretsmanager:${var.aws_region}:${data.aws_caller_identity.current.account_id}:secret:[A-Za-z0-9/_+=.@-]+$", arn))]) &&
        length(local.bridge.subnet_ids) > 0 && alltrue([for id in local.bridge.subnet_ids : can(regex("^subnet-[a-f0-9]+$", id))]) &&
        length(local.bridge.security_group_ids) > 0 && alltrue([for id in local.bridge.security_group_ids : can(regex("^sg-[a-f0-9]+$", id))]) &&
        contains(["ENABLED", "DISABLED"], local.bridge.assign_public_ip) &&
        var.max_concurrent_workers == 1
      )
      error_message = "Bridge enablement requires a production Convex URL, existing-repository digest image, SHA256-addressed standalone JS bundle and AWS CLI archive, exact token and credential secret ARNs, networking, and concurrency cap 1."
    }
  }
}

output "event_media_bridge_task_definition_arn" {
  description = "Launch this task once with the configured worker networking; it exits within 24 hours plus a 30-second kill grace. No service restarts it."
  value       = try(aws_ecs_task_definition.bridge[0].arn, null)
}
