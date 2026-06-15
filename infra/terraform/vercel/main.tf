data "vercel_project" "web" {
  name    = var.vercel_project_name
  team_id = var.vercel_team_id
}

data "aws_route53_zone" "web" {
  count = var.manage_production_domains && var.route53_zone_id == null ? 1 : 0

  name         = var.hosted_zone_name
  private_zone = false
}

locals {
  route53_zone_id = var.route53_zone_id != null ? var.route53_zone_id : try(data.aws_route53_zone.web[0].zone_id, null)

  posthog_comment = "VRDex PostHog project ${var.posthog_project_id} (${var.posthog_project_name})."

  standard_posthog_targets = merge(
    var.manage_production_environment ? { production = ["production"] } : {},
    var.manage_preview_environment ? { preview = ["preview"] } : {},
  )

  posthog_values = {
    NEXT_PUBLIC_POSTHOG_KEY  = var.posthog_public_key
    NEXT_PUBLIC_POSTHOG_HOST = var.posthog_host
  }
}

resource "vercel_project_domain" "production_apex" {
  count = var.manage_production_domains ? 1 : 0

  project_id = data.vercel_project.web.id
  team_id    = var.vercel_team_id
  domain     = var.production_domain
}

resource "vercel_project_domain" "production_www" {
  count = var.manage_production_domains ? 1 : 0

  project_id = data.vercel_project.web.id
  team_id    = var.vercel_team_id
  domain     = var.production_www_domain
}

resource "aws_route53_record" "production_apex" {
  count = var.manage_production_domains ? 1 : 0

  zone_id = local.route53_zone_id
  name    = var.production_domain
  type    = "A"
  ttl     = var.web_dns_record_ttl
  records = [var.vercel_a_record_value]
}

resource "aws_route53_record" "production_www" {
  count = var.manage_production_domains ? 1 : 0

  zone_id = local.route53_zone_id
  name    = var.production_www_domain
  type    = "A"
  ttl     = var.web_dns_record_ttl
  records = [var.vercel_a_record_value]
}

resource "vercel_project_environment_variable" "posthog_standard" {
  for_each = {
    for pair in setproduct(keys(local.posthog_values), keys(local.standard_posthog_targets)) : "${pair[0]}_${pair[1]}" => {
      key    = pair[0]
      target = local.standard_posthog_targets[pair[1]]
      value  = local.posthog_values[pair[0]]
    }
  }

  project_id = data.vercel_project.web.id
  team_id    = var.vercel_team_id
  key        = each.value.key
  value      = each.value.value
  target     = each.value.target
  sensitive  = true
  comment    = local.posthog_comment
}

resource "vercel_project_environment_variable" "posthog_staging_custom" {
  for_each = {
    for pair in setproduct(keys(local.posthog_values), var.staging_custom_environment_ids) : "${pair[0]}_${pair[1]}" => {
      key                   = pair[0]
      custom_environment_id = pair[1]
      value                 = local.posthog_values[pair[0]]
    }
  }

  project_id             = data.vercel_project.web.id
  team_id                = var.vercel_team_id
  key                    = each.value.key
  value                  = each.value.value
  custom_environment_ids = [each.value.custom_environment_id]
  sensitive              = true
  comment                = local.posthog_comment
}
