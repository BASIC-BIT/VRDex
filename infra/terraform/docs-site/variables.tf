variable "aws_region" {
  description = "AWS region for Route 53 API calls. Route 53 is global, but the provider still needs a region."
  type        = string
  default     = "us-east-1"
}

variable "hosted_zone_name" {
  description = "Route 53 public hosted zone name for the docs domain."
  type        = string
  default     = "vrdex.net"
}

variable "route53_zone_id" {
  description = "Route 53 public hosted zone ID. Set this when the hosted zone name is ambiguous."
  type        = string
  default     = null
}

variable "docs_domain" {
  description = "Production domain for the public VRDex docs site."
  type        = string
  default     = "docs.vrdex.net"
}

variable "docs_dns_record_ttl" {
  description = "TTL, in seconds, for the docs.vrdex.net Route 53 record."
  type        = number
  default     = 300
}

variable "vercel_a_record_value" {
  description = "Vercel A record target for apex/subdomain custom domains."
  type        = string
  default     = "76.76.21.21"
}

variable "vercel_team_id" {
  description = "Vercel team ID that owns the VRDex docs project."
  type        = string
  default     = "team_GoHh5xUc96fAIAqJoG55A71S"
}

variable "vercel_docs_project_name" {
  description = "Vercel project name for the hosted docs site."
  type        = string
  default     = "vr-dex-docs"
}

variable "tags" {
  description = "Additional resource tags."
  type        = map(string)
  default     = {}
}
