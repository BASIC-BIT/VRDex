locals {
  count   = var.enabled ? 1 : 0
  workers = var.enabled && var.release != null ? { for index, w in var.release.workers : tostring(index) => w } : {}
  release = var.release
  common = var.enabled ? {
    version            = 1, enabled = true, region = var.region, controlUrl = var.release.control_url,
    bucket             = aws_s3_bucket.media[0].id, demandTable = aws_dynamodb_table.demand[0].name,
    globalSourceCap    = var.release.global_source_cap, gatewayConcurrency = var.release.gateway_concurrency,
    admissionPerMinute = var.release.admission_per_minute, trafficGiBPerMonth = var.release.traffic_gib_per_month,
    releaseEvidence    = var.release.evidence, origins = var.release.origins,
    distributionOrigin = "https://${aws_cloudfront_distribution.media[0].domain_name}",
    signingKeyId       = aws_cloudfront_public_key.media[0].id, signingKeyRef = var.release.signing_secret_arn
  } : null
}
resource "aws_s3_bucket" "media" {
  count         = local.count
  bucket_prefix = "${var.name}-"
  force_destroy = false
}
resource "aws_s3_bucket_public_access_block" "media" {
  count                   = local.count
  bucket                  = aws_s3_bucket.media[0].id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}
resource "aws_s3_bucket_ownership_controls" "media" {
  count  = local.count
  bucket = aws_s3_bucket.media[0].id
  rule { object_ownership = "BucketOwnerEnforced" }
}
resource "aws_s3_bucket_server_side_encryption_configuration" "media" {
  count  = local.count
  bucket = aws_s3_bucket.media[0].id
  rule {
    apply_server_side_encryption_by_default { sse_algorithm = "AES256" }
  }
}
resource "aws_s3_bucket_lifecycle_configuration" "media" {
  count  = local.count
  bucket = aws_s3_bucket.media[0].id
  rule {
    id     = "relay-backstop"
    status = "Enabled"
    filter { prefix = "vrcdn/" }
    expiration { days = 1 }
    abort_incomplete_multipart_upload { days_after_initiation = 1 }
  }
}
resource "aws_cloudfront_origin_access_control" "media" {
  count                             = local.count
  name                              = var.name
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}
resource "aws_cloudfront_public_key" "media" {
  count       = local.count
  name_prefix = "${var.name}-"
  encoded_key = var.release.signing_public_key
}
resource "aws_cloudfront_key_group" "media" {
  count = local.count
  name  = var.name
  items = [aws_cloudfront_public_key.media[0].id]
}
resource "aws_cloudfront_cache_policy" "media" {
  count       = local.count
  name        = var.name
  default_ttl = 300
  min_ttl     = 0
  max_ttl     = 600
  parameters_in_cache_key_and_forwarded_to_origin {
    cookies_config { cookie_behavior = "none" }
    headers_config { header_behavior = "none" }
    query_strings_config { query_string_behavior = "none" }
  }
}
resource "aws_cloudfront_distribution" "media" {
  count       = local.count
  enabled     = true
  price_class = "PriceClass_100"
  origin {
    domain_name              = aws_s3_bucket.media[0].bucket_regional_domain_name
    origin_id                = "private-media"
    origin_access_control_id = aws_cloudfront_origin_access_control.media[0].id
  }
  default_cache_behavior {
    target_origin_id       = "private-media"
    viewer_protocol_policy = "https-only"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    trusted_key_groups     = [aws_cloudfront_key_group.media[0].id]
    cache_policy_id        = aws_cloudfront_cache_policy.media[0].id
    compress               = false
  }
  restrictions {
    geo_restriction { restriction_type = "none" }
  }
  viewer_certificate { cloudfront_default_certificate = true }
  # No access logs: signed query capabilities must not enter logs.
}
resource "aws_s3_bucket_policy" "media" {
  count  = local.count
  bucket = aws_s3_bucket.media[0].id
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Effect = "Allow", Principal = { Service = "cloudfront.amazonaws.com" }, Action = "s3:GetObject", Resource = "${aws_s3_bucket.media[0].arn}/vrcdn/*", Condition = { StringEquals = { "AWS:SourceArn" = aws_cloudfront_distribution.media[0].arn } } },
    { Effect = "Deny", Principal = "*", Action = "s3:*", Resource = [aws_s3_bucket.media[0].arn, "${aws_s3_bucket.media[0].arn}/*"], Condition = { Bool = { "aws:SecureTransport" = "false" } } }
  ] })
}
resource "aws_dynamodb_table" "demand" {
  count        = local.count
  name         = var.name
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "streamKey"
  attribute {
    name = "streamKey"
    type = "S"
  }
}
resource "aws_cloudwatch_log_group" "worker" {
  count             = local.count
  name              = "/vrdex/${var.name}/worker"
  retention_in_days = 7
}
resource "aws_cloudwatch_log_group" "gateway" {
  count             = local.count
  name              = "/aws/lambda/${var.name}"
  retention_in_days = 7
}
resource "aws_iam_role" "worker" {
  for_each           = local.workers
  name_prefix        = "${var.name}-worker-"
  assume_role_policy = jsonencode({ Version = "2012-10-17", Statement = [{ Effect = "Allow", Principal = { Service = "ecs-tasks.amazonaws.com" }, Action = "sts:AssumeRole" }] })
}
resource "aws_iam_role_policy" "worker" {
  for_each = local.workers
  role     = aws_iam_role.worker[each.key].id
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Effect = "Allow", Action = ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"], Resource = "${aws_s3_bucket.media[0].arn}/vrcdn/*" },
    { Effect = "Allow", Action = ["s3:GetObject", "s3:PutObject"], Resource = "${aws_s3_bucket.media[0].arn}/_relay/retirement/${each.value.workerId}.json" },
    { Effect = "Allow", Action = ["s3:ListBucket"], Resource = aws_s3_bucket.media[0].arn, Condition = { StringLike = { "s3:prefix" = ["vrcdn/*", "_relay/retirement/${each.value.workerId}.json"] } } },
    { Effect = "Allow", Action = ["dynamodb:GetItem"], Resource = aws_dynamodb_table.demand[0].arn }
  ] })
}
resource "aws_iam_role" "execution" {
  count              = local.count
  name_prefix        = "${var.name}-exec-"
  assume_role_policy = jsonencode({ Version = "2012-10-17", Statement = [{ Effect = "Allow", Principal = { Service = "ecs-tasks.amazonaws.com" }, Action = "sts:AssumeRole" }] })
}
resource "aws_iam_role_policy" "execution" {
  count = local.count
  role  = aws_iam_role.execution[0].id
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Effect = "Allow", Action = ["ecr:GetAuthorizationToken"], Resource = "*" },
    { Effect = "Allow", Action = ["ecr:BatchCheckLayerAvailability", "ecr:GetDownloadUrlForLayer", "ecr:BatchGetImage"], Resource = "arn:aws:ecr:${var.region}:${split(".", var.release.image)[0]}:repository/${split("@", join("/", slice(split("/", var.release.image), 1, length(split("/", var.release.image)))))[0]}" },
    { Effect = "Allow", Action = ["logs:CreateLogStream", "logs:PutLogEvents"], Resource = "${aws_cloudwatch_log_group.worker[0].arn}:*" }
  ] })
}
resource "aws_ecs_cluster" "relay" {
  count = local.count
  name  = var.name
}
resource "aws_ecs_task_definition" "worker" {
  for_each                 = local.workers
  family                   = "${var.name}-${each.key}"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = each.value.allocation.cpuUnits
  memory                   = each.value.allocation.memoryMiB
  task_role_arn            = aws_iam_role.worker[each.key].arn
  execution_role_arn       = aws_iam_role.execution[0].arn
  container_definitions = jsonencode([{ name = "relay", image = var.release.image, essential = true, readonlyRootFilesystem = true, stopTimeout = 30,
    linuxParameters  = { initProcessEnabled = true },
    mountPoints      = [{ sourceVolume = "scratch", containerPath = "/tmp", readOnly = false }],
    environment      = [{ name = "MEDIA_RELAY_CONFIG", value = jsonencode(merge(local.common, { credentialRef = var.release.worker_secret_arn, binding = each.value })) }],
    logConfiguration = { logDriver = "awslogs", options = { "awslogs-group" = aws_cloudwatch_log_group.worker[0].name, "awslogs-region" = var.region, "awslogs-stream-prefix" = "slot-${each.key}" } }
  }])
  volume { name = "scratch" }
}
resource "aws_ecs_service" "worker" {
  depends_on                         = [aws_iam_role_policy.worker, aws_iam_role_policy.worker_identity, aws_iam_role_policy.execution]
  for_each                           = local.workers
  name                               = "${var.name}-${each.key}"
  cluster                            = aws_ecs_cluster.relay[0].id
  task_definition                    = aws_ecs_task_definition.worker[each.key].arn
  desired_count                      = 1
  launch_type                        = "FARGATE"
  deployment_minimum_healthy_percent = 0
  deployment_maximum_percent         = 100
  network_configuration {
    subnets          = var.release.subnet_ids
    security_groups  = var.release.security_group_ids
    assign_public_ip = false
  }
}
resource "aws_iam_role" "gateway" {
  count              = local.count
  name_prefix        = "${var.name}-gateway-"
  assume_role_policy = jsonencode({ Version = "2012-10-17", Statement = [{ Effect = "Allow", Principal = { Service = "lambda.amazonaws.com" }, Action = "sts:AssumeRole" }] })
}
resource "aws_iam_role_policy" "gateway" {
  count = local.count
  role  = aws_iam_role.gateway[0].id
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Effect = "Allow", Action = ["s3:GetObject"], Resource = "${aws_s3_bucket.media[0].arn}/vrcdn/*" },
    { Effect = "Allow", Action = ["dynamodb:GetItem", "dynamodb:UpdateItem"], Resource = aws_dynamodb_table.demand[0].arn },
    { Effect = "Allow", Action = ["secretsmanager:GetSecretValue"], Resource = [var.release.gateway_secret_arn, var.release.signing_secret_arn] },
    { Effect = "Allow", Action = ["logs:CreateLogStream", "logs:PutLogEvents"], Resource = "${aws_cloudwatch_log_group.gateway[0].arn}:*" }
  ] })
}
resource "aws_lambda_function" "gateway" {
  depends_on                     = [aws_iam_role_policy.gateway]
  count                          = local.count
  function_name                  = var.name
  role                           = aws_iam_role.gateway[0].arn
  runtime                        = "nodejs22.x"
  handler                        = "gateway.handler"
  filename                       = var.release.gateway_zip
  source_code_hash               = var.release.gateway_sha256
  timeout                        = 5
  memory_size                    = 256
  reserved_concurrent_executions = var.release.gateway_concurrency
  environment { variables = { MEDIA_RELAY_CONFIG = jsonencode(merge(local.common, { credentialRef = var.release.gateway_secret_arn })) } }
}
resource "aws_apigatewayv2_api" "gateway" {
  count         = local.count
  name          = var.name
  protocol_type = "HTTP"
}
resource "aws_apigatewayv2_integration" "gateway" {
  count                  = local.count
  api_id                 = aws_apigatewayv2_api.gateway[0].id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.gateway[0].invoke_arn
  payload_format_version = "2.0"
  timeout_milliseconds   = 5000
}
resource "aws_apigatewayv2_route" "gateway" {
  count     = local.count
  api_id    = aws_apigatewayv2_api.gateway[0].id
  route_key = "ANY /p/{grantId}/{rendition}/index.m3u8"
  target    = "integrations/${aws_apigatewayv2_integration.gateway[0].id}"
}
resource "aws_apigatewayv2_stage" "gateway" {
  count       = local.count
  api_id      = aws_apigatewayv2_api.gateway[0].id
  name        = "$default"
  auto_deploy = true
  default_route_settings {
    throttling_burst_limit   = var.release.request_burst
    throttling_rate_limit    = var.release.request_rate
    detailed_metrics_enabled = true
  }
  # Access logging deliberately absent: raw capability paths never enter logs.
}
resource "aws_lambda_permission" "gateway" {
  count         = local.count
  statement_id  = "HttpApi"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.gateway[0].function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.gateway[0].execution_arn}/*/*/p/*/*/index.m3u8"
}

resource "aws_iam_role_policy" "worker_identity" {
  for_each = local.workers
  role     = aws_iam_role.worker[each.key].id
  policy   = jsonencode({ Version = "2012-10-17", Statement = [{ Effect = "Allow", Action = ["secretsmanager:GetSecretValue"], Resource = var.release.worker_secret_arn }] })
}
