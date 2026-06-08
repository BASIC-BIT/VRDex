variable "aws_region" {
  description = "AWS region for the hosted restream worker benchmark foundation."
  type        = string
  default     = "us-east-1"
}

variable "name_prefix" {
  description = "Name prefix for restream worker benchmark resources."
  type        = string
  default     = "vrdex-restream-worker"
}

variable "container_image" {
  description = "Optional full image URI for the restream worker task definition. Defaults to this stack's ECR repository plus benchmark-placeholder tag."
  type        = string
  default     = null
}

variable "artifact_bucket_name" {
  description = "Optional S3 bucket name for private restream worker benchmark artifacts. Defaults to name_prefix plus account id plus -artifacts."
  type        = string
  default     = null
}

variable "artifact_retention_days" {
  description = "Number of days to retain private benchmark artifacts in S3."
  type        = number
  default     = 7
}

variable "synthetic_benchmark_only" {
  description = "Whether benchmark tasks run only synthetic media and may start without provider credential references."
  type        = bool
  default     = true
}

variable "task_cpu" {
  description = "Fargate task CPU units for one event-session worker. 4096 is the first benchmark shape for the 1080p60 gate."
  type        = number
  default     = 4096

  validation {
    condition     = contains([1024, 2048, 4096, 8192, 16384], var.task_cpu)
    error_message = "task_cpu must be a valid Fargate CPU value."
  }
}

variable "task_memory" {
  description = "Fargate task memory in MiB for one event-session worker."
  type        = number
  default     = 8192
}

variable "container_cpu" {
  description = "Container-level CPU units reserved for the restream worker container."
  type        = number
  default     = 4096
}

variable "container_memory" {
  description = "Container-level memory in MiB reserved for the restream worker container."
  type        = number
  default     = 8192
}

variable "ephemeral_storage_gib" {
  description = "Ephemeral storage in GiB for FFmpeg scratch files and benchmark artifacts."
  type        = number
  default     = 40
}

variable "max_concurrent_workers" {
  description = "Non-secret benchmark guardrail for maximum simultaneously running hosted restream workers."
  type        = number
  default     = 10
}

variable "max_session_seconds" {
  description = "Non-secret benchmark guardrail for maximum worker runtime per event media session. Defaults to 12 hours."
  type        = number
  default     = 43200
}

variable "convex_url" {
  description = "Convex control-plane URL injected into benchmark workers. Keep deployment keys and tokens out of this value."
  type        = string
  default     = ""
}

variable "secret_arns" {
  description = "Map of container environment names to Secrets Manager or SSM secret ARNs. Values are references only, never secret values."
  type        = map(string)
  default     = {}
}

variable "log_retention_days" {
  description = "CloudWatch Logs retention for hosted restream worker logs."
  type        = number
  default     = 14
}

variable "enable_container_insights" {
  description = "Whether to enable ECS Container Insights for the benchmark cluster."
  type        = bool
  default     = true
}

variable "kill_switch_enabled_default" {
  description = "Initial non-secret SSM kill-switch value. False keeps hosted workers disabled until explicitly enabled during an approved benchmark."
  type        = bool
  default     = false
}

variable "tags" {
  description = "Additional resource tags."
  type        = map(string)
  default     = {}
}
