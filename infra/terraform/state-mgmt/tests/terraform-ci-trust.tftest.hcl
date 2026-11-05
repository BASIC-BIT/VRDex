mock_provider "aws" {
  mock_data "aws_caller_identity" {
    defaults = { account_id = "079358094174" }
  }

  mock_data "aws_iam_openid_connect_provider" {
    defaults = { arn = "arn:aws:iam::079358094174:oidc-provider/token.actions.githubusercontent.com" }
  }

  mock_data "aws_iam_policy_document" {
    # The rendered JSON is mocked; these runs assert on the configured statements.
    defaults = { json = "{\"Version\":\"2012-10-17\",\"Statement\":[]}" }
  }
}

variables {
  route53_zone_id = "ZTESTONLY"
}

run "terraform_ci_trust" {
  command = plan

  variables {
    github_transfer_trust = {
      repository_id       = "1176245711"
      repository_owner_id = "350167065"
      repositories        = ["BITRATE-Labs/VRDex", "BITRATE-Labs@350167065/VRDex@1176245711"]
    }
  }

  assert {
    condition = length(data.aws_iam_policy_document.github_actions_terraform_assume_role.statement) == 2 && {
      for c in data.aws_iam_policy_document.github_actions_terraform_assume_role.statement[0].condition : c.variable => "${c.test} ${join(",", c.values)}"
      } == {
      "token.actions.githubusercontent.com:aud" = "StringEquals sts.amazonaws.com"
      "token.actions.githubusercontent.com:sub" = "StringLike repo:BASIC-BIT/VRDex:*"
    }
    error_message = "The existing BASIC-BIT statement must stay as it was: audience plus the repo:BASIC-BIT/VRDex:* subject."
  }

  assert {
    condition = {
      for c in data.aws_iam_policy_document.github_actions_terraform_assume_role.statement[1].condition : c.variable => "${c.test} ${join(",", c.values)}"
      } == {
      "token.actions.githubusercontent.com:aud"                 = "StringEquals sts.amazonaws.com"
      "token.actions.githubusercontent.com:repository_id"       = "StringEquals 1176245711"
      "token.actions.githubusercontent.com:repository_owner_id" = "StringEquals 350167065"
      "token.actions.githubusercontent.com:sub"                 = "StringLike repo:BITRATE-Labs/VRDex:*,repo:BITRATE-Labs@350167065/VRDex@1176245711:*"
    }
    error_message = "The new-owner statement must pin audience, repository ID and owner ID, and accept only the new-owner subjects."
  }
}

run "terraform_ci_trust_default" {
  command = plan

  assert {
    condition     = length(data.aws_iam_policy_document.github_actions_terraform_assume_role.statement) == 1
    error_message = "By default only the configured repository statement exists, so self-hosted deployments never trust this repository."
  }
}

run "self_hosted_repository" {
  command = plan

  variables {
    github_repository                          = "test-owner/self-hosted"
    enable_discord_gateway_release_permissions = true
    enable_restream_proof_image_permissions    = true
  }

  assert {
    condition = (
      length(data.aws_iam_policy_document.github_actions_terraform_assume_role.statement) == 1 &&
      length(jsondecode(aws_iam_role.discord_gateway_release[0].assume_role_policy).Statement) == 1 &&
      length(jsondecode(aws_iam_role.restream_proof_image[0].assume_role_policy).Statement) == 1
    )
    error_message = "A self-hosted repository without github_transfer_trust must not trust this repository on any role."
  }

  assert {
    condition     = [for c in data.aws_iam_policy_document.github_actions_terraform_assume_role.statement[0].condition : join(",", c.values) if c.variable == "token.actions.githubusercontent.com:sub"] == ["repo:test-owner/self-hosted:*"]
    error_message = "The only Terraform CI subject must be the self-hosted repository."
  }
}

run "transfer_trust_rejects_empty_subjects" {
  command = plan

  variables {
    github_transfer_trust = {
      repository_id       = "1176245711"
      repository_owner_id = "350167065"
      repositories        = []
    }
  }

  expect_failures = [var.github_transfer_trust]
}
