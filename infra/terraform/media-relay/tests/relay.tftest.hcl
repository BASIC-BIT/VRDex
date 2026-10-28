mock_provider "aws" {}
run "disabled" {
  command = plan
  assert {
    condition     = output.compute_count == 0
    error_message = "Disabled relay must create zero compute."
  }
  assert {
    condition     = output.private_media
    error_message = "Media must remain private with OAC and signed access."
  }
}
run "missing_release" {
  command = plan
  variables {
    enabled = true
    release = null
  }
  expect_failures = [var.release]
}

variables {
  release = jsondecode(<<CONFIG
{
  "evidence": "synthetic-only-not-release",
  "control_url": "https://control.invalid",
  "worker_secret_arn": "arn:aws:secretsmanager:us-east-1:123456789012:secret:worker-abcdef",
  "gateway_secret_arn": "arn:aws:secretsmanager:us-east-1:123456789012:secret:gateway-abcdef",
  "signing_secret_arn": "arn:aws:secretsmanager:us-east-1:123456789012:secret:signer-abcdef",
  "signing_public_key": "PUBLIC KEY FIXTURE AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  "image": "123456789012.dkr.ecr.us-east-1.amazonaws.com/relay@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "gateway_zip": "/tmp/synthetic-gateway.zip",
  "gateway_sha256": "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
  "subnet_ids": [
    "subnet-12345678"
  ],
  "security_group_ids": [
    "sg-12345678"
  ],
  "global_source_cap": 2,
  "max_grants": 100,
  "admission_per_minute": 10,
  "gateway_concurrency": 2,
  "request_rate": 10,
  "request_burst": 10,
  "traffic_gib_per_month": 1,
  "warm_min": 2,
  "warm_max": 2,
  "origins": [
    "https://app.invalid"
  ],
  "workers": [
    {
      "workerId": "slot-0",
      "workerEpoch": 1,
      "allocation": {
        "cpuUnits": 1024,
        "memoryMiB": 2048,
        "evidenceId": "synthetic-only"
      },
      "maxSources": 2,
      "draining": false
    },
    {
      "workerId": "slot-1",
      "workerEpoch": 1,
      "allocation": {
        "cpuUnits": 1024,
        "memoryMiB": 2048,
        "evidenceId": "synthetic-only"
      },
      "maxSources": 2,
      "draining": false
    }
  ]
}
CONFIG
  )
}

run "enabled_private_scoped" {
  assert {
    condition     = local.worker_scratch_mount.containerPath == "/var/lib/media-relay" && !local.worker_scratch_mount.readOnly
    error_message = "Non-root workers require the initialized image scratch volume, with read-only root retained."
  }

  override_resource {
    target = aws_s3_bucket.media[0]
    values = { arn = "arn:aws:s3:::synthetic-relay", id = "synthetic-relay", bucket_regional_domain_name = "synthetic-relay.s3.us-east-1.amazonaws.com" }
  }
  override_resource {
    target = aws_dynamodb_table.demand[0]
    values = { arn = "arn:aws:dynamodb:us-east-1:123456789012:table/synthetic-relay", name = "synthetic-relay" }
  }

  command = plan
  variables { enabled = true }
  assert {
    condition     = output.compute_count == 3 && output.private_media
    error_message = "Two fixed shared workers and private signed media required."
  }
  assert {
    condition     = alltrue([for s in aws_ecs_service.worker : s.desired_count == 1 && s.deployment_maximum_percent == 100 && s.deployment_minimum_healthy_percent == 0])
    error_message = "Worker identity cannot overlap replicas."
  }
  assert {
    condition     = aws_cloudfront_origin_access_control.media[0].signing_behavior == "always" && aws_cloudfront_cache_policy.media[0].parameters_in_cache_key_and_forwarded_to_origin[0].query_strings_config[0].query_string_behavior == "none"
    error_message = "Signed private origin and reusable segment cache required."
  }
  assert {
    condition     = !strcontains(aws_iam_role_policy.worker_identity["0"].policy, var.release.gateway_secret_arn) && !strcontains(aws_iam_role_policy.worker_identity["0"].policy, var.release.signing_secret_arn) && !strcontains(aws_iam_role_policy.worker_identity["0"].policy, "restream")
    error_message = "Worker cannot read gateway/signing or event credentials."
  }
  assert {
    condition     = length(aws_apigatewayv2_stage.gateway[0].access_log_settings) == 0 && length(aws_cloudfront_distribution.media[0].logging_config) == 0
    error_message = "Bearer paths and signatures cannot enter access logs."
  }
}
run "unequal_warm_bounds" {
  command = plan
  variables {
    enabled = true
    release = merge(var.release, { warm_min = 1 })
  }
  expect_failures = [var.release]
}
run "duplicate_identity" {
  command = plan
  variables {
    enabled = true
    release = merge(var.release, { workers = [var.release.workers[0], var.release.workers[0]] })
  }
  expect_failures = [var.release]
}
run "zero_capacity" {
  command = plan
  variables {
    enabled = true
    release = merge(var.release, { global_source_cap = 0 })
  }
  expect_failures = [var.release]
}
