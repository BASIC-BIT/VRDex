data "aws_caller_identity" "current" {}

data "vercel_project" "web" {
  name    = var.vercel_project_name
  team_id = var.vercel_team_id
}

locals {
  asset_bucket_name = var.asset_bucket_name != null ? var.asset_bucket_name : "vrdex-profile-assets-${data.aws_caller_identity.current.account_id}"
  object_prefix     = "profile-assets/"
  storage_probe_key = "${local.object_prefix}.vrdex-storage-probe"

  vercel_oidc_issuer_path = "oidc.vercel.com/${var.vercel_team_slug}"
  vercel_oidc_issuer_url  = "https://${local.vercel_oidc_issuer_path}"
  vercel_oidc_audience    = "https://vercel.com/${var.vercel_team_slug}"
  vercel_oidc_subjects = [
    for environment in var.vercel_runtime_environments : "owner:${var.vercel_team_slug}:project:${var.vercel_project_name}:environment:${environment}"
  ]

  runtime_env_comment = "VRDex private profile asset storage managed by infra/terraform/profile-assets."
  runtime_env_values = {
    VRDEX_PROFILE_ASSET_BUCKET   = aws_s3_bucket.profile_assets.bucket
    VRDEX_PROFILE_ASSET_REGION   = var.aws_region
    VRDEX_PROFILE_ASSET_ROLE_ARN = aws_iam_role.vercel_profile_assets.arn
  }

  standard_vercel_targets = var.manage_production_environment ? { production = ["production"] } : {}

  tags = merge(
    {
      Project   = "VRDex"
      ManagedBy = "Terraform"
      Component = "profile-assets"
    },
    var.tags,
  )
}

data "tls_certificate" "vercel_oidc" {
  url = local.vercel_oidc_issuer_url
}

resource "aws_s3_bucket" "profile_assets" {
  bucket = local.asset_bucket_name
  tags   = local.tags
}

resource "aws_s3_bucket_public_access_block" "profile_assets" {
  bucket = aws_s3_bucket.profile_assets.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "profile_assets" {
  bucket = aws_s3_bucket.profile_assets.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "profile_assets" {
  bucket = aws_s3_bucket.profile_assets.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

data "aws_iam_policy_document" "profile_assets_bucket" {
  statement {
    sid    = "DenyInsecureTransport"
    effect = "Deny"

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    actions = ["s3:*"]

    resources = [
      aws_s3_bucket.profile_assets.arn,
      "${aws_s3_bucket.profile_assets.arn}/*",
    ]

    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

resource "aws_s3_bucket_policy" "profile_assets" {
  bucket = aws_s3_bucket.profile_assets.id
  policy = data.aws_iam_policy_document.profile_assets_bucket.json
}

resource "aws_iam_openid_connect_provider" "vercel" {
  url             = local.vercel_oidc_issuer_url
  client_id_list  = [local.vercel_oidc_audience]
  thumbprint_list = [data.tls_certificate.vercel_oidc.certificates[0].sha1_fingerprint]

  tags = local.tags
}

data "aws_iam_policy_document" "vercel_profile_assets_assume_role" {
  statement {
    effect = "Allow"

    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.vercel.arn]
    }

    actions = ["sts:AssumeRoleWithWebIdentity"]

    condition {
      test     = "StringEquals"
      variable = "${local.vercel_oidc_issuer_path}:aud"
      values   = [local.vercel_oidc_audience]
    }

    condition {
      test     = "StringEquals"
      variable = "${local.vercel_oidc_issuer_path}:sub"
      values   = local.vercel_oidc_subjects
    }
  }
}

resource "aws_iam_role" "vercel_profile_assets" {
  name               = var.runtime_role_name
  assume_role_policy = data.aws_iam_policy_document.vercel_profile_assets_assume_role.json
  tags               = local.tags
}

data "aws_iam_policy_document" "vercel_profile_assets" {
  statement {
    sid = "CheckProfileAssetStorageProbe"
    actions = [
      "s3:ListBucket",
    ]

    resources = [aws_s3_bucket.profile_assets.arn]

    condition {
      test     = "StringEquals"
      variable = "s3:prefix"
      values   = [local.storage_probe_key]
    }
  }

  statement {
    sid = "ReadAndWriteProfileAssets"
    actions = [
      "s3:GetObject",
      "s3:PutObject",
    ]

    resources = ["${aws_s3_bucket.profile_assets.arn}/${local.object_prefix}*"]
  }
}

resource "aws_iam_role_policy" "vercel_profile_assets" {
  name   = "profile-assets-s3-access"
  role   = aws_iam_role.vercel_profile_assets.id
  policy = data.aws_iam_policy_document.vercel_profile_assets.json
}

resource "vercel_project_environment_variable" "profile_assets_standard" {
  for_each = {
    for pair in setproduct(keys(local.runtime_env_values), keys(local.standard_vercel_targets)) : "${pair[0]}_${pair[1]}" => {
      key    = pair[0]
      target = local.standard_vercel_targets[pair[1]]
      value  = local.runtime_env_values[pair[0]]
    }
  }

  project_id = data.vercel_project.web.id
  team_id    = var.vercel_team_id
  key        = each.value.key
  value      = each.value.value
  target     = each.value.target
  sensitive  = true
  comment    = local.runtime_env_comment
}

resource "vercel_project_environment_variable" "profile_assets_staging_custom" {
  for_each = {
    for pair in setproduct(keys(local.runtime_env_values), var.staging_custom_environment_ids) : "${pair[0]}_${pair[1]}" => {
      key                   = pair[0]
      custom_environment_id = pair[1]
      value                 = local.runtime_env_values[pair[0]]
    }
  }

  project_id             = data.vercel_project.web.id
  team_id                = var.vercel_team_id
  key                    = each.value.key
  value                  = each.value.value
  custom_environment_ids = [each.value.custom_environment_id]
  sensitive              = true
  comment                = local.runtime_env_comment
}
