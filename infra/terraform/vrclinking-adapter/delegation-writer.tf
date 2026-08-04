# The write side of the same secret names the adapter reads.
#
# The delegation form used to ask a community owner for a
# `secret://vrdex/vrclinking/<guild>` reference — a value only an operator with
# Secrets Manager access could make real, which is nobody filling in that form.
# The web app now takes the pasted key and writes it here, so this role is what
# lets it, scoped to the same `vrdex/vrclinking/*` prefix the adapter reads and
# to nothing else.
#
# Deliberately not `GetSecretValue`. Vercel's runtime never needs to read a
# delegated key back, and a role that can write and read every tenant's key is a
# much larger blast radius than one that can only replace them.

variable "vercel_delegation_writer" {
  description = <<-EOT
    Vercel OIDC details for the role that writes pasted VRCLinking keys.

    Null disables the whole write path: no role, no policy, and no
    `VRDEX_VRCLINKING_DELEGATION_ROLE_ARN` for the web app to assume. The
    delegation form reports itself unavailable in that state rather than
    accepting a key it cannot store, so an unset stack is a coherent one.

    `oidc_provider_arn` is the provider the profile-assets stack already
    creates for this Vercel team; this stack consumes it rather than declaring
    a second one for the same issuer.
  EOT

  type = object({
    oidc_provider_arn = string
    issuer_host       = string
    audience          = string
    subjects          = list(string)
    role_name         = optional(string, "vrdex-vercel-vrclinking-delegation")
  })

  default = null
}

locals {
  delegation_writer_enabled = var.vercel_delegation_writer != null
}

data "aws_iam_policy_document" "delegation_writer_assume" {
  count = local.delegation_writer_enabled ? 1 : 0

  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [var.vercel_delegation_writer.oidc_provider_arn]
    }

    condition {
      test     = "StringEquals"
      variable = "${var.vercel_delegation_writer.issuer_host}:aud"
      values   = [var.vercel_delegation_writer.audience]
    }

    # Pinned to named subjects, not a wildcard: any Vercel project in the team
    # could otherwise assume a role that rewrites every community's key.
    condition {
      test     = "StringEquals"
      variable = "${var.vercel_delegation_writer.issuer_host}:sub"
      values   = var.vercel_delegation_writer.subjects
    }
  }
}

resource "aws_iam_role" "delegation_writer" {
  count = local.delegation_writer_enabled ? 1 : 0

  name               = var.vercel_delegation_writer.role_name
  assume_role_policy = data.aws_iam_policy_document.delegation_writer_assume[0].json
}

data "aws_iam_policy_document" "delegation_writer" {
  count = local.delegation_writer_enabled ? 1 : 0

  statement {
    sid = "ReplaceDelegatedCredentials"
    actions = [
      "secretsmanager:PutSecretValue",
    ]

    resources = [local.secret_arn_pattern]
  }

  # `CreateSecret` takes no resource ARN — the secret does not exist yet — so it
  # is constrained by name instead. Without the condition this would be a grant
  # to create any secret in the account.
  statement {
    sid       = "CreateDelegatedCredentials"
    actions   = ["secretsmanager:CreateSecret"]
    resources = ["*"]

    condition {
      test     = "StringLike"
      variable = "secretsmanager:Name"
      values   = ["${local.secret_name_prefix}*"]
    }
  }
}

resource "aws_iam_role_policy" "delegation_writer" {
  count = local.delegation_writer_enabled ? 1 : 0

  name   = "vrclinking-delegation-write"
  role   = aws_iam_role.delegation_writer[0].id
  policy = data.aws_iam_policy_document.delegation_writer[0].json
}

output "delegation_writer_role_arn" {
  description = "Set as VRDEX_VRCLINKING_DELEGATION_ROLE_ARN on the web project."
  value       = local.delegation_writer_enabled ? aws_iam_role.delegation_writer[0].arn : null
}
