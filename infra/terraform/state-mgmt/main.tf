locals {
  state_bucket_arn = "arn:aws:s3:::${var.state_bucket_name}"

  tags = merge(
    {
      Project   = "VRDex"
      ManagedBy = "Terraform"
      Component = "terraform-state"
    },
    var.tags,
  )
}

data "aws_caller_identity" "current" {}

data "aws_iam_openid_connect_provider" "github_actions" {
  url = "https://token.actions.githubusercontent.com"
}

resource "aws_s3_bucket" "terraform_state" {
  bucket = var.state_bucket_name

  tags = {
    ManagedBy = "manual-bootstrap"
  }
}

resource "aws_s3_bucket_public_access_block" "terraform_state" {
  bucket = aws_s3_bucket.terraform_state.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "terraform_state" {
  bucket = aws_s3_bucket.terraform_state.id

  rule {
    bucket_key_enabled = true

    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_versioning" "terraform_state" {
  bucket = aws_s3_bucket.terraform_state.id

  versioning_configuration {
    status = "Enabled"
  }
}

data "aws_iam_policy_document" "terraform_state" {
  statement {
    sid    = "DenyInsecureTransport"
    effect = "Deny"

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    actions = ["s3:*"]

    resources = [
      aws_s3_bucket.terraform_state.arn,
      "${aws_s3_bucket.terraform_state.arn}/*",
    ]

    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

resource "aws_s3_bucket_policy" "terraform_state" {
  bucket = aws_s3_bucket.terraform_state.id
  policy = data.aws_iam_policy_document.terraform_state.json
}

data "aws_iam_policy_document" "github_actions_terraform_assume_role" {
  statement {
    effect = "Allow"

    principals {
      type        = "Federated"
      identifiers = [data.aws_iam_openid_connect_provider.github_actions.arn]
    }

    actions = ["sts:AssumeRoleWithWebIdentity"]

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    condition {
      test     = "StringLike"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["repo:${var.github_repository}:*"]
    }
  }
}

resource "aws_iam_role" "github_actions_terraform" {
  name               = "vrdex-github-terraform"
  assume_role_policy = data.aws_iam_policy_document.github_actions_terraform_assume_role.json
}

data "aws_iam_policy_document" "github_actions_terraform" {
  statement {
    sid = "TerraformStateAccess"

    actions = [
      "s3:ListBucket",
      "s3:GetBucketLocation",
    ]

    resources = [local.state_bucket_arn]
  }

  statement {
    sid = "TerraformStateObjectAccess"

    actions = [
      "s3:GetObject",
      "s3:PutObject",
      "s3:DeleteObject",
    ]

    resources = ["${local.state_bucket_arn}/*"]
  }

  statement {
    sid = "Route53ZoneChanges"

    actions = [
      "route53:ChangeResourceRecordSets",
      "route53:GetHostedZone",
      "route53:ListResourceRecordSets",
    ]

    resources = ["arn:aws:route53:::hostedzone/${var.route53_zone_id}"]
  }

  statement {
    sid = "Route53ZoneDiscovery"

    actions = [
      "route53:ListHostedZones",
      "route53:ListHostedZonesByName",
    ]

    resources = ["*"]
  }

  statement {
    sid = "SesDomainIdentityManagement"

    actions = [
      "ses:DeleteIdentity",
      "ses:GetIdentityDkimAttributes",
      "ses:GetIdentityMailFromDomainAttributes",
      "ses:GetIdentityVerificationAttributes",
      "ses:SetIdentityMailFromDomain",
      "ses:VerifyDomainDkim",
      "ses:VerifyDomainIdentity",
    ]

    resources = ["arn:aws:ses:${var.aws_region}:${data.aws_caller_identity.current.account_id}:identity/${var.ses_domain_name}"]
  }

  statement {
    sid = "SesIdentityDiscovery"

    actions = [
      "ses:ListIdentities",
    ]

    resources = ["*"]
  }

  statement {
    sid = "ConvexSesSenderIamManagement"

    actions = [
      "iam:CreateAccessKey",
      "iam:CreateUser",
      "iam:DeleteAccessKey",
      "iam:DeleteUser",
      "iam:DeleteUserPolicy",
      "iam:GetUser",
      "iam:GetUserPolicy",
      "iam:ListAccessKeys",
      "iam:ListGroupsForUser",
      "iam:ListUserPolicies",
      "iam:PutUserPolicy",
      "iam:TagUser",
      "iam:UntagUser",
      "iam:UpdateAccessKey",
    ]

    resources = ["arn:aws:iam::${data.aws_caller_identity.current.account_id}:user/service/vrdex-convex-ses-sender"]
  }
}

resource "aws_iam_role_policy" "github_actions_terraform" {
  name   = "vrdex-terraform-ci"
  role   = aws_iam_role.github_actions_terraform.id
  policy = data.aws_iam_policy_document.github_actions_terraform.json
}
