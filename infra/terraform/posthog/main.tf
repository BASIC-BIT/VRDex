resource "posthog_project" "vrdex" {
  organization_id = var.posthog_organization_id
  name            = var.posthog_project_name
  timezone        = var.posthog_timezone
}

resource "posthog_feature_flag" "seed_lookup_beta" {
  project_id = tostring(var.posthog_project_id)
  key        = "seed-lookup-beta"
  name       = "Private seed lookup beta"
  active     = true

  filters = jsonencode({
    groups = [{
      properties = [{
        key      = "seed_lookup_beta"
        type     = "person"
        value    = ["true"]
        operator = "exact"
      }]
      rollout_percentage = 100
    }]
  })

  tags = ["managed-by:terraform", "surface:onboarding"]
}

resource "posthog_feature_flag" "featured_discovery" {
  project_id = tostring(var.posthog_project_id)
  key        = "featured-discovery"
  name       = "Featured discovery placements"
  active     = false

  filters = jsonencode({
    groups = [{
      properties         = []
      rollout_percentage = 0
    }]
  })

  tags = ["managed-by:terraform", "surface:discovery"]
}
