resource "posthog_project" "vrdex" {
  organization_id = var.posthog_organization_id
  name            = var.posthog_project_name
  timezone        = var.posthog_timezone
}
