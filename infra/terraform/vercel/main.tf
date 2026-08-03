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

  temporal_values = {
    TEMPORAL_INPUT_HASH_KEY = var.temporal_input_hash_key
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

  # Each environment gets its own Clerk instance's pair, so these are managed as
  # two independent groups rather than one value set across targets.
  manage_clerk_production = nonsensitive(
    var.manage_production_environment &&
    var.clerk_production_publishable_key != null &&
    var.clerk_production_secret_key != null
  )

  manage_clerk_preview = nonsensitive(
    var.clerk_preview_publishable_key != null &&
    var.clerk_preview_secret_key != null
  )

  # Iterated instead of the value maps below: those derive from the sensitive
  # secret-key variables, and Terraform rejects a sensitive `for_each`. Same
  # reason `twitch_keys` exists.
  clerk_keys            = toset(["NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "CLERK_SECRET_KEY"])
  clerk_production_keys = local.manage_clerk_production ? local.clerk_keys : toset([])
  clerk_preview_keys    = local.manage_clerk_preview ? local.clerk_keys : toset([])

  clerk_production_values = local.manage_clerk_production ? {
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = var.clerk_production_publishable_key
    CLERK_SECRET_KEY                  = var.clerk_production_secret_key
  } : {}

  clerk_preview_values = local.manage_clerk_preview ? {
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = var.clerk_preview_publishable_key
    CLERK_SECRET_KEY                  = var.clerk_preview_secret_key
  } : {}

  # The publishable key reaches the browser, so marking it sensitive in Vercel
  # would only make it unreadable to operators without protecting anything.
  clerk_sensitive_keys = {
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = false
    CLERK_SECRET_KEY                  = true
  }
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

resource "vercel_project_environment_variable" "temporal_standard" {
  for_each = {
    for pair in setproduct(keys(local.temporal_values), keys(local.standard_posthog_targets)) : "${pair[0]}_${pair[1]}" => {
      key    = pair[0]
      target = local.standard_posthog_targets[pair[1]]
      value  = local.temporal_values[pair[0]]
    }
  }

  project_id = data.vercel_project.web.id
  team_id    = var.vercel_team_id
  key        = each.value.key
  value      = each.value.value
  target     = each.value.target
  sensitive  = true
  comment    = "Server-only HMAC key for temporal input hashes and idempotency fingerprints."
}

resource "vercel_project_environment_variable" "temporal_staging_custom" {
  for_each = {
    for pair in setproduct(keys(local.temporal_values), var.staging_custom_environment_ids) : "${pair[0]}_${pair[1]}" => {
      key                   = pair[0]
      custom_environment_id = pair[1]
      value                 = local.temporal_values[pair[0]]
    }
  }

  project_id             = data.vercel_project.web.id
  team_id                = var.vercel_team_id
  key                    = each.value.key
  value                  = each.value.value
  custom_environment_ids = [each.value.custom_environment_id]
  sensitive              = true
  comment                = "Server-only HMAC key for temporal input hashes and idempotency fingerprints."
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

resource "vercel_project_environment_variable" "clerk_production" {
  for_each = local.clerk_production_keys

  project_id = data.vercel_project.web.id
  team_id    = var.vercel_team_id
  key        = each.key
  value      = local.clerk_production_values[each.key]
  target     = ["production"]
  sensitive  = local.clerk_sensitive_keys[each.key]
  comment    = "Clerk production instance credentials. Required: the build fails without them."
}

resource "vercel_project_environment_variable" "clerk_preview" {
  for_each = var.manage_preview_environment ? local.clerk_preview_keys : toset([])

  project_id = data.vercel_project.web.id
  team_id    = var.vercel_team_id
  key        = each.key
  value      = local.clerk_preview_values[each.key]
  target     = ["preview"]
  sensitive  = local.clerk_sensitive_keys[each.key]
  comment    = "Clerk development instance credentials for preview deployments."
}

resource "vercel_project_environment_variable" "clerk_staging_custom" {
  for_each = {
    for pair in setproduct(local.clerk_preview_keys, var.staging_custom_environment_ids) : "${pair[0]}_${pair[1]}" => {
      key                   = pair[0]
      custom_environment_id = pair[1]
    }
  }

  project_id             = data.vercel_project.web.id
  team_id                = var.vercel_team_id
  key                    = each.value.key
  value                  = local.clerk_preview_values[each.value.key]
  custom_environment_ids = [each.value.custom_environment_id]
  sensitive              = local.clerk_sensitive_keys[each.value.key]
  comment                = "Clerk development instance credentials for the staging environment."
}
