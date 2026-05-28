variable "aws_region" {
  description = "AWS region for the SES identity. Convex must use the same value as AWS_SES_REGION."
  type        = string
  default     = "us-east-1"
}

variable "domain_name" {
  description = "Domain identity to verify in SES, for example vrdex.app."
  type        = string
}

variable "from_email" {
  description = "Email address Convex Auth should use as AWS_SES_FROM_EMAIL. Defaults to no-reply@domain_name."
  type        = string
  default     = null
}

variable "mail_from_subdomain" {
  description = "Subdomain for SES custom MAIL FROM."
  type        = string
  default     = "bounce"
}

variable "hosted_zone_name" {
  description = "Route 53 public hosted zone name. Defaults to domain_name when Route 53 records are enabled."
  type        = string
  default     = null
}

variable "route53_zone_id" {
  description = "Route 53 public hosted zone id. Set this when the zone name is ambiguous."
  type        = string
  default     = null
}

variable "create_route53_records" {
  description = "Whether Terraform should create SES verification, DKIM, SPF, and MAIL FROM records in Route 53."
  type        = bool
  default     = true
}

variable "wait_for_domain_verification" {
  description = "Whether Terraform should wait for SES domain identity verification after DNS records are created."
  type        = bool
  default     = false
}

variable "create_iam_access_key" {
  description = "Whether to create a least-privilege IAM access key for Convex SES SendEmail calls. Store the secret output in Convex env, never in git."
  type        = bool
  default     = true
}

variable "tags" {
  description = "Additional resource tags."
  type        = map(string)
  default     = {}
}
