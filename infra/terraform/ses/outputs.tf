output "aws_ses_region" {
  description = "Set this as AWS_SES_REGION in Convex."
  value       = var.aws_region
}

output "aws_ses_from_email" {
  description = "Set this as AWS_SES_FROM_EMAIL in Convex."
  value       = local.from_email
}

output "ses_identity_arn" {
  description = "SES identity ARN allowed by the generated IAM sender policy."
  value       = aws_ses_domain_identity.vrdex.arn
}

output "ses_domain_verification_record" {
  description = "Manual DNS record to create if create_route53_records is false."
  value = {
    name  = "_amazonses.${aws_ses_domain_identity.vrdex.domain}"
    type  = "TXT"
    value = aws_ses_domain_identity.vrdex.verification_token
  }
}

output "ses_dkim_records" {
  description = "Manual DKIM CNAME records to create if create_route53_records is false."
  value = [
    for token in aws_ses_domain_dkim.vrdex.dkim_tokens : {
      name  = "${token}._domainkey.${var.domain_name}"
      type  = "CNAME"
      value = "${token}.dkim.amazonses.com"
    }
  ]
}

output "ses_mail_from_records" {
  description = "Manual custom MAIL FROM DNS records to create if create_route53_records is false."
  value = [
    {
      name  = local.mail_from_domain
      type  = "MX"
      value = "10 feedback-smtp.${var.aws_region}.amazonses.com"
    },
    {
      name  = local.mail_from_domain
      type  = "TXT"
      value = "v=spf1 include:amazonses.com ~all"
    },
  ]
}

output "aws_access_key_id" {
  description = "Set this as AWS_ACCESS_KEY_ID in Convex when create_iam_access_key is true."
  value       = var.create_iam_access_key ? aws_iam_access_key.convex_ses_sender[0].id : null
  sensitive   = true
}

output "aws_secret_access_key" {
  description = "Set this as AWS_SECRET_ACCESS_KEY in Convex when create_iam_access_key is true."
  value       = var.create_iam_access_key ? aws_iam_access_key.convex_ses_sender[0].secret : null
  sensitive   = true
}
