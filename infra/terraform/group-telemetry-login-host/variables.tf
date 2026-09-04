variable "aws_region" {
  description = "AWS region; must match the collector stack."
  type        = string
  default     = "us-east-1"
}

variable "name" {
  description = "Name for the host, its role, and its instance profile."
  type        = string
  default     = "vrdex-egress-login-host"
}

variable "subnet_id" {
  description = "The collector stack's fixed-egress private subnet (its aws_subnet.egress). The host must leave through the same NAT gateway as the collector."
  type        = string
}

variable "security_group_id" {
  description = "Ingress-free security group with outbound HTTPS; the collector's egress group works."
  type        = string
}

variable "ami_id" {
  description = "Pinned Amazon Linux 2023 arm64 AMI. Pinned on purpose: a moving AMI would replace the host on every apply."
  type        = string
  default     = "ami-07987a01dcdb011ef"
}

variable "instance_type" {
  description = "Smallest Graviton instance; the host only relays a handful of login requests."
  type        = string
  default     = "t4g.nano"
}

variable "running" {
  description = "Start the host. Leave false between recoveries; a stopped host costs only its 8 GiB volume."
  type        = bool
  default     = false
}

variable "tags" {
  description = "Additional resource tags."
  type        = map(string)
  default     = {}
}
