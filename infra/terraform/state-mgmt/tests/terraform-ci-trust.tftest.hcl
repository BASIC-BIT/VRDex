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

run "terraform_ci_trust_transfer_disabled" {
  command = plan

  variables {
    github_transfer_trust = null
  }

  assert {
    condition     = length(data.aws_iam_policy_document.github_actions_terraform_assume_role.statement) == 1
    error_message = "A null transfer trust must leave only the configured repository statement."
  }
}
