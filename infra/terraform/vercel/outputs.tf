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

output "managed_posthog_environment_keys" {
  description = "PostHog environment variable names managed by this stack."
  value       = keys(local.posthog_values)
}
