data "aws_route53_zone" "docs" {
  count = var.route53_zone_id == null ? 1 : 0

  name         = var.hosted_zone_name
  private_zone = false
}

locals {
  route53_zone_id = var.route53_zone_id != null ? var.route53_zone_id : data.aws_route53_zone.docs[0].zone_id

  tags = merge(
    {
      Project   = "VRDex"
      ManagedBy = "Terraform"
      Component = "docs-site"
    },
    var.tags,
  )
}

resource "vercel_project" "docs" {
  name            = var.vercel_docs_project_name
  team_id         = var.vercel_team_id
  skew_protection = "12 hours"
}

resource "vercel_project_domain" "docs" {
  project_id = vercel_project.docs.id
  team_id    = var.vercel_team_id
  domain     = var.docs_domain
}

resource "aws_route53_record" "docs" {
  zone_id = local.route53_zone_id
  name    = var.docs_domain
  type    = "A"
  ttl     = var.docs_dns_record_ttl
  records = [var.vercel_a_record_value]
}
