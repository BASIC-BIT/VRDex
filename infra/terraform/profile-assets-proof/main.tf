data "aws_caller_identity" "current" {}

locals {
  bucket_name  = "vrdex-profile-assets-proof-${data.aws_caller_identity.current.account_id}"
  proof_prefix = "profile-assets/proof/local-upload/"
  tags = {
    Project   = "VRDex"
    ManagedBy = "Terraform"
    Component = "profile-assets-proof"
  }
}

resource "aws_s3_bucket" "proof" {
  bucket = local.bucket_name
  tags   = local.tags
}

resource "aws_s3_bucket_public_access_block" "proof" {
  bucket = aws_s3_bucket.proof.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "proof" {
  bucket = aws_s3_bucket.proof.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "proof" {
  bucket = aws_s3_bucket.proof.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "proof" {
  bucket = aws_s3_bucket.proof.id

  rule {
    id     = "expire-local-upload-proof"
    status = "Enabled"

    filter {
      prefix = local.proof_prefix
    }

    expiration {
      days = 7
    }
  }
}

data "aws_iam_policy_document" "proof_bucket" {
  statement {
    sid    = "DenyInsecureTransport"
    effect = "Deny"

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    actions = ["s3:*"]
    resources = [
      aws_s3_bucket.proof.arn,
      "${aws_s3_bucket.proof.arn}/*",
    ]

    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

resource "aws_s3_bucket_policy" "proof" {
  bucket = aws_s3_bucket.proof.id
  policy = data.aws_iam_policy_document.proof_bucket.json
}
