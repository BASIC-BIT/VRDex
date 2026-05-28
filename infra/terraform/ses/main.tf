data "aws_caller_identity" "current" {}

data "aws_route53_zone" "ses" {
  count = var.create_route53_records && var.route53_zone_id == null ? 1 : 0

  name         = var.hosted_zone_name != null ? var.hosted_zone_name : var.domain_name
  private_zone = false
}

locals {
  from_email       = var.from_email != null ? var.from_email : "no-reply@${var.domain_name}"
  mail_from_domain = "${var.mail_from_subdomain}.${var.domain_name}"
  route53_zone_id = var.route53_zone_id != null ? var.route53_zone_id : (
    var.create_route53_records ? data.aws_route53_zone.ses[0].zone_id : null
  )
  tags = merge(
    {
      Project   = "VRDex"
      ManagedBy = "Terraform"
      Component = "ses-auth-email"
    },
    var.tags,
  )
}

resource "aws_ses_domain_identity" "vrdex" {
  domain = var.domain_name
}

resource "aws_ses_domain_dkim" "vrdex" {
  domain = aws_ses_domain_identity.vrdex.domain
}

resource "aws_route53_record" "ses_domain_verification" {
  count = var.create_route53_records ? 1 : 0

  zone_id = local.route53_zone_id
  name    = "_amazonses.${aws_ses_domain_identity.vrdex.domain}"
  type    = "TXT"
  ttl     = 600
  records = [aws_ses_domain_identity.vrdex.verification_token]
}

resource "aws_ses_domain_identity_verification" "vrdex" {
  count = var.create_route53_records && var.wait_for_domain_verification ? 1 : 0

  domain = aws_ses_domain_identity.vrdex.domain

  depends_on = [aws_route53_record.ses_domain_verification]
}

resource "aws_route53_record" "ses_dkim" {
  count = var.create_route53_records ? 3 : 0

  zone_id = local.route53_zone_id
  name    = "${aws_ses_domain_dkim.vrdex.dkim_tokens[count.index]}._domainkey.${var.domain_name}"
  type    = "CNAME"
  ttl     = 600
  records = ["${aws_ses_domain_dkim.vrdex.dkim_tokens[count.index]}.dkim.amazonses.com"]
}

resource "aws_ses_domain_mail_from" "vrdex" {
  domain           = aws_ses_domain_identity.vrdex.domain
  mail_from_domain = local.mail_from_domain
}

resource "aws_route53_record" "ses_mail_from_mx" {
  count = var.create_route53_records ? 1 : 0

  zone_id = local.route53_zone_id
  name    = aws_ses_domain_mail_from.vrdex.mail_from_domain
  type    = "MX"
  ttl     = 600
  records = ["10 feedback-smtp.${var.aws_region}.amazonses.com"]
}

resource "aws_route53_record" "ses_mail_from_spf" {
  count = var.create_route53_records ? 1 : 0

  zone_id = local.route53_zone_id
  name    = aws_ses_domain_mail_from.vrdex.mail_from_domain
  type    = "TXT"
  ttl     = 600
  records = ["v=spf1 include:amazonses.com ~all"]
}

resource "aws_iam_user" "convex_ses_sender" {
  count = var.create_iam_access_key ? 1 : 0

  name = "vrdex-convex-ses-sender"
  path = "/service/"
}

data "aws_iam_policy_document" "convex_ses_sender" {
  count = var.create_iam_access_key ? 1 : 0

  statement {
    sid = "AllowSendingFromVRDexIdentity"
    actions = [
      "ses:SendEmail",
      "ses:SendRawEmail",
    ]
    resources = [aws_ses_domain_identity.vrdex.arn]
  }
}

resource "aws_iam_user_policy" "convex_ses_sender" {
  count = var.create_iam_access_key ? 1 : 0

  name   = "send-vrdex-auth-email"
  user   = aws_iam_user.convex_ses_sender[0].name
  policy = data.aws_iam_policy_document.convex_ses_sender[0].json
}

resource "aws_iam_access_key" "convex_ses_sender" {
  count = var.create_iam_access_key ? 1 : 0

  user = aws_iam_user.convex_ses_sender[0].name
}
