output "vercel_project_id" {
  description = "Existing Vercel project ID resolved by name."
  value       = data.vercel_project.web.id
}

output "production_domains" {
  description = "Production web domains managed by this stack."
  value = {
    primary = var.production_domain
    www     = var.production_www_domain
  }
}

output "route53_zone_id" {
  description = "Route 53 hosted zone ID used for production web records."
  value       = local.route53_zone_id
}
