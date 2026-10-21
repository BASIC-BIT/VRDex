# Exact additive rehearsal deltas. Ordinary hosted enablement stays unchanged.
variable "enable_rehearsal_permissions" {
  description = "Opt in to the approved basicbit1 source read and isolated rehearsal switch. Disable after all rehearsal tasks are STOPPED."
  type        = bool
  default     = false
}

resource "aws_ssm_parameter" "rehearsal_enabled" {
  count = var.enable_rehearsal_permissions ? 1 : 0
  name  = "/vrdex/restream/rehearsal/enabled"
  type  = "String"
  value = "false"
  tags  = local.tags
}

resource "aws_iam_role_policy" "rehearsal_source" {
  count = var.enable_rehearsal_permissions ? 1 : 0
  name  = "vrdex-restream-rehearsal-source"
  role  = aws_iam_role.execution.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid      = "ReadBasicbit1RehearsalSourceSecret"
      Effect   = "Allow"
      Action   = "secretsmanager:GetSecretValue"
      Resource = "arn:aws:secretsmanager:us-east-1:079358094174:secret:event-media/vrcdn/basicbit1-smoke-GWQX7c"
    }]
  })
  lifecycle {
    precondition {
      condition     = var.aws_region == "us-east-1" && data.aws_caller_identity.current.account_id == "079358094174" && var.name_prefix == "vrdex-restream-worker"
      error_message = "The approved rehearsal delta applies only to the inventoried BASIC account, region and worker."
    }
  }
}

resource "aws_iam_role_policy" "rehearsal_switch" {
  count = var.enable_rehearsal_permissions ? 1 : 0
  name  = "vrdex-restream-rehearsal-switch"
  role  = aws_iam_role.task.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid      = "ReadDedicatedRestreamRehearsalKillSwitch"
      Effect   = "Allow"
      Action   = "ssm:GetParameter"
      Resource = "arn:aws:ssm:us-east-1:079358094174:parameter/vrdex/restream/rehearsal/enabled"
    }]
  })
}
