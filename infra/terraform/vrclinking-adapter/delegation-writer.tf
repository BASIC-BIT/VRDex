# The write side of the same secret names the adapter reads.
#
# The delegation form used to ask a community owner for a
# `secret://vrdex/vrclinking/<guild id>` reference — a value only an operator
# with Secrets Manager access could make real, which is nobody filling in that
# form. The web app takes the pasted key now and writes it here, so this role is
# what lets it, scoped to the same `vrdex/vrclinking/*` prefix the adapter reads
# and to nothing else.
#
# It lives in this stack rather than in `profile-assets`, which owns the OIDC
# provider, because the prefix does: `local.secret_name_prefix` in `main.tf` is
# the one place that string is written for this component, and a grant built
# from a second copy of it would drift silently into denying every delegation.
# The provider is looked up here rather than read out of the other stack's
# state — there is only ever one per issuer URL, so a data source says what a
# `terraform_remote_state` coupling would say, without the coupling.
#
# Deliberately no `GetSecretValue`. Vercel's runtime never reads a delegated key
# back; the adapter's own execution role does that. A role that could both write
# and read every tenant's key is a far larger blast radius than one that can
# only replace them.

variable "vercel_delegation_writer" {
  description = <<-EOT
    Vercel project whose functions may store pasted VRCLinking keys.

    Null disables the write path entirely: no OIDC lookup, no role, no policy,
    and no `VRDEX_VRCLINKING_DELEGATION_ROLE_ARN` for the web app to assume.
    The delegation form reports the feature unavailable in that state rather
    than accepting a key it cannot store, so an unset stack is coherent — which
    is why the default is null and standing up a new environment is inert.

    `runtime_environments` names the Vercel environments allowed to assume the
    role, and becomes the `sub` condition. Custom (preview-style) environments
    are supplied separately as ids, matching `profile-assets`.
  EOT

  type = object({
    team_id              = optional(string, "team_GoHh5xUc96fAIAqJoG55A71S")
    team_slug            = optional(string, "basicbit")
    project_name         = optional(string, "vr-dex-web")
    runtime_environments = optional(set(string), ["production", "staging"])
    role_name            = optional(string, "vrdex-vercel-vrclinking-delegation")
  })

  default = null
}

variable "staging_custom_environment_ids" {
  description = <<-EOT
    Vercel custom environment ids that also receive the role ARN.

    Staging runs in a custom environment rather than a standard target, so
    without this the variable exists in production only and the delegation form
    reports itself unavailable on staging — where it is most likely to be
    exercised first.
  EOT

  type    = set(string)
  default = []
}

locals {
  delegation_writer_enabled = var.vercel_delegation_writer != null

  delegation_writer_issuer_path = local.delegation_writer_enabled ? "oidc.vercel.com/${var.vercel_delegation_writer.team_slug}" : ""
  delegation_writer_issuer_url  = "https://${local.delegation_writer_issuer_path}"
  delegation_writer_audience    = local.delegation_writer_enabled ? "https://vercel.com/${var.vercel_delegation_writer.team_slug}" : ""
  delegation_writer_subjects = local.delegation_writer_enabled ? [
    for environment in var.vercel_delegation_writer.runtime_environments :
    "owner:${var.vercel_delegation_writer.team_slug}:project:${var.vercel_delegation_writer.project_name}:environment:${environment}"
  ] : []

  delegation_writer_env_comment = "VRCLinking delegated-key storage managed by infra/terraform/vrclinking-adapter."

  # The region travels with the role. Vercel sets its own `AWS_REGION` to
  # wherever a function runs, so the web app refuses to infer this: without an
  # explicit value it would look configured everywhere and write each key into
  # whichever region served the request — a different store from the one the
  # adapter reads.
  delegation_writer_env_values = local.delegation_writer_enabled ? {
    VRDEX_VRCLINKING_DELEGATION_ROLE_ARN = aws_iam_role.delegation_writer[0].arn
    VRDEX_VRCLINKING_SECRET_REGION       = data.aws_region.current.region
  } : {}
}

# Created by the profile-assets stack. There is one per issuer URL per account,
# so both stacks federate the same Vercel team without either owning it twice.
data "aws_iam_openid_connect_provider" "vercel" {
  count = local.delegation_writer_enabled ? 1 : 0

  url = local.delegation_writer_issuer_url
}

data "vercel_project" "web" {
  count = local.delegation_writer_enabled ? 1 : 0

  name    = var.vercel_delegation_writer.project_name
  team_id = var.vercel_delegation_writer.team_id
}

data "aws_iam_policy_document" "delegation_writer_assume" {
  count = local.delegation_writer_enabled ? 1 : 0

  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [data.aws_iam_openid_connect_provider.vercel[0].arn]
    }

    condition {
      test     = "StringEquals"
      variable = "${local.delegation_writer_issuer_path}:aud"
      values   = [local.delegation_writer_audience]
    }

    # Named subjects, never a wildcard: any other project in the team could
    # otherwise assume a role that rewrites every community's key.
    condition {
      test     = "StringEquals"
      variable = "${local.delegation_writer_issuer_path}:sub"
      values   = local.delegation_writer_subjects
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
    sid       = "ReplaceDelegatedCredentials"
    actions   = ["secretsmanager:PutSecretValue"]
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

resource "vercel_project_environment_variable" "delegation_writer_production" {
  for_each = local.delegation_writer_env_values

  project_id = data.vercel_project.web[0].id
  team_id    = var.vercel_delegation_writer.team_id
  key        = each.key
  value      = each.value
  target     = ["production"]
  sensitive  = true
  comment    = local.delegation_writer_env_comment
}

resource "vercel_project_environment_variable" "delegation_writer_staging_custom" {
  for_each = {
    for pair in setproduct(keys(local.delegation_writer_env_values), tolist(var.staging_custom_environment_ids)) :
    "${pair[0]}_${pair[1]}" => { key = pair[0], custom_environment_id = pair[1] }
  }

  project_id             = data.vercel_project.web[0].id
  team_id                = var.vercel_delegation_writer.team_id
  key                    = each.value.key
  value                  = local.delegation_writer_env_values[each.value.key]
  custom_environment_ids = [each.value.custom_environment_id]
  sensitive              = true
  comment                = local.delegation_writer_env_comment
}

output "delegation_writer_role_arn" {
  description = "Role Vercel assumes to store delegated VRCLinking keys."
  value       = local.delegation_writer_enabled ? aws_iam_role.delegation_writer[0].arn : null
}
