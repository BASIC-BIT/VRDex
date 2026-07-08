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
  description = "Whether to manage production rate-limit env vars on the Vercel project."
  type        = bool
  default     = true
}

variable "manage_preview_environment" {
  description = "Whether to manage default preview rate-limit env vars on the Vercel project. Keep false unless preview traffic should share this Redis store."
  type        = bool
  default     = false
}

variable "staging_custom_environment_ids" {
  description = "Vercel custom environment IDs for staging-like environments that should receive rate-limit env vars. Empty leaves custom environments unmanaged."
  type        = set(string)
  default     = ["env_1iR8Tk53UMEhsbEgONsgGhzl9hX9"]
}

variable "upstash_email" {
  description = "Upstash account email used by the Terraform provider."
  type        = string
  sensitive   = true

  validation {
    condition     = can(regex("^.+@.+\\..+$", var.upstash_email))
    error_message = "upstash_email must look like an email address."
  }
}

variable "upstash_api_key" {
  description = "Upstash API key used by the Terraform provider."
  type        = string
  sensitive   = true
}

variable "upstash_database_name" {
  description = "Upstash Redis database name for hosted API/MCP rate-limit counters."
  type        = string
  default     = "vrdex-rate-limit"

  validation {
    condition     = can(regex("^[A-Za-z0-9][A-Za-z0-9 _.-]{2,62}[A-Za-z0-9]$", var.upstash_database_name))
    error_message = "upstash_database_name must be 4-64 characters and start/end with an alphanumeric character."
  }
}

variable "upstash_region" {
  description = "Upstash Redis database region. Use global for an AWS global database with primary_region/read_regions."
  type        = string
  default     = "global"

  validation {
    condition     = can(regex("^[a-z0-9-]+$", var.upstash_region))
    error_message = "upstash_region must use lowercase letters, numbers, and dashes."
  }
}

variable "upstash_primary_region" {
  description = "Primary region for the Upstash global Redis database."
  type        = string
  default     = "us-east-1"
}

variable "upstash_read_regions" {
  description = "Optional additional Upstash read regions for the global Redis database."
  type        = set(string)
  default     = []
}

variable "upstash_budget" {
  description = "Monthly Upstash database budget in USD. When reached, Upstash throttles the database until the next month."
  type        = number
  default     = 20

  validation {
    condition     = var.upstash_budget >= 0
    error_message = "upstash_budget must be non-negative."
  }
}

variable "upstash_auto_scale" {
  description = "Whether Upstash may automatically upgrade the database when it hits quotas."
  type        = bool
  default     = false
}

variable "upstash_prod_pack" {
  description = "Whether Upstash Prod Pack is enabled for this database."
  type        = bool
  default     = false
}

variable "upstash_eviction" {
  description = "Whether Upstash may evict keys when the database reaches max size. Keep false for production rate-limit enforcement unless an operator accepts undercount risk."
  type        = bool
  default     = false
}

variable "upstash_ip_allowlist" {
  description = "Optional CIDR allowlist for the Upstash database. Empty allows all source IPs."
  type        = set(string)
  default     = []
}

variable "rate_limit_store_mode" {
  description = "Runtime store mode written to VRDEX_RATE_LIMIT_STORE."
  type        = string
  default     = "upstash"

  validation {
    condition     = contains(["redis-rest", "upstash"], var.rate_limit_store_mode)
    error_message = "rate_limit_store_mode must be redis-rest or upstash."
  }
}

variable "redis_key_prefix" {
  description = "Prefix for VRDex rate-limit keys in the Redis database."
  type        = string
  default     = "vrdex:rate-limit"

  validation {
    condition     = can(regex("^[A-Za-z0-9:_-]{1,64}$", var.redis_key_prefix))
    error_message = "redis_key_prefix must be 1-64 characters using letters, numbers, colon, underscore, or dash."
  }
}
