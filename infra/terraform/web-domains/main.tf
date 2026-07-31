data "aws_route53_zone" "web" {
  count = var.route53_zone_id == null ? 1 : 0

  name         = var.hosted_zone_name
  private_zone = false
}

data "vercel_project" "web" {
  name    = var.vercel_project_name
  team_id = var.vercel_team_id
}

locals {
  route53_zone_id = var.route53_zone_id != null ? var.route53_zone_id : data.aws_route53_zone.web[0].zone_id
}

resource "vercel_project_domain" "production_apex" {
  project_id = data.vercel_project.web.id
  team_id    = var.vercel_team_id
  domain     = var.production_domain
}

resource "vercel_project_domain" "production_www" {
  project_id = data.vercel_project.web.id
  team_id    = var.vercel_team_id
  domain     = var.production_www_domain
}

resource "aws_route53_record" "production_apex" {
  zone_id = local.route53_zone_id
  name    = var.production_domain
  type    = "A"
  ttl     = var.web_dns_record_ttl
  records = [var.vercel_a_record_value]
}

resource "aws_route53_record" "production_www" {
  zone_id = local.route53_zone_id
  name    = var.production_www_domain
  type    = "A"
  ttl     = var.web_dns_record_ttl
  records = [var.vercel_a_record_value]
}

# Clerk production instance records. Gated on `manage_clerk_dns` so the stack
# stays appliable before the Clerk production instance exists, and so a partial
# set is never created — Clerk issues no certificate until all five resolve.
locals {
  clerk_records = var.manage_clerk_dns ? {
    frontend_api = {
      name   = var.clerk_frontend_api_subdomain
      target = "frontend-api.clerk.services"
    }
    accounts = {
      name   = var.clerk_accounts_subdomain
      target = "accounts.clerk.services"
    }
    mail = {
      name   = var.clerk_mail_subdomain
      target = var.clerk_mail_target
    }
    dkim1 = {
      name   = "clk._domainkey"
      target = var.clerk_dkim1_target
    }
    dkim2 = {
      name   = "clk2._domainkey"
      target = var.clerk_dkim2_target
    }
  } : {}
}

resource "aws_route53_record" "clerk" {
  for_each = local.clerk_records

  zone_id = local.route53_zone_id
  name    = "${each.value.name}.${var.hosted_zone_name}"
  type    = "CNAME"
  ttl     = var.web_dns_record_ttl
  records = [each.value.target]

  lifecycle {
    precondition {
      condition     = each.value.target != null
      error_message = "manage_clerk_dns is true but the ${each.key} target is unset. Clerk issues these per instance; copy them from Configure > Domains."
    }
  }
}
