output "docs_domain" {
  description = "Production domain for the public VRDex docs site."
  value       = var.docs_domain
}

output "vercel_docs_project_id" {
  description = "Vercel project ID for GitHub secret VERCEL_DOCS_PROJECT_ID."
  value       = vercel_project.docs.id
}

output "route53_record_fqdn" {
  description = "Fully qualified Route 53 record created for the docs site."
  value       = aws_route53_record.docs.fqdn
}

output "route53_zone_id" {
  description = "Route 53 public hosted zone ID used by this stack."
  value       = local.route53_zone_id
}
