variable "aws_region" {
  description = "AWS region for Route 53 API calls. Route 53 is global, but the provider still needs a region."
  type        = string
  default     = "us-east-1"
}

variable "hosted_zone_name" {
  description = "Route 53 public hosted zone name for the hosted VRDex web domains."
  type        = string
  default     = "vrdex.net"
}

variable "route53_zone_id" {
  description = "Route 53 public hosted zone ID. Set this when the hosted zone name is ambiguous."
  type        = string
  default     = null
}

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

variable "production_domain" {
  description = "Primary production domain for the hosted VRDex web app."
  type        = string
  default     = "vrdex.net"
}

variable "production_www_domain" {
  description = "Secondary www production domain for the hosted VRDex web app."
  type        = string
  default     = "www.vrdex.net"
}

variable "web_dns_record_ttl" {
  description = "TTL, in seconds, for hosted production web Route 53 records."
  type        = number
  default     = 300
}

variable "vercel_a_record_value" {
  description = "Vercel A record target for apex and hosted web custom domains."
  type        = string
  default     = "76.76.21.21"
}

variable "tags" {
  description = "Additional resource tags."
  type        = map(string)
  default     = {}
}
