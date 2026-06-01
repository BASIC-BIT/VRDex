variable "vercel_team_id" {
  description = "Vercel team ID that owns the VRDex web project."
  type        = string
  default     = "team_GoHh5xUc96fAIAqJoG55A71S"
}

variable "vercel_project_name" {
  description = "Existing Vercel project name for apps/web."
  type        = string
  default     = "vr-dex-web"
}

variable "manage_production_environment" {
  description = "Whether to manage production PostHog env vars on the Vercel project."
  type        = bool
  default     = true
}

variable "manage_preview_environment" {
  description = "Whether to manage default preview PostHog env vars on the Vercel project."
  type        = bool
  default     = true
}

variable "staging_custom_environment_ids" {
  description = "Vercel custom environment IDs for staging-like environments that should receive PostHog env vars. Empty leaves custom environments unmanaged."
  type        = set(string)
  default     = ["env_1iR8Tk53UMEhsbEgONsgGhzl9hX9"]
}

variable "posthog_project_id" {
  description = "PostHog project ID for operator reference."
  type        = number
  default     = 447783
}

variable "posthog_project_name" {
  description = "PostHog project name for operator reference."
  type        = string
  default     = "VRDex Analytics"
}

variable "posthog_public_key" {
  description = "PostHog project API key for NEXT_PUBLIC_POSTHOG_KEY. Client-exposed after deployment; keep out of git to avoid self-hosted installs sending events to BASIC BIT."
  type        = string
  sensitive   = true

  validation {
    condition     = startswith(var.posthog_public_key, "phc_")
    error_message = "posthog_public_key should be the PostHog project API key and normally starts with phc_."
  }
}

variable "posthog_host" {
  description = "PostHog ingestion host for NEXT_PUBLIC_POSTHOG_HOST."
  type        = string
  default     = "https://us.i.posthog.com"

  validation {
    condition     = can(regex("^https://", var.posthog_host))
    error_message = "posthog_host must be an https URL."
  }
}
