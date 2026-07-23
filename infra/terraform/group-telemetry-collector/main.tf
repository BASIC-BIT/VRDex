locals {
  component    = "group-telemetry-collector"
  worker_image = var.container_image != null ? var.container_image : "${aws_ecr_repository.worker.repository_url}:bootstrap-placeholder"
  tags = merge({
    Project   = "VRDex"
    ManagedBy = "Terraform"
    Component = local.component
  }, var.tags)
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
    rules = [{
      rulePriority = 1
      description  = "Keep ten collector images."
      selection = {
        tagStatus   = "any"
        countType   = "imageCountMoreThan"
        countNumber = 10
      }
      action = { type = "expire" }
    }]
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
    value = "enabled"
  }
}

resource "aws_ssm_parameter" "enabled" {
  name  = "/vrdex/group-telemetry/${var.name_prefix}/enabled"
  type  = "String"
  value = var.enable_service && var.desired_count > 0 ? "true" : "false"
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

resource "aws_iam_role_policy_attachment" "execution" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

data "aws_iam_policy_document" "execution_secret" {
  statement {
    sid       = "ReadOnlyAssignedAccountSecret"
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [var.account_secret_arn]
  }
}

resource "aws_iam_role_policy" "execution_secret" {
  count  = var.account_secret_arn == "" ? 0 : 1
  name   = "read-assigned-account-secret"
  role   = aws_iam_role.execution.id
  policy = data.aws_iam_policy_document.execution_secret.json
}

data "aws_iam_policy_document" "execution_gate" {
  statement {
    sid       = "ReadCollectorDeploymentGate"
    actions   = ["ssm:GetParameters"]
    resources = [aws_ssm_parameter.enabled.arn]
  }
}

resource "aws_iam_role_policy" "execution_gate" {
  name   = "read-collector-deployment-gate"
  role   = aws_iam_role.execution.id
  policy = data.aws_iam_policy_document.execution_gate.json
}

resource "aws_iam_role" "task" {
  name               = "${var.name_prefix}-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume_role.json
  tags               = local.tags
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

  container_definitions = jsonencode([{
    name      = "collector"
    image     = local.worker_image
    essential = true
    environment = [
      { name = "VRDEX_GROUP_TELEMETRY_CONVEX_SITE_URL", value = var.convex_site_url },
      { name = "VRDEX_GROUP_TELEMETRY_COLLECTOR_ACCOUNT_ID", value = var.collector_account_id },
      { name = "VRDEX_GROUP_TELEMETRY_USER_AGENT", value = var.user_agent },
      { name = "VRDEX_GROUP_TELEMETRY_REQUESTS_PER_MINUTE", value = tostring(var.requests_per_minute) }
    ]
    secrets = concat(
      [{ name = "VRDEX_GROUP_TELEMETRY_ENABLED", valueFrom = aws_ssm_parameter.enabled.arn }],
      var.account_secret_arn == "" ? [] : [{ name = "VRDEX_GROUP_TELEMETRY_ACCOUNT_SECRET_JSON", valueFrom = var.account_secret_arn }]
    )
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.worker.name
        awslogs-region        = var.aws_region
        awslogs-stream-prefix = "collector"
      }
    }
  }])
}

resource "aws_ecs_service" "worker" {
  count                  = var.enable_service ? 1 : 0
  name                   = var.name_prefix
  cluster                = aws_ecs_cluster.worker.id
  task_definition        = aws_ecs_task_definition.worker.arn
  desired_count          = var.desired_count
  launch_type            = "FARGATE"
  enable_execute_command = false
  tags                   = local.tags

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  network_configuration {
    subnets          = var.subnet_ids
    security_groups  = var.security_group_ids
    assign_public_ip = var.assign_public_ip
  }
}

resource "aws_cloudwatch_metric_alarm" "worker_cpu" {
  count               = var.enable_service ? 1 : 0
  alarm_name          = "${var.name_prefix}-high-cpu"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 3
  metric_name         = "CPUUtilization"
  namespace           = "AWS/ECS"
  period              = 300
  statistic           = "Average"
  threshold           = 80
  alarm_description   = "Collector CPU remains above 80 percent for 15 minutes."
  dimensions          = { ClusterName = aws_ecs_cluster.worker.name, ServiceName = aws_ecs_service.worker[0].name }
  tags                = local.tags
}

resource "aws_cloudwatch_metric_alarm" "worker_count" {
  count               = var.enable_service ? 1 : 0
  alarm_name          = "${var.name_prefix}-missing-task"
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = 2
  metric_name         = "RunningTaskCount"
  namespace           = "ECS/ContainerInsights"
  period              = 300
  statistic           = "Minimum"
  threshold           = var.desired_count
  alarm_description   = "The collector has fewer running tasks than its bounded desired count."
  dimensions          = { ClusterName = aws_ecs_cluster.worker.name, ServiceName = aws_ecs_service.worker[0].name }
  tags                = local.tags
}

resource "aws_budgets_budget" "worker" {
  count        = var.enable_service ? 1 : 0
  name         = "${var.name_prefix}-monthly"
  budget_type  = "COST"
  limit_amount = tostring(var.monthly_budget_usd)
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  cost_filter {
    name   = "TagKeyValue"
    values = [format("user:Component$%s", local.component)]
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 80
    threshold_type             = "PERCENTAGE"
    notification_type          = "FORECASTED"
    subscriber_email_addresses = [var.budget_alert_email]
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = [var.budget_alert_email]
  }

  tags = local.tags
}
