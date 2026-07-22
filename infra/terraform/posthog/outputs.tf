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

output "seed_lookup_beta_feature_flag" {
  description = "PostHog flag that mirrors the backend-authorized seed lookup beta audience."
  value = {
    id  = posthog_feature_flag.seed_lookup_beta.id
    key = posthog_feature_flag.seed_lookup_beta.key
  }
}

output "temporal_parsing_beta_feature_flag" {
  description = "PostHog flag that mirrors the backend-authorized temporal parsing beta audience."
  value = {
    id  = posthog_feature_flag.temporal_parsing_beta.id
    key = posthog_feature_flag.temporal_parsing_beta.key
  }
}

output "featured_discovery_feature_flag" {
  description = "PostHog flag that controls Featured placements on the unlisted discovery surface."
  value = {
    id  = posthog_feature_flag.featured_discovery.id
    key = posthog_feature_flag.featured_discovery.key
  }
}
