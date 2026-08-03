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

# Must live in `aws_region`. `bootstrap.mjs` builds one
# `SecretsManagerClient` with the function default region, so a secret stored
# elsewhere plans and applies cleanly and then fails every cold start with
# `adapter_misconfigured` — a deployment correct in Terraform that answers
# nothing, whose only symptom is a 500.
variable "shared_secret_arn" {
  description = "Secrets Manager ARN of the JSON secret holding { bearerToken, capabilityKey }, in aws_region. One object rather than two so the pair cannot be observed mid-write."
  type        = string

  validation {
    condition     = can(regex("^arn:aws:secretsmanager:${var.aws_region}:[0-9]{12}:secret:", var.shared_secret_arn))
    error_message = "shared_secret_arn must be a Secrets Manager ARN in aws_region; the adapter resolves it through one regional client."
  }
}

# Empty is correct for the AWS-managed Secrets Manager key, which needs no
# explicit grant. A customer-managed key does: `GetSecretValue` on a secret
# encrypted with one also requires `kms:Decrypt`, and without it the stack
# deploys with valid ARNs and then answers `adapter_misconfigured` on every cold
# start, or reports every delegated consultation as unavailable.
variable "kms_key_arns" {
  description = "Customer-managed KMS key ARNs encrypting the shared secret or any delegated credential. Leave empty when they use the AWS-managed Secrets Manager key."
  type        = list(string)
  default     = []
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
  # resolves the shared secret first, unbounded, so a slow or retrying Secrets Manager
  # read could push the provider calls past the point Convex abandoned the
  # request. Those calls still spend a community's quota and still consume the
  # claimant's reserved cooldown, with no verdict able to reach anyone. Keeping
  # the ceiling under Convex's deadline makes that unreachable rather than
  # merely unlikely.
  default = 9

  # Enforced, not just described. A README warning does not constrain the input,
  # and the failure it prevents is silent — the overrun spends a community's
  # quota and the claimant's cooldown on a verdict nobody can receive, so
  # nothing surfaces to say the value was wrong.
  validation {
    condition     = var.timeout_seconds > 8 && var.timeout_seconds < 10
    error_message = "timeout_seconds must exceed the adapter's 8s fan-out budget and stay under Convex's 10s request deadline."
  }
}

variable "tags" {
  description = "Additional resource tags."
  type        = map(string)
  default     = {}
}
