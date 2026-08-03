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

# Clerk production instance DNS. Clerk issues the Frontend API and Account
# Portal certificates only once all five records resolve, and
# `CLERK_JWT_ISSUER_DOMAIN` on the Convex production deployment must be
# `https://${clerk_frontend_api_subdomain}.${hosted_zone_name}` — the same host
# the production publishable key encodes.
#
# The mail records are Clerk's own sender identity, unrelated to the SES stack:
# SES is retired for authentication, and Clerk sends its verification mail.
#
# These default to off with no targets. Hosted values live in the checked-in
# `hosted.tfvars`, which Terraform does not auto-load — it reads only
# `terraform.tfvars` and `*.auto.tfvars` — and which `terraform.yml` passes with
# `-var-file` only when the repository is `BASIC-BIT/VRDex`.
#
# Two failure modes shaped that. Defaulting them off with the targets in a
# gitignored `terraform.tfvars` meant CI could never create the records, so only
# an out-of-band apply could, and the next run from main destroyed them as
# orphaned state. Defaulting them *on* with BASIC BIT's instance id baked in
# fixed that but broke fork isolation: a self-hoster copying the example and
# changing only the domain would silently delegate their authentication-email DNS
# to BASIC BIT's Clerk tenant, which `docs/developers/self-hosting-and-iac.md`
# forbids. Neither the value nor the flag belongs in a committed default.

variable "manage_clerk_dns" {
  description = "Create the Clerk production CNAME records. Hosted CI sets this; leave false for self-hosted deployments and forks."
  type        = bool
  default     = false
}

variable "clerk_frontend_api_subdomain" {
  description = "Subdomain for the Clerk Frontend API. Must match the host encoded in the production publishable key."
  type        = string
  default     = "clerk"
}

variable "clerk_accounts_subdomain" {
  description = "Subdomain for the Clerk Account Portal."
  type        = string
  default     = "accounts"
}

variable "clerk_mail_subdomain" {
  description = "Subdomain Clerk sends authentication email from."
  type        = string
  default     = "clkmail"
}

variable "clerk_mail_target" {
  description = "Clerk-issued mail CNAME target for your own instance, e.g. mail.<id>.clerk.services."
  type        = string
  default     = null
}

variable "clerk_dkim1_target" {
  description = "Clerk-issued DKIM CNAME target for clk._domainkey on your own instance."
  type        = string
  default     = null
}

variable "clerk_dkim2_target" {
  description = "Clerk-issued DKIM CNAME target for clk2._domainkey on your own instance."
  type        = string
  default     = null
}
