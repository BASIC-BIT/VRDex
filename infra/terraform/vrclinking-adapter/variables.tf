variable "aws_region" {
  description = "AWS region for the VRCLinking proof adapter."
  type        = string
  default     = "us-east-1"
}

variable "name_prefix" {
  description = "Name prefix for VRCLinking adapter resources."
  type        = string
  default     = "vrdex-vrclinking-adapter"
}

variable "enable_service" {
  description = "Whether to create the function and its Function URL. Defaults off so the stack can be planned before VRCLinking delegation is turned on."
  type        = bool
  default     = false
}

variable "source_zip_path" {
  description = "Path to the packaged adapter zip, relative to this directory. Built by scripts/package-vrclinking-adapter.mjs."
  type        = string
  default     = "../../../artifacts/vrclinking-adapter.zip"
}

# The secrets themselves are provisioned outside this stack — one per
# participating community, created by an operator when that community delegates.
# The stack grants read access to the name prefix rather than to a list, so
# onboarding a community is not a Terraform change.
variable "secret_name_prefix" {
  description = "Secrets Manager name prefix the adapter may read. Every delegation reference must live under it."
  type        = string
  default     = "vrdex/vrclinking/"
}

variable "bearer_token_secret_arn" {
  description = "Secrets Manager ARN holding the shared adapter bearer token. Must match Convex's VRCHAT_PROOF_ADAPTER_BEARER_TOKEN."
  type        = string
}

variable "capability_key_secret_arn" {
  description = "Secrets Manager ARN holding the capability signing key. Must match Convex's VRCLINKING_ADAPTER_CAPABILITY_KEY, and must be a different value from the bearer token."
  type        = string
}

variable "provider_base_url" {
  description = "VRCLinking API base URL. Override only to point at a stub; https is required unless it is loopback."
  type        = string
  default     = "https://vrclinking.com/api"
}

variable "log_retention_days" {
  description = "CloudWatch log retention for the adapter."
  type        = number
  default     = 30
}

variable "reserved_concurrency" {
  description = "Reserved concurrent executions. Bounds how much of a community's VRCLinking quota a burst of claims can spend."
  type        = number
  default     = 5
}

variable "timeout_seconds" {
  description = "Function timeout. Must exceed the adapter's own 8s fan-out budget and stay under Convex's 10s request deadline."
  type        = number
  default     = 15
}

variable "tags" {
  description = "Additional resource tags."
  type        = map(string)
  default     = {}
}
