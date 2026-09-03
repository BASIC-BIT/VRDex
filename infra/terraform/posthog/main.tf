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

resource "posthog_dashboard" "claim_adoption" {
  name        = "Claim adoption and verification"
  description = "Sanitized claim-journey conversion, verification, terminal outcomes, and browser-to-backend reconciliation. Journey IDs are opaque random UUIDs; no user, profile, provider, proof, target, slug, or error identifiers are collected."
  pinned      = true
  tags        = ["managed-by:terraform", "surface:claim"]
}

resource "posthog_insight" "claim_journey_funnel" {
  name        = "Claim journey funnel"
  description = "Unique opaque journeys reaching each client and authoritative backend milestone over the last 30 days."
  query_json = jsonencode({
    kind = "DataTableNode"
    source = {
      kind  = "HogQLQuery"
      query = <<-HOGQL
        SELECT
          countIf(has(milestones, 'claim_journey_viewed')) AS viewed,
          countIf(has(milestones, 'claim_method_selected')) AS selected_method,
          countIf(has(milestones, 'claim_submitted')) AS submitted,
          countIf(has(milestones, 'claim_attempt_created')) AS backend_attempt_created,
          countIf(has(milestones, 'claim_verification_started')) AS verification_started,
          countIf(has(milestones, 'claim_resolved')) AS resolved
        FROM (
          SELECT
            properties.journey_id AS journey_id,
            groupUniqArray(event) AS milestones,
            max(if(event = 'claim_resolved' AND properties.connection_only = 'true', 1, 0)) AS connection_only
          FROM events
          WHERE event IN (
            'claim_journey_viewed',
            'claim_method_selected',
            'claim_submitted',
            'claim_attempt_created',
            'claim_verification_started',
            'claim_resolved'
          )
            AND timestamp >= now() - INTERVAL 30 DAY
            AND notEmpty(toString(properties.journey_id))
          GROUP BY journey_id
        )
        WHERE connection_only = 0
          AND has(milestones, 'claim_journey_viewed')
      HOGQL
    }
  })
  dashboard_ids = [posthog_dashboard.claim_adoption.id]
  tags          = ["managed-by:terraform", "surface:claim"]
}

resource "posthog_insight" "claim_terminal_outcomes" {
  name        = "Claim terminal outcomes"
  description = "Authoritative backend resolutions grouped by bounded outcome, excluding connection-only activity from claim conversion."
  query_json = jsonencode({
    kind = "InsightVizNode"
    source = {
      breakdownFilter = {
        breakdown      = "outcome"
        breakdown_type = "event"
      }
      interval = "day"
      kind     = "TrendsQuery"
      properties = [{
        key      = "connection_only"
        operator = "exact"
        type     = "event"
        value    = ["false"]
      }]
      series = [{
        event = "claim_resolved"
        kind  = "EventsNode"
        math  = "total"
      }]
    }
  })
  dashboard_ids = [posthog_dashboard.claim_adoption.id]
  tags          = ["managed-by:terraform", "surface:claim"]
}

resource "posthog_dashboard_layout" "claim_adoption" {
  dashboard_id = posthog_dashboard.claim_adoption.id

  tiles = [
    {
      insight_id       = posthog_insight.claim_journey_funnel.id
      layouts_json     = jsonencode({ sm = { x = 0, y = 0, w = 12, h = 5 } })
      show_description = true
    },
    {
      insight_id       = posthog_insight.claim_terminal_outcomes.id
      layouts_json     = jsonencode({ sm = { x = 0, y = 5, w = 12, h = 5 } })
      show_description = true
    },
  ]

  depends_on = [
    posthog_insight.claim_journey_funnel,
    posthog_insight.claim_terminal_outcomes,
  ]
}
