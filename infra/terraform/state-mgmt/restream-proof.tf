variable "enable_restream_proof_image_permissions" {
  description = "Opt in to a dedicated main-only GitHub OIDC role for restream proof image publication."
  type        = bool
  default     = false
}

resource "aws_iam_role" "restream_proof_image" {
  count = var.enable_restream_proof_image_permissions ? 1 : 0
  name  = "vrdex-restream-proof-image"
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

resource "aws_iam_role_policy" "restream_proof_image" {
  count = var.enable_restream_proof_image_permissions ? 1 : 0
  name  = "vrdex-restream-proof-image"
  role  = aws_iam_role.restream_proof_image[0].name
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "RestreamRegistryAuthentication"
        Effect   = "Allow"
        Action   = "ecr:GetAuthorizationToken"
        Resource = "*"
      },
      {
        Sid    = "PublishAndVerifyRestreamProofImages"
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
        ]
        Resource = "arn:aws:ecr:us-east-1:079358094174:repository/vrdex-restream-worker"
      },
    ]
  })
}
