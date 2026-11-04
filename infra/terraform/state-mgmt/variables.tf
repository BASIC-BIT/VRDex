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

# Owner transfer. GitHub OIDC subjects change when the repository moves to a new
# owner, so the roles also trust the new-owner subjects in a separate statement
# pinned to the immutable repository and owner IDs. Remove this and the
# BASIC-BIT subject after a clean week under the new owner. Defaults to null so
# self-hosted deployments never trust this repository; the hosted deployment sets
# it in terraform.tfvars (see terraform.tfvars.example).
variable "github_transfer_trust" {
  description = "Transitional GitHub OIDC trust for this repository under its new owner. Subjects are owner/name prefixes; the statement also requires the exact repository and owner IDs. Null disables it."
  type = object({
    repository_id       = string
    repository_owner_id = string
    repositories        = list(string)
  })
  default = null

  validation {
    condition = var.github_transfer_trust == null ? true : (
      length(var.github_transfer_trust.repositories) > 0 &&
      can(regex("^[0-9]+$", var.github_transfer_trust.repository_id)) &&
      can(regex("^[0-9]+$", var.github_transfer_trust.repository_owner_id))
    )
    error_message = "github_transfer_trust needs at least one repository and numeric repository_id and repository_owner_id."
  }
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

variable "staging_profile_asset_bucket_name" {
  description = "Separate staging S3 bucket name Terraform CI may manage. Defaults to vrdex-profile-assets-staging plus account id."
  type        = string
  default     = null
}

variable "profile_asset_runtime_role_name" {
  description = "IAM role name Terraform CI may manage for Vercel profile asset runtime access."
  type        = string
  default     = "vrdex-vercel-profile-assets"
}

variable "staging_profile_asset_runtime_role_name" {
  description = "Staging IAM runtime role name Terraform CI may manage."
  type        = string
  default     = "vrdex-vercel-profile-assets-staging"
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
