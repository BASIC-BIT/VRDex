locals {
  component = "vrclinking-adapter"
  enabled   = var.enable_service ? 1 : 0
  tags = merge(
    {
      Project   = "VRDex"
      ManagedBy = "Terraform"
      Component = local.component
    },
    var.tags,
  )
}

data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

# Every delegation reference resolves to `vrdex/vrclinking/<guildId>`, and both
# Convex and the adapter refuse a reference that names a different guild.
# Granting the prefix rather than an enumerated list keeps onboarding a
# community an operator action instead of a Terraform change — the guild binding
# is enforced in code, where it can see which guild the request is for.
#
# Not a variable: `secretNameForGuild` in `convex/vrclinkingCredentials.ts` and
# `isSecretRefForGuild` in the adapter both hard-code this prefix, so overriding
# it here would only move the IAM grant away from the one shape the application
# accepts — every delegation would then be denied rather than relocated.
locals {
  secret_name_prefix = "vrdex/vrclinking/"
  secret_arn_pattern = "arn:aws:secretsmanager:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:secret:${local.secret_name_prefix}*"
}

data "aws_iam_policy_document" "assume" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

data "aws_iam_policy_document" "runtime" {
  statement {
    sid     = "ReadDelegatedCredentials"
    actions = ["secretsmanager:GetSecretValue"]
    resources = [
      local.secret_arn_pattern,
      var.shared_secret_arn,
    ]
  }

  # Only when a customer-managed key is in play. `GetSecretValue` on a secret
  # encrypted with one also needs `kms:Decrypt`; the AWS-managed Secrets Manager
  # key needs no grant, so an empty list emits no statement rather than a
  # wildcard nobody asked for.
  dynamic "statement" {
    for_each = length(var.kms_key_arns) > 0 ? [1] : []

    content {
      sid       = "DecryptCustomerManagedSecrets"
      actions   = ["kms:Decrypt"]
      resources = var.kms_key_arns

      condition {
        test     = "StringEquals"
        variable = "kms:ViaService"
        values   = ["secretsmanager.${data.aws_region.current.region}.amazonaws.com"]
      }
    }
  }

  statement {
    sid = "Logs"
    actions = [
      "logs:CreateLogStream",
      "logs:PutLogEvents",
    ]
    resources = ["${aws_cloudwatch_log_group.adapter.arn}:*"]
  }
}

resource "aws_iam_role" "adapter" {
  name               = "${var.name_prefix}-role"
  assume_role_policy = data.aws_iam_policy_document.assume.json
  tags               = local.tags
}

resource "aws_iam_role_policy" "adapter" {
  name   = "${var.name_prefix}-runtime"
  role   = aws_iam_role.adapter.id
  policy = data.aws_iam_policy_document.runtime.json
}

# Created ahead of the function so the log-group policy above can reference it
# and retention is set from the start rather than defaulting to never expire.
resource "aws_cloudwatch_log_group" "adapter" {
  name              = "/aws/lambda/${var.name_prefix}"
  retention_in_days = var.log_retention_days
  tags              = local.tags
}

resource "aws_lambda_function" "adapter" {
  count = local.enabled

  function_name = var.name_prefix
  role          = aws_iam_role.adapter.arn
  # Matches the `node >=24 <25` the adapter's package declares.
  runtime          = "nodejs24.x"
  handler          = "workers/vrclinking-adapter/src/lambda.handler"
  filename         = var.source_zip_path
  source_code_hash = filebase64sha256(var.source_zip_path)
  timeout          = var.timeout_seconds
  memory_size      = 256
  # Bounds how much of a community's provider quota concurrent claims can spend,
  # and keeps a burst of requests from outliving the caller that issued them.
  reserved_concurrent_executions = var.reserved_concurrency
  logging_config {
    log_format = "JSON"
    log_group  = aws_cloudwatch_log_group.adapter.name
  }

  environment {
    variables = {
      VRDEX_VRCLINKING_ENABLE_AWS_SECRETS = "true"
      VRDEX_VRCLINKING_BASE_URL           = var.provider_base_url
      # Resolved from Secrets Manager at cold start rather than pasted here:
      # Lambda environment variables are readable by anyone with
      # `lambda:GetFunctionConfiguration`, which is a wider audience than the
      # execution role.
      VRDEX_VRCLINKING_SHARED_SECRET_ARN = var.shared_secret_arn
    }
  }

  tags       = local.tags
  depends_on = [aws_iam_role_policy.adapter]
}

# Auth NONE by design: Convex cannot sign SigV4, and the request is authorized
# by the shared bearer token plus a per-delegation capability the caller cannot
# forge. IAM auth here would demand a credential the control plane has no way to
# present.
resource "aws_lambda_function_url" "adapter" {
  count = local.enabled

  function_name      = aws_lambda_function.adapter[0].function_name
  authorization_type = "NONE"
}

# `authorization_type = "NONE"` alone returns 403 — the URL is only reachable if
# the resource policy grants anonymous access. Since October 2025 that means both
# actions below, not just `InvokeFunctionUrl`; a URL with only the first is
# rejected before the handler runs.
resource "aws_lambda_permission" "function_url" {
  count = local.enabled

  statement_id           = "AllowFunctionUrlInvoke"
  action                 = "lambda:InvokeFunctionUrl"
  function_name          = aws_lambda_function.adapter[0].function_name
  principal              = "*"
  function_url_auth_type = "NONE"
}

# `invoked_via_function_url` is what keeps `Principal = "*"` from also granting
# every AWS principal a direct `Invoke`, which would sidestep the bearer token
# and capability check the URL path enforces.
resource "aws_lambda_permission" "function_url_invoke" {
  count = local.enabled

  statement_id             = "AllowFunctionUrlInvokeFunction"
  action                   = "lambda:InvokeFunction"
  function_name            = aws_lambda_function.adapter[0].function_name
  principal                = "*"
  invoked_via_function_url = true
}
