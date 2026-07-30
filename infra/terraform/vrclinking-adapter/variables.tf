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
  # 9, not 15: the description has always named both bounds and the default only
  # honoured one of them. Above 10 the function outlives the caller, and the
  # fan-out budget is not the only thing inside the window — a cold start
  # resolves two secrets first, unbounded, so a slow or retrying Secrets Manager
  # read could push the provider calls past the point Convex abandoned the
  # request. Those calls still spend a community's quota and still consume the
  # claimant's reserved cooldown, with no verdict able to reach anyone. Keeping
  # the ceiling under Convex's deadline makes that unreachable rather than
  # merely unlikely.
  default = 9
}

variable "tags" {
  description = "Additional resource tags."
  type        = map(string)
  default     = {}
}
