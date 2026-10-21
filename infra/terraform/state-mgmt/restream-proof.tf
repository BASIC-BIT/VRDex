variable "enable_restream_proof_image_permissions" {
  description = "Opt in to the approved restream proof image push grant on the existing GitHub OIDC role. Does not change its trust policy."
  type        = bool
  default     = false
}

resource "aws_iam_role_policy" "restream_proof_image" {
  count = var.enable_restream_proof_image_permissions ? 1 : 0
  name  = "vrdex-restream-proof-image"
  role  = aws_iam_role.github_actions_terraform.id
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
        Sid    = "PublishOnlyRestreamProofImages"
        Effect = "Allow"
        Action = [
          "ecr:BatchCheckLayerAvailability",
          "ecr:InitiateLayerUpload",
          "ecr:UploadLayerPart",
          "ecr:CompleteLayerUpload",
          "ecr:PutImage",
          "ecr:DescribeImages",
        ]
        Resource = "arn:aws:ecr:us-east-1:079358094174:repository/vrdex-restream-worker"
      },
    ]
  })
}
