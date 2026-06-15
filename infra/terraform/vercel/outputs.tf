output "vercel_project_id" {
  description = "Existing Vercel project ID resolved by name."
  value       = data.vercel_project.web.id
}

output "posthog_project" {
  description = "PostHog project configured by this stack."
  value = {
    id   = var.posthog_project_id
    name = var.posthog_project_name
    host = var.posthog_host
  }
}

output "production_domains" {
  description = "Production web domains managed by this stack when enabled."
  value = var.manage_production_domains ? {
    primary = var.production_domain
    www     = var.production_www_domain
  } : null
}

output "managed_posthog_environment_keys" {
  description = "PostHog environment variable names managed by this stack."
  value       = keys(local.posthog_values)
}
