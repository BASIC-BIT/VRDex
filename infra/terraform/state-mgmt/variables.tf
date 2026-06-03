variable "aws_region" {
  description = "AWS region for the Terraform state bucket."
  type        = string
  default     = "us-east-1"
}

variable "state_bucket_name" {
  description = "S3 bucket name used by VRDex Terraform stacks for remote state."
  type        = string
  default     = "vrdex-terraform-state"
}

variable "github_repository" {
  description = "GitHub repository allowed to assume the Terraform CI role, in owner/name form."
  type        = string
  default     = "BASIC-BIT/VRDex"
}

variable "route53_zone_id" {
  description = "Route 53 public hosted zone ID that Terraform CI may manage."
  type        = string
}

variable "ses_domain_name" {
  description = "SES domain identity that Terraform CI may manage."
  type        = string
  default     = "vrdex.net"
}

variable "tags" {
  description = "Additional resource tags."
  type        = map(string)
  default     = {}
}
