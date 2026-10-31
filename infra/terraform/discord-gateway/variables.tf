variable "container_image" {
  description = "Immutable gateway image URI. Required when the service is enabled."
  type        = string
  default     = null

  # A conditional, not `||`: Terraform 1.10 does not short-circuit `||`.
  validation {
    condition     = var.enable_service ? can(regex("@sha256:[0-9a-fA-F]{64}$", var.container_image)) : true
    error_message = "container_image must be an immutable digest URI ending in @sha256:<64 hex characters> when enabled."
  }
}

variable "enable_service" {
  description = "Run the gateway service and its alarm."
  type        = bool
  default     = false
}

variable "convex_site_url" {
  description = "Convex HTTP action origin."
  type        = string
  default     = ""

  validation {
    condition     = var.enable_service ? can(regex("^https://", var.convex_site_url)) : true
    error_message = "convex_site_url must use HTTPS when enabled."
  }
}

variable "egress_subnet_name" {
  description = "Name tag of the NAT subnet owned by the group telemetry collector stack."
  type        = string
  default     = "vrdex-group-telemetry-egress"
}

variable "alerts_topic_name" {
  description = "SNS topic owned by the group telemetry collector stack."
  type        = string
  default     = "vrdex-group-telemetry-alerts"
}

variable "tags" {
  description = "Additional resource tags."
  type        = map(string)
  default     = {}
}
