data "vercel_project" "web" {
  name    = var.vercel_project_name
  team_id = var.vercel_team_id
}

resource "upstash_redis_database" "rate_limit" {
  database_name  = var.upstash_database_name
  region         = var.upstash_region
  primary_region = var.upstash_primary_region
  read_regions   = var.upstash_read_regions
  tls            = true
  budget         = var.upstash_budget
  auto_scale     = var.upstash_auto_scale
  prod_pack      = var.upstash_prod_pack
  eviction       = var.upstash_eviction
  ip_allowlist   = var.upstash_ip_allowlist
}

locals {
  redis_rest_url = "https://${upstash_redis_database.rate_limit.endpoint}"

  rate_limit_comment = "VRDex API/MCP rate-limit Redis ${upstash_redis_database.rate_limit.database_id} managed by infra/terraform/rate-limit-redis."

  standard_rate_limit_targets = merge(
    var.manage_production_environment ? { production = ["production"] } : {},
    var.manage_preview_environment ? { preview = ["preview"] } : {},
  )

  rate_limit_config_values = {
    VRDEX_RATE_LIMIT_STORE = {
      value = var.rate_limit_store_mode
    }
    VRDEX_RATE_LIMIT_REDIS_REST_URL = {
      value = local.redis_rest_url
    }
    VRDEX_RATE_LIMIT_REDIS_PREFIX = {
      value = var.redis_key_prefix
    }
  }
}

resource "vercel_project_environment_variable" "rate_limit_standard_config" {
  for_each = {
    for pair in setproduct(keys(local.rate_limit_config_values), keys(local.standard_rate_limit_targets)) : "${pair[0]}_${pair[1]}" => {
      key    = pair[0]
      target = local.standard_rate_limit_targets[pair[1]]
      value  = local.rate_limit_config_values[pair[0]].value
    }
  }

  project_id = data.vercel_project.web.id
  team_id    = var.vercel_team_id
  key        = each.value.key
  value      = each.value.value
  target     = each.value.target
  sensitive  = false
  comment    = local.rate_limit_comment
}

resource "vercel_project_environment_variable" "rate_limit_standard_token" {
  for_each = {
    for target_name, target in local.standard_rate_limit_targets : target_name => target
  }

  project_id = data.vercel_project.web.id
  team_id    = var.vercel_team_id
  key        = "VRDEX_RATE_LIMIT_REDIS_REST_TOKEN"
  value      = upstash_redis_database.rate_limit.rest_token
  target     = each.value
  sensitive  = true
  comment    = local.rate_limit_comment
}

resource "vercel_project_environment_variable" "rate_limit_staging_custom_config" {
  for_each = {
    for pair in setproduct(keys(local.rate_limit_config_values), var.staging_custom_environment_ids) : "${pair[0]}_${pair[1]}" => {
      key                   = pair[0]
      custom_environment_id = pair[1]
      value                 = local.rate_limit_config_values[pair[0]].value
    }
  }

  project_id             = data.vercel_project.web.id
  team_id                = var.vercel_team_id
  key                    = each.value.key
  value                  = each.value.value
  custom_environment_ids = [each.value.custom_environment_id]
  sensitive              = false
  comment                = local.rate_limit_comment
}

resource "vercel_project_environment_variable" "rate_limit_staging_custom_token" {
  for_each = var.staging_custom_environment_ids

  project_id             = data.vercel_project.web.id
  team_id                = var.vercel_team_id
  key                    = "VRDEX_RATE_LIMIT_REDIS_REST_TOKEN"
  value                  = upstash_redis_database.rate_limit.rest_token
  custom_environment_ids = [each.value]
  sensitive              = true
  comment                = local.rate_limit_comment
}
