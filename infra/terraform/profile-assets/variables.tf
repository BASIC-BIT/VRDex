variable "aws_region" {
  description = "AWS region for the private profile asset bucket. Vercel must set VRDEX_PROFILE_ASSET_REGION to the same value."
  type        = string
  default     = "us-east-1"
}

variable "asset_bucket_name" {
  description = "Optional S3 bucket name for private profile media-kit assets. Defaults to vrdex-profile-assets plus account id."
  type        = string
  default     = null
}

variable "runtime_role_name" {
  description = "IAM role name assumed by Vercel functions through OIDC for profile asset S3 access."
  type        = string
  default     = "vrdex-vercel-profile-assets"
}

variable "vercel_team_id" {
  description = "Vercel team ID that owns the VRDex web project."
  type        = string
  default     = "team_GoHh5xUc96fAIAqJoG55A71S"
}

variable "vercel_team_slug" {
  description = "Vercel team slug used in team-mode OIDC issuer and audience claims."
  type        = string
  default     = "basic-bit"
}

variable "vercel_project_name" {
  description = "Existing Vercel project name for apps/web. OIDC trust is scoped to this project name."
  type        = string
  default     = "vr-dex-web"
}

variable "vercel_runtime_environments" {
  description = "Vercel deployment environment names allowed to assume the profile asset runtime role."
  type        = set(string)
  default     = ["production", "staging"]
}

variable "manage_production_environment" {
  description = "Whether to manage production profile asset env vars on the Vercel project."
  type        = bool
  default     = true
}

variable "staging_custom_environment_ids" {
  description = "Vercel custom environment IDs for staging-like environments that should receive profile asset env vars. Empty leaves custom environments unmanaged."
  type        = set(string)
  default     = []
}

variable "tags" {
  description = "Additional resource tags."
  type        = map(string)
  default     = {}
}
