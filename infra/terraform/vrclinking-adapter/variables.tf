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

# Both must live in `aws_region`. `bootstrap.mjs` builds one
# `SecretsManagerClient` with the function's default region and sends every ARN
# to that endpoint, so a secret stored elsewhere plans and applies cleanly and
# then fails every cold start with `adapter_misconfigured` — a deployment that
# looks correct in Terraform and answers nothing. Caught here rather than at
# runtime, where the only symptom is a 500.
variable "bearer_token_secret_arn" {
  description = "Secrets Manager ARN holding the shared adapter bearer token, in aws_region. Must match Convex's VRCHAT_PROOF_ADAPTER_BEARER_TOKEN."
  type        = string

  validation {
    condition     = can(regex("^arn:aws:secretsmanager:${var.aws_region}:\\d{12}:secret:", var.bearer_token_secret_arn))
    error_message = "bearer_token_secret_arn must be a Secrets Manager ARN in aws_region; the adapter resolves every secret through one regional client."
  }
}

variable "capability_key_secret_arn" {
  description = "Secrets Manager ARN holding the capability signing key, in aws_region. Must match Convex's VRCLINKING_ADAPTER_CAPABILITY_KEY, and must be a different value from the bearer token."
  type        = string

  validation {
    condition     = can(regex("^arn:aws:secretsmanager:${var.aws_region}:\\d{12}:secret:", var.capability_key_secret_arn))
    error_message = "capability_key_secret_arn must be a Secrets Manager ARN in aws_region; the adapter resolves every secret through one regional client."
  }
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
