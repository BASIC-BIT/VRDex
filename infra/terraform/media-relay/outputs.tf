output "compute_count" { value = length(aws_ecs_service.worker) + length(aws_lambda_function.gateway) }
output "private_media" {
  value = alltrue([for b in aws_s3_bucket_public_access_block.media : b.block_public_acls && b.block_public_policy && b.ignore_public_acls && b.restrict_public_buckets]) && alltrue([for d in aws_cloudfront_distribution.media : length(d.default_cache_behavior[0].trusted_key_groups) > 0 && d.default_cache_behavior[0].viewer_protocol_policy == "https-only"])
}
output "gateway_url" { value = try(aws_apigatewayv2_api.gateway[0].api_endpoint, null) }
output "media_bucket" { value = try(aws_s3_bucket.media[0].id, null) }
output "convex_workers" { value = var.enabled ? jsonencode(var.release.workers) : "[]" }
output "control_release" {
  value = var.enabled ? {
    MEDIA_RELAY_ENABLED               = "true"
    MEDIA_RELAY_MAX_SOURCES           = tostring(var.release.global_source_cap)
    MEDIA_RELAY_MAX_GRANTS            = tostring(var.release.max_grants)
    MEDIA_RELAY_ADMISSIONS_PER_MINUTE = tostring(var.release.admission_per_minute)
    MEDIA_RELAY_PLAYBACK_ORIGIN       = aws_apigatewayv2_api.gateway[0].api_endpoint
    MEDIA_RELAY_WORKERS               = jsonencode(var.release.workers)
    } : {
    MEDIA_RELAY_ENABLED               = "false"
    MEDIA_RELAY_MAX_SOURCES           = "0"
    MEDIA_RELAY_MAX_GRANTS            = "0"
    MEDIA_RELAY_ADMISSIONS_PER_MINUTE = "0"
    MEDIA_RELAY_PLAYBACK_ORIGIN       = ""
    MEDIA_RELAY_WORKERS               = "[]"
  }
}

# Structured review output is the exact producer used by ECS/Lambda jsonencode.
# It contains secret references only, never credential values.
output "runtime_config_review" {
  value = { workers = local.worker_configurations, gateway = local.gateway_configuration }
}
