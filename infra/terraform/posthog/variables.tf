variable "posthog_host" {
  description = "PostHog API host for Terraform."
  type        = string
  default     = "https://us.posthog.com"

  validation {
    condition     = can(regex("^https://", var.posthog_host))
    error_message = "posthog_host must be an https URL."
  }
}

variable "posthog_organization_id" {
  description = "PostHog organization ID for BASIC BIT LLC."
  type        = string
  default     = "019e59b2-c822-0000-8123-12efe322af2d"
}

variable "posthog_project_id" {
  description = "Existing VRDex Analytics PostHog project ID."
  type        = number
  default     = 447783
}

variable "posthog_project_name" {
  description = "PostHog project name managed by this stack."
  type        = string
  default     = "VRDex Analytics"
}

variable "posthog_timezone" {
  description = "Timezone for PostHog reporting."
  type        = string
  default     = "UTC"
}
