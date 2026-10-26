mock_provider "aws" {
  mock_data "aws_caller_identity" {
    defaults = { account_id = "079358094174" }
  }

  mock_data "aws_iam_openid_connect_provider" {
    defaults = { arn = "arn:aws:iam::079358094174:oidc-provider/token.actions.githubusercontent.com" }
  }

  mock_data "aws_iam_policy_document" {
    # Unrelated bootstrap policies need valid JSON for schema validation. The
    # publisher trust and permissions are evaluated from their real jsonencode.
    defaults = { json = "{\"Version\":\"2012-10-17\",\"Statement\":[]}" }
  }
}

variables {
  route53_zone_id = "ZTESTONLY"
}

run "default_disabled" {
  command = plan

  assert {
    condition     = length(aws_iam_role.restream_proof_image) == 0 && length(aws_iam_role_policy.restream_proof_image) == 0
    error_message = "The publisher role and policy must be absent unless explicitly enabled."
  }
}

run "enabled_publisher" {
  command = plan

  variables {
    enable_restream_proof_image_permissions = true
  }

  assert {
    condition = (
      length(aws_iam_role.restream_proof_image) == 1 &&
      length(aws_iam_role_policy.restream_proof_image) == 1 &&
      aws_iam_role.restream_proof_image[0].name == "vrdex-restream-proof-image" &&
      aws_iam_role_policy.restream_proof_image[0].name == "vrdex-restream-proof-image" &&
      aws_iam_role_policy.restream_proof_image[0].role == aws_iam_role.restream_proof_image[0].name
    )
    error_message = "Image publication must use a dedicated role, never the Terraform role."
  }

  assert {
    condition = jsondecode(aws_iam_role.restream_proof_image[0].assume_role_policy) == {
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
    condition = jsondecode(aws_iam_role_policy.restream_proof_image[0].policy) == {
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
    }
    error_message = "The complete publisher policy must contain only registry auth and exact-repository push/DescribeImages and digest-recovery pull rights."
  }
}

run "configured_repository" {
  command = plan

  variables {
    enable_restream_proof_image_permissions = true
    github_repository                       = "test-owner/proof-publisher"
  }

  assert {
    condition     = jsondecode(aws_iam_role.restream_proof_image[0].assume_role_policy).Statement[0].Condition.StringEquals["token.actions.githubusercontent.com:sub"] == "repo:test-owner/proof-publisher:ref:refs/heads/main"
    error_message = "The main-only subject must follow the configured repository."
  }
}
