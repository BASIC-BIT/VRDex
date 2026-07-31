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
  description = "Whether to manage shared production env vars on the Vercel project."
  type        = bool
  default     = true
}

variable "manage_preview_environment" {
  description = "Whether to manage shared default preview env vars on the Vercel project."
  type        = bool
  default     = true
}

variable "staging_custom_environment_ids" {
  description = "Vercel custom environment IDs for staging-like environments that should receive shared env vars. Empty leaves custom environments unmanaged."
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

variable "temporal_input_hash_key" {
  description = "Server-only HMAC key for temporal input hashes and idempotency fingerprints."
  type        = string
  sensitive   = true

  validation {
    condition     = length(trimspace(var.temporal_input_hash_key)) >= 32
    error_message = "temporal_input_hash_key must contain at least 32 characters."
  }
}

variable "twitch_client_id" {
  description = "Optional server-only Twitch application client ID used for profile live status. Set with twitch_client_secret to manage both Vercel values."
  type        = string
  sensitive   = true
  default     = null
  nullable    = true
}

variable "twitch_client_secret" {
  description = "Optional server-only Twitch application client secret used for profile live status."
  type        = string
  sensitive   = true
  default     = null
  nullable    = true
}

# Clerk instances are per-environment, so unlike the Twitch credentials these
# cannot be one pair applied to every target: production must carry a `pk_live_`
# key, which `apps/web/scripts/check-vercel-env.mjs` enforces at build time, and
# preview/staging carry the development instance's `pk_test_` pair. Supplying the
# wrong tier fails the build rather than silently authenticating against the
# wrong instance.
#
# Both pairs default to null and manage nothing when unset, so a stack that
# already has these values set by hand in the Vercel dashboard stays untouched
# until someone opts in by supplying them.

variable "clerk_production_publishable_key" {
  description = "Optional Clerk publishable key (pk_live_...) for the production environment. Public by design; set with clerk_production_secret_key to manage both Vercel values."
  type        = string
  default     = null
  nullable    = true

  validation {
    condition     = var.clerk_production_publishable_key == null || startswith(var.clerk_production_publishable_key, "pk_live_")
    error_message = "clerk_production_publishable_key must be a live Clerk publishable key (pk_live_...)."
  }
}

variable "clerk_production_secret_key" {
  description = "Optional Clerk secret key (sk_live_...) for the production environment."
  type        = string
  sensitive   = true
  default     = null
  nullable    = true
}

variable "clerk_preview_publishable_key" {
  description = "Optional Clerk publishable key (pk_test_...) for preview and staging environments. Public by design; set with clerk_preview_secret_key to manage both Vercel values."
  type        = string
  default     = null
  nullable    = true

  validation {
    condition     = var.clerk_preview_publishable_key == null || startswith(var.clerk_preview_publishable_key, "pk_test_")
    error_message = "clerk_preview_publishable_key must be a development Clerk publishable key (pk_test_...)."
  }
}

variable "clerk_preview_secret_key" {
  description = "Optional Clerk secret key (sk_test_...) for preview and staging environments."
  type        = string
  sensitive   = true
  default     = null
  nullable    = true
}
