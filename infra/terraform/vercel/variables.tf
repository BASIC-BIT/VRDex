variable "aws_region" {
  description = "AWS region for Route 53 API calls. Route 53 is global, but the provider still needs a region."
  type        = string
  default     = "us-east-1"
}

variable "hosted_zone_name" {
  description = "Route 53 public hosted zone name for the hosted VRDex web domains."
  type        = string
  default     = "vrdex.net"
}

variable "route53_zone_id" {
  description = "Route 53 public hosted zone ID. Set this when the hosted zone name is ambiguous."
  type        = string
  default     = null
}

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

variable "manage_production_domains" {
  description = "Whether to manage the hosted production web domains on the Vercel project and Route 53."
  type        = bool
  default     = true
}

variable "production_domain" {
  description = "Primary production domain for the hosted VRDex web app."
  type        = string
  default     = "vrdex.net"
}

variable "production_www_domain" {
  description = "Optional www production domain for the hosted VRDex web app."
  type        = string
  default     = "www.vrdex.net"
}

variable "web_dns_record_ttl" {
  description = "TTL, in seconds, for hosted production web Route 53 records."
  type        = number
  default     = 300
}

variable "vercel_a_record_value" {
  description = "Vercel A record target for apex and hosted web custom domains."
  type        = string
  default     = "76.76.21.21"
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
