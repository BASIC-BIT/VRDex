data "vercel_project" "web" {
  name    = var.vercel_project_name
  team_id = var.vercel_team_id
}

locals {
  posthog_comment = "VRDex PostHog project ${var.posthog_project_id} (${var.posthog_project_name})."

  standard_posthog_targets = merge(
    var.manage_production_environment ? { production = ["production"] } : {},
    var.manage_preview_environment ? { preview = ["preview"] } : {},
  )

  posthog_values = {
    NEXT_PUBLIC_POSTHOG_KEY  = var.posthog_public_key
    NEXT_PUBLIC_POSTHOG_HOST = var.posthog_host
  }

  standard_twitch_targets = merge(
    var.manage_production_environment ? { production = ["production"] } : {},
    var.manage_preview_environment ? { preview = ["preview"] } : {},
  )

  manage_twitch = nonsensitive(var.twitch_client_id != null && var.twitch_client_secret != null)
  twitch_keys   = local.manage_twitch ? toset(["TWITCH_CLIENT_ID", "TWITCH_CLIENT_SECRET"]) : toset([])

  twitch_values = local.manage_twitch ? {
    TWITCH_CLIENT_ID     = var.twitch_client_id
    TWITCH_CLIENT_SECRET = var.twitch_client_secret
  } : {}
}

resource "vercel_project_environment_variable" "posthog_standard" {
  for_each = {
    for pair in setproduct(keys(local.posthog_values), keys(local.standard_posthog_targets)) : "${pair[0]}_${pair[1]}" => {
      key    = pair[0]
      target = local.standard_posthog_targets[pair[1]]
      value  = local.posthog_values[pair[0]]
    }
  }

  project_id = data.vercel_project.web.id
  team_id    = var.vercel_team_id
  key        = each.value.key
  value      = each.value.value
  target     = each.value.target
  sensitive  = true
  comment    = local.posthog_comment
}

resource "vercel_project_environment_variable" "posthog_staging_custom" {
  for_each = {
    for pair in setproduct(keys(local.posthog_values), var.staging_custom_environment_ids) : "${pair[0]}_${pair[1]}" => {
      key                   = pair[0]
      custom_environment_id = pair[1]
      value                 = local.posthog_values[pair[0]]
    }
  }

  project_id             = data.vercel_project.web.id
  team_id                = var.vercel_team_id
  key                    = each.value.key
  value                  = each.value.value
  custom_environment_ids = [each.value.custom_environment_id]
  sensitive              = true
  comment                = local.posthog_comment
}

resource "vercel_project_environment_variable" "twitch_standard" {
  for_each = {
    for pair in setproduct(local.twitch_keys, keys(local.standard_twitch_targets)) : "${pair[0]}_${pair[1]}" => {
      key    = pair[0]
      target = local.standard_twitch_targets[pair[1]]
      value  = local.twitch_values[pair[0]]
    }
  }

  project_id = data.vercel_project.web.id
  team_id    = var.vercel_team_id
  key        = each.value.key
  value      = each.value.value
  target     = each.value.target
  sensitive  = true
  comment    = "Server-only Twitch app credentials for cached public profile live status."
}

resource "vercel_project_environment_variable" "twitch_staging_custom" {
  for_each = {
    for pair in setproduct(local.twitch_keys, var.staging_custom_environment_ids) : "${pair[0]}_${pair[1]}" => {
      key                   = pair[0]
      custom_environment_id = pair[1]
      value                 = local.twitch_values[pair[0]]
    }
  }

  project_id             = data.vercel_project.web.id
  team_id                = var.vercel_team_id
  key                    = each.value.key
  value                  = each.value.value
  custom_environment_ids = [each.value.custom_environment_id]
  sensitive              = true
  comment                = "Server-only Twitch app credentials for cached public profile live status."
}
