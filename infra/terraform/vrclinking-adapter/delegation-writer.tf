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

  # `runtime_environments` defaults to production *and* staging, so the empty
  # opt-in in `environments/production.tfvars` trusts staging in the role while
  # this list decides whether staging is ever told the role and region. An apply
  # that forgets `TF_VAR_staging_custom_environment_ids` therefore reaches a
  # half-enabled state — staging trusted by IAM, staging carrying neither
  # variable, and the stack removing any copies that were already there — which
  # reaches a community owner as the delegation form deciding it is unavailable.
  # Refused here for the same reason `delegation_writer_kms_key_id` refuses its
  # own half: the requirement was documented and unenforced, and the failure is
  # silent.
  #
  # `try` rather than a null guard ahead of the attribute access, because HCL's
  # `||` is not documented to short-circuit and the disabled writer is the
  # default: a version that evaluates both operands would fault on reading an
  # attribute of null, and take every apply of an unconfigured stack with it.
  # `terraform validate` does not evaluate variable validations at all, so CI
  # would not have caught that.
  validation {
    condition = (
      !contains(try(tolist(var.vercel_delegation_writer.runtime_environments), []), "staging") ||
      length(var.staging_custom_environment_ids) > 0
    )
    error_message = "staging is in vercel_delegation_writer.runtime_environments, so staging_custom_environment_ids must name the custom environment that receives the role ARN and region: export TF_VAR_staging_custom_environment_ids, or drop \"staging\" from runtime_environments."
  }
}

variable "delegation_writer_kms_key_id" {
  description = <<-EOT
    Customer-managed KMS key delegated credentials are created under.

    Null means the AWS-managed Secrets Manager key, which needs no grant and is
    what this stack has always assumed.

    Must also appear in `kms_key_arns`: that list is what grants the adapter's
    read and the writer's encrypt. Setting one without the other applied a
    half-enabled configuration — the form enabled, `CreateSecret` passing a key
    the writer may not use, and the adapter unable to read what did get written.
    The validation below refuses that rather than letting it reach an operator as
    a 500 on every save.
  EOT

  type    = string
  default = null

  validation {
    condition     = var.delegation_writer_kms_key_id == null || contains(var.kms_key_arns, coalesce(var.delegation_writer_kms_key_id, ""))
    error_message = "delegation_writer_kms_key_id must also be listed in kms_key_arns, which is what grants the adapter's read and the writer's encrypt."
  }
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

  # Deliberately narrower than `local.secret_arn_pattern`, which the adapter
  # reads with and which covers the shared secret too.
  delegated_credential_arn_pattern = "${local.secret_arn_pattern}/*"

  # Vercel's standard targets, in whatever order the set yields; a custom
  # environment like `staging` is not one of these and is handled by id.
  delegation_writer_standard_targets = local.delegation_writer_enabled ? tolist(setintersection(
    var.vercel_delegation_writer.runtime_environments,
    ["production", "preview", "development"],
  )) : []

  delegation_writer_trusts_staging = local.delegation_writer_enabled ? contains(
    tolist(var.vercel_delegation_writer.runtime_environments), "staging"
  ) : false

  delegation_writer_env_comment = "VRCLinking delegated-key storage managed by infra/terraform/vrclinking-adapter."

  # The region travels with the role. Vercel sets its own `AWS_REGION` to
  # wherever a function runs, so the web app refuses to infer this: without an
  # explicit value it would look configured everywhere and write each key into
  # whichever region served the request — a different store from the one the
  # adapter reads.
  delegation_writer_env_values = local.delegation_writer_enabled ? merge(
    {
      VRDEX_VRCLINKING_DELEGATION_ROLE_ARN = aws_iam_role.delegation_writer[0].arn
      VRDEX_VRCLINKING_SECRET_REGION       = data.aws_region.current.region
    },
    # `CreateSecret` without an explicit key silently uses the AWS-managed one,
    # and every reservation creates a *new* name — so there is no later
    # `PutSecretValue` to correct it. An installation that lists a customer-
    # managed key would otherwise have had every delegated credential created
    # outside it while this stack advertised support.
    var.delegation_writer_kms_key_id == null ? {} : {
      VRDEX_VRCLINKING_SECRET_KMS_KEY_ID = var.delegation_writer_kms_key_id
    },
  ) : {}
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

# Two path segments deep, which is what excludes the adapter's own shared
# secret. `vrdex/vrclinking/shared` holds the bearer token and the capability
# key; a grant over the whole `vrdex/vrclinking/` prefix would have let a
# compromised web runtime replace both with attacker-known values that take
# effect on the next Lambda cold start. Delegations live at
# `vrdex/vrclinking/<guild>/<credential>`, so the shape alone separates them.
data "aws_iam_policy_document" "delegation_writer" {
  count = local.delegation_writer_enabled ? 1 : 0

  statement {
    sid       = "ReplaceDelegatedCredentials"
    actions   = ["secretsmanager:PutSecretValue"]
    resources = [local.delegated_credential_arn_pattern]
  }

  # Names are per credential and never reused, so a key whose activation failed
  # is unreachable forever — nothing points at it and no later reservation can
  # land on the same name. Without this it stays in Secrets Manager
  # indefinitely: a community's live VRCLinking credential, retained by VRDex
  # for nothing.
  #
  # Wider than the write grant on purpose. A delegation created before
  # per-credential naming keeps its key one segment deep, at
  # `vrdex/vrclinking/<guildId>`, and retiring it is exactly what replacing or
  # revoking such a row has to do — the two-segment pattern would refuse. The
  # shared secret sits at that depth too, which is why it is denied by ARN
  # below; that Deny, not the pattern, is what protects it here.
  statement {
    sid       = "RetireOrphanedDelegatedCredentials"
    actions   = ["secretsmanager:DeleteSecret"]
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
      values   = ["${local.secret_name_prefix}*/*"]
    }
  }

  # Belt and braces over the shape rule above. The shared secret is the one
  # object in this prefix whose compromise would forge VRDex's own authorization
  # to the adapter, so it is denied by name rather than left to depend on a
  # wildcard staying narrow through future edits.
  statement {
    sid       = "NeverTouchTheSharedAdapterSecret"
    effect    = "Deny"
    actions   = ["secretsmanager:*"]
    resources = [var.shared_secret_arn]
  }

  # `PutSecretValue` on a secret encrypted with a customer-managed key also
  # needs the KMS grant, exactly as the adapter runtime does for reading one.
  # Without it, replacing a key through the form returns a 500 on precisely the
  # secrets an operator took the most care over. `GenerateDataKey` is the write
  # half; `Decrypt` is required alongside it to put a new version.
  dynamic "statement" {
    for_each = length(var.kms_key_arns) > 0 ? [1] : []

    content {
      sid = "EncryptCustomerManagedDelegatedCredentials"
      actions = [
        "kms:Decrypt",
        "kms:GenerateDataKey",
      ]
      resources = var.kms_key_arns

      condition {
        test     = "StringEquals"
        variable = "kms:ViaService"
        values   = ["secretsmanager.${data.aws_region.current.region}.amazonaws.com"]
      }
    }
  }
}

resource "aws_iam_role_policy" "delegation_writer" {
  count = local.delegation_writer_enabled ? 1 : 0

  name   = "vrclinking-delegation-write"
  role   = aws_iam_role.delegation_writer[0].id
  policy = data.aws_iam_policy_document.delegation_writer[0].json
}

# Derived from the same `runtime_environments` the trust policy is built from,
# rather than pinned to production. Hard-coding the target let the two diverge:
# an operator narrowing the role to `preview` would still have production
# rendering the delegation form as enabled — with an OIDC subject the role
# denies — while the environment actually trusted received no role ARN at all.
#
# Only Vercel's three standard targets can be named here. `staging` is a custom
# environment, so it is trusted by the role through `runtime_environments` and
# receives its variables through `staging_custom_environment_ids` below; that
# split is Vercel's, not ours.
resource "vercel_project_environment_variable" "delegation_writer_standard" {
  for_each = {
    for pair in setproduct(keys(local.delegation_writer_env_values), local.delegation_writer_standard_targets) :
    "${pair[0]}_${pair[1]}" => { key = pair[0], target = pair[1] }
  }

  project_id = data.vercel_project.web[0].id
  team_id    = var.vercel_delegation_writer.team_id
  key        = each.value.key
  value      = local.delegation_writer_env_values[each.value.key]
  target     = [each.value.target]
  sensitive  = true
  comment    = local.delegation_writer_env_comment
}

# Gated on `staging` actually being trusted, not just on ids being supplied.
# The standard targets are already intersected with `runtime_environments`; this
# one was not, so an operator narrowing the role to exclude `staging` while
# keeping its environment ids still injected both variables there — leaving
# staging advertising the delegation form while every role assumption it makes
# is denied.
resource "vercel_project_environment_variable" "delegation_writer_staging_custom" {
  for_each = local.delegation_writer_trusts_staging ? {
    for pair in setproduct(keys(local.delegation_writer_env_values), tolist(var.staging_custom_environment_ids)) :
    "${pair[0]}_${pair[1]}" => { key = pair[0], custom_environment_id = pair[1] }
  } : {}

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
