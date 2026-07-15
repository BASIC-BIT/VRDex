output "vercel_project_id" {
  description = "Existing Vercel project ID resolved by name."
  value       = data.vercel_project.web.id
}

output "upstash_rate_limit_database" {
  description = "Upstash Redis database backing hosted API/MCP rate-limit counters."
  value = {
    database_id    = upstash_redis_database.rate_limit.database_id
    database_name  = var.upstash_database_name
    endpoint       = upstash_redis_database.rate_limit.endpoint
    region         = var.upstash_region
    primary_region = var.upstash_primary_region
    read_regions   = sort(tolist(var.upstash_read_regions))
    state          = upstash_redis_database.rate_limit.state
  }
}

output "redis_rest_url" {
  description = "Redis-compatible REST URL written to VRDEX_RATE_LIMIT_REDIS_REST_URL."
  value       = local.redis_rest_url
}

output "managed_rate_limit_environment_keys" {
  description = "Rate-limit environment variable names managed by this stack."
  value       = sort(concat(keys(local.rate_limit_config_values), ["VRDEX_RATE_LIMIT_REDIS_REST_TOKEN"]))
}

output "redis_rest_token_environment_key" {
  description = "Secret Vercel environment key that receives the Upstash standard REST token."
  value       = "VRDEX_RATE_LIMIT_REDIS_REST_TOKEN"
}
