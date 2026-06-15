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
