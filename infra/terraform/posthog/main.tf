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

resource "posthog_feature_flag" "temporal_parsing_beta" {
  project_id = tostring(var.posthog_project_id)
  key        = "temporal-parsing-beta"
  name       = "Temporal parsing beta"
  active     = true

  filters = jsonencode({
    groups = [{
      properties = [{
        key      = "temporal_parsing_beta"
        type     = "person"
        value    = ["true"]
        operator = "exact"
      }]
      rollout_percentage = 100
    }]
  })

  tags = ["managed-by:terraform", "surface:temporal"]
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

resource "posthog_dashboard" "auth_session_health" {
  name        = "Authentication session health"
  description = "Aggregate restoration and session-state health. Contains no application user, account, session, token, provider, email, redirect, or route identifiers."
  pinned      = true
  tags        = ["managed-by:terraform", "surface:authentication"]
}

resource "posthog_insight" "auth_restore_outcomes" {
  name        = "Authentication restore outcomes"
  description = "Completed authentication restoration grouped by coarse authenticated or anonymous outcome."
  query_json = jsonencode({
    kind = "InsightVizNode"
    source = {
      breakdownFilter = {
        breakdown      = "outcome"
        breakdown_type = "event"
      }
      interval = "day"
      kind     = "TrendsQuery"
      series = [{
        event = "auth_session_restore_completed"
        kind  = "EventsNode"
        math  = "total"
      }]
    }
  })
  dashboard_ids = [posthog_dashboard.auth_session_health.id]
  tags          = ["managed-by:terraform", "surface:authentication"]
}

resource "posthog_insight" "auth_restore_latency" {
  name        = "Authentication restore latency"
  description = "Completed authentication restoration grouped by coarse latency bucket."
  query_json = jsonencode({
    kind = "InsightVizNode"
    source = {
      breakdownFilter = {
        breakdown      = "latency_bucket"
        breakdown_type = "event"
      }
      interval = "day"
      kind     = "TrendsQuery"
      series = [{
        event = "auth_session_restore_completed"
        kind  = "EventsNode"
        math  = "total"
      }]
    }
  })
  dashboard_ids = [posthog_dashboard.auth_session_health.id]
  tags          = ["managed-by:terraform", "surface:authentication"]
}

resource "posthog_insight" "auth_restore_slow" {
  name        = "Slow authentication restores"
  description = "Restoration that remains unresolved after ten seconds."
  query_json = jsonencode({
    kind = "InsightVizNode"
    source = {
      interval = "day"
      kind     = "TrendsQuery"
      series = [{
        event = "auth_session_restore_slow"
        kind  = "EventsNode"
        math  = "total"
      }]
    }
  })
  dashboard_ids = [posthog_dashboard.auth_session_health.id]
  tags          = ["managed-by:terraform", "surface:authentication"]
}

resource "posthog_insight" "auth_state_change_intent" {
  name        = "Authentication state-change intent"
  description = "Coarse authenticated-to-anonymous transitions grouped by explicit current-tab sign-out or unclassified intent."
  query_json = jsonencode({
    kind = "InsightVizNode"
    source = {
      breakdownFilter = {
        breakdown      = "intent"
        breakdown_type = "event"
      }
      interval = "day"
      kind     = "TrendsQuery"
      properties = [
        {
          key      = "from"
          operator = "exact"
          type     = "event"
          value    = ["authenticated"]
        },
        {
          key      = "to"
          operator = "exact"
          type     = "event"
          value    = ["anonymous"]
        },
      ]
      series = [{
        event = "auth_session_state_changed"
        kind  = "EventsNode"
        math  = "total"
      }]
    }
  })
  dashboard_ids = [posthog_dashboard.auth_session_health.id]
  tags          = ["managed-by:terraform", "surface:authentication"]
}

resource "posthog_insight" "auth_restore_by_deployment" {
  name        = "Authentication restores by deployment"
  description = "Completed authentication restoration grouped by coarse deployment category."
  query_json = jsonencode({
    kind = "InsightVizNode"
    source = {
      breakdownFilter = {
        breakdown      = "deployment_category"
        breakdown_type = "event"
      }
      interval = "day"
      kind     = "TrendsQuery"
      series = [{
        event = "auth_session_restore_completed"
        kind  = "EventsNode"
        math  = "total"
      }]
    }
  })
  dashboard_ids = [posthog_dashboard.auth_session_health.id]
  tags          = ["managed-by:terraform", "surface:authentication"]
}

resource "posthog_insight" "auth_restore_by_browser" {
  name        = "Authentication restores by browser family"
  description = "Completed authentication restoration grouped by coarse browser family."
  query_json = jsonencode({
    kind = "InsightVizNode"
    source = {
      breakdownFilter = {
        breakdown      = "browser_family"
        breakdown_type = "event"
      }
      interval = "day"
      kind     = "TrendsQuery"
      series = [{
        event = "auth_session_restore_completed"
        kind  = "EventsNode"
        math  = "total"
      }]
    }
  })
  dashboard_ids = [posthog_dashboard.auth_session_health.id]
  tags          = ["managed-by:terraform", "surface:authentication"]
}

resource "posthog_dashboard_layout" "auth_session_health" {
  dashboard_id = posthog_dashboard.auth_session_health.id

  tiles = [
    {
      insight_id       = posthog_insight.auth_restore_outcomes.id
      layouts_json     = jsonencode({ sm = { x = 0, y = 0, w = 6, h = 5 } })
      show_description = true
    },
    {
      insight_id       = posthog_insight.auth_restore_latency.id
      layouts_json     = jsonencode({ sm = { x = 6, y = 0, w = 6, h = 5 } })
      show_description = true
    },
    {
      insight_id       = posthog_insight.auth_restore_slow.id
      layouts_json     = jsonencode({ sm = { x = 0, y = 5, w = 6, h = 5 } })
      show_description = true
    },
    {
      insight_id       = posthog_insight.auth_state_change_intent.id
      layouts_json     = jsonencode({ sm = { x = 6, y = 5, w = 6, h = 5 } })
      show_description = true
    },
    {
      insight_id       = posthog_insight.auth_restore_by_deployment.id
      layouts_json     = jsonencode({ sm = { x = 0, y = 10, w = 6, h = 5 } })
      show_description = true
    },
    {
      insight_id       = posthog_insight.auth_restore_by_browser.id
      layouts_json     = jsonencode({ sm = { x = 6, y = 10, w = 6, h = 5 } })
      show_description = true
    },
  ]

  depends_on = [
    posthog_insight.auth_restore_by_browser,
    posthog_insight.auth_restore_by_deployment,
    posthog_insight.auth_restore_latency,
    posthog_insight.auth_restore_outcomes,
    posthog_insight.auth_restore_slow,
    posthog_insight.auth_state_change_intent,
  ]
}
