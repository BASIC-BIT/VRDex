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

variable "profile_asset_bucket_name" {
  description = "S3 bucket name Terraform CI may manage for private profile media-kit assets. Defaults to vrdex-profile-assets plus account id."
  type        = string
  default     = null
}

variable "profile_asset_runtime_role_name" {
  description = "IAM role name Terraform CI may manage for Vercel profile asset runtime access."
  type        = string
  default     = "vrdex-vercel-profile-assets"
}

variable "vercel_team_slug" {
  description = "Vercel team slug used by the profile asset OIDC provider Terraform CI may manage."
  type        = string
  default     = "basicbit"
}

variable "legacy_vercel_team_slugs" {
  description = "Previous Vercel team slugs whose OIDC providers Terraform CI may manage during profile-assets state migration."
  type        = list(string)
  default     = ["basic-bit"]
}

variable "tags" {
  description = "Additional resource tags."
  type        = map(string)
  default     = {}
}
