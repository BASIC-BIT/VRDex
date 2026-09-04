variable "aws_region" {
  description = "AWS region for the account-scoped collector."
  type        = string
  default     = "us-east-1"
}

variable "name_prefix" {
  description = "Resource prefix for this collector account."
  type        = string
  default     = "vrdex-group-telemetry"
}

variable "container_image" {
  description = "Optional immutable collector image URI."
  type        = string
  default     = null

  validation {
    condition = !var.enable_service || (
      var.container_image != null &&
      can(regex("@sha256:[0-9a-fA-F]{64}$", trimspace(var.container_image)))
    )
    error_message = "container_image must be an immutable digest URI ending in @sha256:<64 hex characters> when enabled."
  }
}

variable "release_sha" {
  description = "Exact 40-character Git SHA embedded in the collector runtime."
  type        = string
  default     = "0000000000000000000000000000000000000000"

  validation {
    condition     = can(regex("^[0-9a-f]{40}$", var.release_sha))
    error_message = "release_sha must be an exact lowercase 40-character Git SHA."
  }
}

variable "release_version" {
  description = "Human-readable collector release version derived from the Git SHA."
  type        = string
  default     = "bootstrap"

  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9._-]{0,63}$", var.release_version))
    error_message = "release_version must be a short lowercase release identifier."
  }
}

variable "release_capabilities" {
  description = "Fixed protocol capabilities reported by this collector release."
  type        = list(string)
  default     = ["telemetry_v1", "vrchat_proof_v1"]

  validation {
    condition = (
      length(var.release_capabilities) > 0 &&
      length(var.release_capabilities) == length(distinct(var.release_capabilities)) &&
      alltrue([for capability in var.release_capabilities : can(regex("^[a-z0-9_]+$", capability))])
    )
    error_message = "release_capabilities must be a non-empty unique list of lowercase capability names."
  }
}

variable "enable_service" {
  description = "Create the ECS service only after the provider proof gate."
  type        = bool
  default     = false
}

variable "desired_count" {
  description = "Account-scoped worker count."
  type        = number
  default     = 0

  validation {
    condition     = var.desired_count >= 0 && var.desired_count <= 2 && (!var.enable_service || var.desired_count >= 1)
    error_message = "desired_count must be zero while disabled and between one and two while enabled."
  }
}

variable "subnet_ids" {
  description = "Subnets with HTTPS egress."
  type        = list(string)
  default     = []

  validation {
    condition     = !var.enable_service || length(var.subnet_ids) > 0
    error_message = "subnet_ids are required when enabled."
  }
}

variable "security_group_ids" {
  description = "Security groups with outbound HTTPS and no collector ingress."
  type        = list(string)
  default     = []

  validation {
    condition     = !var.enable_service || length(var.security_group_ids) > 0
    error_message = "security_group_ids are required when enabled."
  }
}

variable "assign_public_ip" {
  description = "Assign a public IP when public subnets are used."
  type        = bool
  default     = false
}

variable "convex_site_url" {
  description = "Convex HTTP action origin."
  type        = string
  default     = ""

  validation {
    condition     = !var.enable_service || can(regex("^https://", var.convex_site_url))
    error_message = "convex_site_url must use HTTPS when enabled."
  }
}

variable "collector_account_id" {
  description = "Convex collector account document ID."
  type        = string
  default     = ""

  validation {
    condition     = !var.enable_service || length(trimspace(var.collector_account_id)) > 0
    error_message = "collector_account_id is required when enabled."
  }
}

variable "account_secret_arn" {
  description = "Provider-approved Secrets Manager ARN containing this account workerApiKey, authCookie, and optional twoFactorAuthCookie; never a password or TOTP seed."
  type        = string
  default     = ""

  validation {
    condition     = !var.enable_service || can(regex("^arn:aws:secretsmanager:", var.account_secret_arn))
    error_message = "account_secret_arn must be a Secrets Manager ARN when enabled."
  }
}

variable "user_agent" {
  description = "Identifying application/version/contact User-Agent."
  type        = string
  default     = "VRDexGroupTelemetry/1.0 (contact: basic@basicbit.net)"
}

variable "requests_per_minute" {
  description = "Hard account-local request budget."
  type        = number
  default     = 30

  validation {
    condition     = var.requests_per_minute >= 2 && var.requests_per_minute <= 120
    error_message = "requests_per_minute must be between 2 and 120."
  }
}

variable "task_cpu" {
  description = "Fargate CPU units."
  type        = number
  default     = 256
}

variable "task_memory" {
  description = "Fargate memory MiB."
  type        = number
  default     = 512
}

variable "log_retention_days" {
  description = "CloudWatch log retention."
  type        = number
  default     = 30
}

variable "monthly_budget_usd" {
  description = "Monthly cost budget for resources carrying the collector component tag."
  type        = number
  default     = 30

  validation {
    condition     = var.monthly_budget_usd >= 5 && var.monthly_budget_usd <= 500
    error_message = "monthly_budget_usd must be between 5 and 500."
  }
}

variable "budget_alert_email" {
  description = "Operator email for AWS Budget alerts and every CloudWatch alarm in this module. SNS sends a one-time subscription confirmation to it on first apply."
  type        = string
  default     = ""

  validation {
    condition     = !var.enable_service || can(regex("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$", var.budget_alert_email))
    error_message = "budget_alert_email must be set to a valid address when enabled."
  }
}

variable "tags" {
  description = "Additional resource tags."
  type        = map(string)
  default     = {}
}
