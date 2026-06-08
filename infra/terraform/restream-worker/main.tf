locals {
  component      = "restream-worker"
  container_name = "hosted-worker"
  worker_image   = var.container_image != null ? var.container_image : "${aws_ecr_repository.worker.repository_url}:benchmark-placeholder"
  secret_names   = sort(keys(var.secret_arns))
  container_secrets = [
    for name in local.secret_names : {
      name      = name
      valueFrom = var.secret_arns[name]
    }
  ]
  tags = merge(
    {
      Project   = "VRDex"
      ManagedBy = "Terraform"
      Component = local.component
    },
    var.tags,
  )
}

resource "aws_ecr_repository" "worker" {
  name                 = var.name_prefix
  image_tag_mutability = "IMMUTABLE"
  tags                 = local.tags

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "AES256"
  }
}

resource "aws_ecr_lifecycle_policy" "worker" {
  repository = aws_ecr_repository.worker.name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Keep the most recent restream worker benchmark images."
        selection = {
          tagStatus   = "any"
          countType   = "imageCountMoreThan"
          countNumber = 20
        }
        action = {
          type = "expire"
        }
      }
    ]
  })
}

resource "aws_cloudwatch_log_group" "worker" {
  name              = "/aws/ecs/${var.name_prefix}"
  retention_in_days = var.log_retention_days
  tags              = local.tags
}

resource "aws_ecs_cluster" "worker" {
  name = var.name_prefix
  tags = local.tags

  setting {
    name  = "containerInsights"
    value = var.enable_container_insights ? "enabled" : "disabled"
  }
}

resource "aws_ssm_parameter" "hosted_worker_enabled" {
  name  = "/vrdex/restream/hosted-worker/enabled"
  type  = "String"
  value = var.kill_switch_enabled_default ? "true" : "false"
  tags  = local.tags
}

data "aws_iam_policy_document" "ecs_tasks_assume_role" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "execution" {
  name               = "${var.name_prefix}-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume_role.json
  tags               = local.tags
}

resource "aws_iam_role_policy_attachment" "execution_managed" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

data "aws_iam_policy_document" "execution_secrets" {
  count = length(var.secret_arns) > 0 ? 1 : 0

  statement {
    sid = "ReadReferencedWorkerSecrets"
    actions = [
      "secretsmanager:GetSecretValue",
      "ssm:GetParameters",
    ]
    resources = values(var.secret_arns)
  }
}

resource "aws_iam_role_policy" "execution_secrets" {
  count = length(var.secret_arns) > 0 ? 1 : 0

  name   = "read-referenced-worker-secrets"
  role   = aws_iam_role.execution.id
  policy = data.aws_iam_policy_document.execution_secrets[0].json
}

resource "aws_iam_role" "task" {
  name               = "${var.name_prefix}-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume_role.json
  tags               = local.tags
}

data "aws_iam_policy_document" "task" {
  statement {
    sid = "ReadWorkerKillSwitch"
    actions = [
      "ssm:GetParameter",
    ]
    resources = [aws_ssm_parameter.hosted_worker_enabled.arn]
  }

  statement {
    sid = "EmitWorkerMetrics"
    actions = [
      "cloudwatch:PutMetricData",
    ]
    resources = ["*"]

    condition {
      test     = "StringEquals"
      variable = "cloudwatch:namespace"
      values   = ["VRDex/Restream"]
    }
  }
}

resource "aws_iam_role_policy" "task" {
  name   = "restream-worker-runtime"
  role   = aws_iam_role.task.id
  policy = data.aws_iam_policy_document.task.json
}

resource "aws_ecs_task_definition" "worker" {
  family                   = var.name_prefix
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = tostring(var.task_cpu)
  memory                   = tostring(var.task_memory)
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn
  tags                     = local.tags

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  ephemeral_storage {
    size_in_gib = var.ephemeral_storage_gib
  }

  container_definitions = jsonencode([
    {
      name      = local.container_name
      image     = local.worker_image
      essential = true
      cpu       = var.container_cpu
      memory    = var.container_memory
      command   = ["node", "workers/restream/hosted-worker.mjs"]
      environment = [
        {
          name  = "CONVEX_URL"
          value = var.convex_url
        },
        {
          name  = "VRDEX_RESTREAM_BENCHMARK_MODE"
          value = "ecs-fargate"
        },
        {
          name  = "VRDEX_RESTREAM_QUALITY_GATE"
          value = "1080p60"
        },
        {
          name  = "VRDEX_RESTREAM_MAX_CONCURRENT_WORKERS"
          value = tostring(var.max_concurrent_workers)
        },
        {
          name  = "VRDEX_RESTREAM_MAX_SESSION_SECONDS"
          value = tostring(var.max_session_seconds)
        },
        {
          name  = "VRDEX_RESTREAM_KILL_SWITCH_SSM_PARAMETER"
          value = aws_ssm_parameter.hosted_worker_enabled.name
        },
        {
          name  = "VRDEX_RESTREAM_SECRET_REF_NAMES"
          value = join(",", local.secret_names)
        }
      ]
      secrets = local.container_secrets
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.worker.name
          awslogs-region        = var.aws_region
          awslogs-stream-prefix = "worker"
        }
      }
    }
  ])
}
