locals {
  name         = "vrdex-discord-gateway"
  secret_names = ["DISCORD_APPLICATION_ID", "DISCORD_BOT_TOKEN", "DISCORD_INTAKE_SECRET"]
  image        = var.container_image != null ? var.container_image : "${aws_ecr_repository.gateway.repository_url}:bootstrap-placeholder"
  tags = merge({
    Project   = "VRDex"
    ManagedBy = "Terraform"
    Component = "discord-gateway"
  }, var.tags)
}

data "aws_sns_topic" "alerts" {
  name = var.alerts_topic_name
}

data "aws_subnet" "egress" {
  filter {
    name   = "tag:Name"
    values = [var.egress_subnet_name]
  }
}

resource "aws_ecr_repository" "gateway" {
  name                 = local.name
  image_tag_mutability = "IMMUTABLE"
  tags                 = local.tags

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "AES256"
  }
}

resource "aws_ecr_lifecycle_policy" "gateway" {
  repository = aws_ecr_repository.gateway.name
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Remove only untagged gateway images after seven days."
      selection = {
        tagStatus   = "untagged"
        countType   = "sinceImagePushed"
        countUnit   = "days"
        countNumber = 7
      }
      action = { type = "expire" }
    }]
  })
}

resource "aws_cloudwatch_log_group" "gateway" {
  name              = "/aws/ecs/${local.name}"
  retention_in_days = 30
  tags              = local.tags
}

# Container Insights publishes the RunningTaskCount metric the alarm reads.
resource "aws_ecs_cluster" "gateway" {
  name = local.name
  tags = local.tags

  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}

# Deliberately no aws_secretsmanager_secret_version: refreshing one calls
# GetSecretValue and would copy the bot token into state.
resource "aws_secretsmanager_secret" "gateway" {
  for_each                = toset(local.secret_names)
  name                    = "vrdex/discord-gateway/${each.key}"
  recovery_window_in_days = 7
  tags                    = local.tags
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
  name               = "${local.name}-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume_role.json
  tags               = local.tags
}

resource "aws_iam_role_policy_attachment" "execution" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy" "execution_secrets" {
  name = "read-gateway-secrets"
  role = aws_iam_role.execution.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid      = "ReadGatewaySecrets"
      Effect   = "Allow"
      Action   = "secretsmanager:GetSecretValue"
      Resource = sort([for s in aws_secretsmanager_secret.gateway : s.arn])
    }]
  })
}

# The task role holds nothing: logs and secret injection are execution-role
# duties. The exclusive resources remove anything attached out of band.
resource "aws_iam_role" "task" {
  name               = "${local.name}-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume_role.json
  tags               = local.tags
}

resource "aws_iam_role_policies_exclusive" "task" {
  role_name    = aws_iam_role.task.name
  policy_names = []
}

resource "aws_iam_role_policy_attachments_exclusive" "task" {
  role_name   = aws_iam_role.task.name
  policy_arns = []
}

# The Discord gateway WSS, Convex, ECR and CloudWatch Logs all use 443. DNS goes
# to the VPC resolver, which security groups do not filter.
resource "aws_security_group" "gateway" {
  name        = "${local.name}-egress"
  description = "Discord gateway outbound HTTPS only."
  vpc_id      = data.aws_subnet.egress.vpc_id
  ingress     = []
  tags        = local.tags

  egress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_ecs_task_definition" "gateway" {
  family                   = local.name
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = "256"
  memory                   = "512"
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn
  tags                     = local.tags
  skip_destroy             = true

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  lifecycle {
    create_before_destroy = true
  }

  container_definitions = jsonencode([{
    name        = "gateway"
    image       = local.image
    essential   = true
    environment = [{ name = "CONVEX_SITE_URL", value = var.convex_site_url }]
    secrets     = [for n in local.secret_names : { name = n, valueFrom = aws_secretsmanager_secret.gateway[n].arn }]
    # Node as PID 1 has no SIGTERM handler, so without an init process every
    # release waits out the 30 s stop timeout and then SIGKILLs.
    linuxParameters = { initProcessEnabled = true }
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.gateway.name
        awslogs-region        = "us-east-1"
        awslogs-stream-prefix = "gateway"
      }
    }
  }])
}

# Minimum 0 and maximum 100 stop the old task before starting the new one, so
# there are never two gateway connections during a deploy.
resource "aws_ecs_service" "gateway" {
  count                              = var.enable_service ? 1 : 0
  name                               = local.name
  cluster                            = aws_ecs_cluster.gateway.id
  task_definition                    = aws_ecs_task_definition.gateway.arn
  desired_count                      = 1
  launch_type                        = "FARGATE"
  enable_execute_command             = false
  deployment_minimum_healthy_percent = 0
  deployment_maximum_percent         = 100
  tags                               = local.tags

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  network_configuration {
    subnets          = [data.aws_subnet.egress.id]
    security_groups  = [aws_security_group.gateway.id]
    assign_public_ip = false
  }
}

# Maximum, not Minimum: a deploy leaves a minute or two with no task, so Minimum
# would email on every release. Maximum below 1 means no running task for the
# whole period.
resource "aws_cloudwatch_metric_alarm" "running_tasks" {
  count               = var.enable_service ? 1 : 0
  alarm_name          = "${local.name}-missing-task"
  alarm_actions       = [data.aws_sns_topic.alerts.arn]
  ok_actions          = [data.aws_sns_topic.alerts.arn]
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = 1
  metric_name         = "RunningTaskCount"
  namespace           = "ECS/ContainerInsights"
  period              = 300
  statistic           = "Maximum"
  threshold           = 1
  treat_missing_data  = "breaching"
  alarm_description   = "The Discord gateway has had no running task for five minutes."
  dimensions          = { ClusterName = aws_ecs_cluster.gateway.name, ServiceName = aws_ecs_service.gateway[0].name }
  tags                = local.tags
}
