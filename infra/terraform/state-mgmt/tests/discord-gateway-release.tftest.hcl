mock_provider "aws" {
  mock_data "aws_caller_identity" {
    defaults = { account_id = "079358094174" }
  }

  mock_data "aws_iam_openid_connect_provider" {
    defaults = { arn = "arn:aws:iam::079358094174:oidc-provider/token.actions.githubusercontent.com" }
  }

  mock_data "aws_iam_policy_document" {
    # Unrelated bootstrap policies need valid JSON for schema validation. The
    # release trust and permissions are evaluated from their real jsonencode.
    defaults = { json = "{\"Version\":\"2012-10-17\",\"Statement\":[]}" }
  }
}

variables {
  route53_zone_id = "ZTESTONLY"
}

run "default_disabled" {
  command = plan

  assert {
    condition     = length(aws_iam_role.discord_gateway_release) == 0
    error_message = "The release role must be absent unless explicitly enabled."
  }
}

run "enabled_release_role" {
  command = plan

  variables {
    enable_discord_gateway_release_permissions = true
  }

  assert {
    condition = jsondecode(aws_iam_role.discord_gateway_release[0].assume_role_policy) == {
      Version = "2012-10-17"
      Statement = [{
        Effect    = "Allow"
        Action    = "sts:AssumeRoleWithWebIdentity"
        Principal = { Federated = "arn:aws:iam::079358094174:oidc-provider/token.actions.githubusercontent.com" }
        Condition = {
          StringEquals = {
            "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
            "token.actions.githubusercontent.com:sub" = "repo:BASIC-BIT/VRDex:ref:refs/heads/main"
          }
        }
      }]
    }
    error_message = "Trust must allow only the existing GitHub provider, STS audience and exact repository main subject."
  }

  assert {
    condition     = aws_iam_role.discord_gateway_release[0].name == "vrdex-discord-gateway-release"
    error_message = "The release role name is what the bootstrap runbook stores in GitHub."
  }

  assert {
    condition     = alltrue([for s in jsondecode(aws_iam_role_policy.discord_gateway_release[0].policy).Statement : !contains(flatten([s.Action]), "secretsmanager:GetSecretValue")])
    error_message = "The release role must never read secret values."
  }

  assert {
    condition     = one([for s in jsondecode(aws_iam_role_policy.discord_gateway_release[0].policy).Statement : s if s.Sid == "RollGatewayService"]).Resource == "arn:aws:ecs:us-east-1:079358094174:service/vrdex-discord-gateway/vrdex-discord-gateway"
    error_message = "UpdateService must be scoped to the one gateway service."
  }

  assert {
    condition     = length([for s in jsondecode(aws_iam_role_policy.discord_gateway_release[0].policy).Statement : s if contains(flatten([s.Action]), "ecs:UpdateService")]) == 1
    error_message = "No other statement may grant UpdateService."
  }

  assert {
    condition     = one([for s in jsondecode(aws_iam_role_policy.discord_gateway_release[0].policy).Statement : s if s.Sid == "NotifyGatewayReleaseFailure"]).Resource == "arn:aws:sns:us-east-1:079358094174:vrdex-group-telemetry-alerts"
    error_message = "Release failure notices may publish only to the alerts topic."
  }

  assert {
    condition = one([for s in jsondecode(aws_iam_role_policy.discord_gateway_release[0].policy).Statement : s if s.Sid == "ReadGatewayRoles"]).Resource == [
      "arn:aws:iam::079358094174:role/vrdex-discord-gateway-execution",
      "arn:aws:iam::079358094174:role/vrdex-discord-gateway-task",
    ]
    error_message = "Role reads must be scoped to the two gateway roles."
  }

  assert {
    condition     = alltrue([for action in one([for s in jsondecode(aws_iam_role_policy.discord_gateway_release[0].policy).Statement : s if s.Sid == "RefreshGatewayStack"]).Action : !startswith(action, "iam:")])
    error_message = "RefreshGatewayStack sits on * and must not hold IAM reads."
  }

  assert {
    condition     = one([for s in jsondecode(aws_iam_role_policy.discord_gateway_release[0].policy).Statement : s if s.Sid == "ReadGatewaySecretMetadata"]).Resource == "arn:aws:secretsmanager:us-east-1:079358094174:secret:vrdex/discord-gateway/*"
    error_message = "Secret metadata reads must be scoped to the gateway's secrets."
  }
}
