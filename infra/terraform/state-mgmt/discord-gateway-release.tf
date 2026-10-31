variable "enable_discord_gateway_release_permissions" {
  description = "Opt in to a dedicated main-only GitHub OIDC role for Discord gateway releases."
  type        = bool
  default     = false
}

resource "aws_iam_role" "discord_gateway_release" {
  count = var.enable_discord_gateway_release_permissions ? 1 : 0
  name  = "vrdex-discord-gateway-release"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Action    = "sts:AssumeRoleWithWebIdentity"
      Principal = { Federated = data.aws_iam_openid_connect_provider.github_actions.arn }
      Condition = {
        StringEquals = {
          "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
          "token.actions.githubusercontent.com:sub" = "repo:${var.github_repository}:ref:refs/heads/main"
        }
      }
    }]
  })
}

resource "aws_iam_role_policy" "discord_gateway_release" {
  count = var.enable_discord_gateway_release_permissions ? 1 : 0
  name  = "vrdex-discord-gateway-release"
  role  = aws_iam_role.discord_gateway_release[0].name
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "GatewayRegistryAuthentication"
        Effect   = "Allow"
        Action   = "ecr:GetAuthorizationToken"
        Resource = "*"
      },
      {
        Sid    = "PublishGatewayImages"
        Effect = "Allow"
        Action = [
          "ecr:BatchCheckLayerAvailability",
          "ecr:InitiateLayerUpload",
          "ecr:UploadLayerPart",
          "ecr:CompleteLayerUpload",
          "ecr:PutImage",
          "ecr:DescribeImages",
          "ecr:BatchGetImage",
          "ecr:GetDownloadUrlForLayer",
          "ecr:DescribeRepositories",
          "ecr:GetLifecyclePolicy",
          "ecr:ListTagsForResource",
        ]
        Resource = "arn:aws:ecr:us-east-1:${data.aws_caller_identity.current.account_id}:repository/vrdex-discord-gateway"
      },
      {
        Sid    = "GatewayState"
        Effect = "Allow"
        Action = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
        Resource = [
          "${local.state_bucket_arn}/discord-gateway/terraform.tfstate",
          "${local.state_bucket_arn}/discord-gateway/terraform.tfstate.tflock",
        ]
      },
      {
        Sid      = "GatewayStateBucket"
        Effect   = "Allow"
        Action   = "s3:ListBucket"
        Resource = local.state_bucket_arn
      },
      {
        # Read-only calls left on *. IAM and secret reads are scoped below.
        Sid    = "RefreshGatewayStack"
        Effect = "Allow"
        Action = [
          "ecs:DescribeClusters",
          "ecs:DescribeServices",
          "ecs:DescribeTaskDefinition",
          "ecs:ListTagsForResource",
          "ec2:DescribeSubnets",
          "ec2:DescribeSecurityGroups",
          "ec2:DescribeVpcs",
          "sns:GetTopicAttributes",
          "sns:ListTagsForResource",
          "sns:ListTopics",
          "logs:DescribeLogGroups",
          "logs:ListTagsForResource",
          "cloudwatch:DescribeAlarms",
          "cloudwatch:ListTagsForResource",
        ]
        Resource = "*"
      },
      {
        Sid    = "ReadGatewayRoles"
        Effect = "Allow"
        Action = [
          "iam:GetRole",
          "iam:GetRolePolicy",
          "iam:ListRolePolicies",
          "iam:ListAttachedRolePolicies",
        ]
        Resource = [
          "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/vrdex-discord-gateway-execution",
          "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/vrdex-discord-gateway-task",
        ]
      },
      {
        # No GetSecretValue: the stack has no secret versions.
        Sid      = "ReadGatewaySecretMetadata"
        Effect   = "Allow"
        Action   = ["secretsmanager:DescribeSecret", "secretsmanager:GetResourcePolicy"]
        Resource = "arn:aws:secretsmanager:us-east-1:${data.aws_caller_identity.current.account_id}:secret:vrdex/discord-gateway/*"
      },
      {
        Sid      = "RegisterGatewayTaskDefinitions"
        Effect   = "Allow"
        Action   = ["ecs:RegisterTaskDefinition", "ecs:TagResource"]
        Resource = "*"
      },
      {
        Sid      = "RollGatewayService"
        Effect   = "Allow"
        Action   = "ecs:UpdateService"
        Resource = "arn:aws:ecs:us-east-1:${data.aws_caller_identity.current.account_id}:service/vrdex-discord-gateway/vrdex-discord-gateway"
      },
      {
        Sid    = "PassGatewayRoles"
        Effect = "Allow"
        Action = "iam:PassRole"
        Resource = [
          "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/vrdex-discord-gateway-execution",
          "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/vrdex-discord-gateway-task",
        ]
        Condition = { StringEquals = { "iam:PassedToService" = "ecs-tasks.amazonaws.com" } }
      },
      {
        Sid      = "NotifyGatewayReleaseFailure"
        Effect   = "Allow"
        Action   = "sns:Publish"
        Resource = "arn:aws:sns:us-east-1:${data.aws_caller_identity.current.account_id}:vrdex-group-telemetry-alerts"
      },
    ]
  })
}

output "discord_gateway_release_role_arn" {
  description = "IAM role ARN for the Discord gateway release workflow. Store this in GitHub variable AWS_DISCORD_GATEWAY_RELEASE_ROLE_ARN."
  value       = try(aws_iam_role.discord_gateway_release[0].arn, null)
}
