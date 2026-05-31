output "posthog_project" {
  description = "PostHog project managed by this stack."
  value = {
    id       = posthog_project.vrdex.id
    name     = posthog_project.vrdex.name
    timezone = posthog_project.vrdex.timezone
  }
}

output "posthog_project_api_token" {
  description = "Client-exposed PostHog project key for the Vercel NEXT_PUBLIC_POSTHOG_KEY variable."
  value       = posthog_project.vrdex.api_token
  sensitive   = true
}
