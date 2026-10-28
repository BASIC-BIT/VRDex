variable "region" {
  type    = string
  default = "us-east-1"
}
variable "enabled" {
  type    = bool
  default = false
}
variable "name" {
  type    = string
  default = "vrdex-media-relay"
  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{2,30}$", var.name))
    error_message = "Use a unique lowercase relay resource prefix."
  }
}
variable "release" {
  description = "Owner-reviewed measured release inputs. No inferred production capacity or account. Secret values are never Terraform inputs."
  type = object({
    evidence              = string
    control_url           = string
    worker_secret_arn     = string
    gateway_secret_arn    = string
    signing_secret_arn    = string
    signing_public_key    = string
    image                 = string
    gateway_zip           = string
    gateway_sha256        = string
    subnet_ids            = list(string)
    security_group_ids    = list(string)
    global_source_cap     = number
    max_grants            = number
    admission_per_minute  = number
    gateway_concurrency   = number
    request_rate          = number
    request_burst         = number
    traffic_gib_per_month = number
    warm_min              = number
    warm_max              = number
    origins               = list(string)
    workers = list(object({
      workerId    = string
      workerEpoch = number
      allocation  = object({ cpuUnits = number, memoryMiB = number, evidenceId = string })
      maxSources  = number
      draining    = bool
    }))
  })
  default = null
  validation {
    condition = !var.enabled || try(
      length(var.release.evidence) >= 8 &&
      can(regex("^https://[a-zA-Z0-9.-]+$", var.release.control_url)) &&
      var.release.worker_secret_arn != var.release.gateway_secret_arn &&
      alltrue([for arn in [var.release.worker_secret_arn, var.release.gateway_secret_arn, var.release.signing_secret_arn] : can(regex("^arn:aws[a-z-]*:secretsmanager:[a-z0-9-]+:[0-9]{12}:secret:.+$", arn))]) &&
      can(regex("^[0-9]{12}\\.dkr\\.ecr\\.[a-z0-9-]+\\.amazonaws\\.com/[a-z0-9/_-]+@sha256:[a-f0-9]{64}$", var.release.image)) &&
      length(var.release.gateway_sha256) == 44 && length(var.release.gateway_zip) > 0 &&
      length(var.release.signing_public_key) > 100 &&
      length(var.release.subnet_ids) > 0 && length(var.release.security_group_ids) > 0 &&
      length(var.release.origins) > 0 && alltrue([for origin in var.release.origins : can(regex("^https://[a-zA-Z0-9.-]+$", origin))]) &&
      alltrue([for n in [var.release.global_source_cap, var.release.max_grants, var.release.admission_per_minute, var.release.gateway_concurrency, var.release.request_rate, var.release.request_burst, var.release.traffic_gib_per_month, var.release.warm_min, var.release.warm_max] : n > 0 && floor(n) == n]) &&
      var.release.admission_per_minute <= 10000 && var.release.max_grants <= 10000 && var.release.global_source_cap <= 1000 && var.release.gateway_concurrency <= 1000 &&
      var.release.warm_min == var.release.warm_max && var.release.warm_max == length(var.release.workers) &&
      length(distinct([for w in var.release.workers : w.workerId])) == length(var.release.workers) &&
      alltrue([for w in var.release.workers : can(regex("^[A-Za-z0-9_-]{1,128}$", w.workerId)) && w.workerEpoch > 0 && floor(w.workerEpoch) == w.workerEpoch && w.maxSources > 0 && w.maxSources <= 1000 && floor(w.maxSources) == w.maxSources && contains([256, 512, 1024, 2048, 4096], w.allocation.cpuUnits) && contains(lookup({ "256" = [512, 1024, 2048], "512" = [1024, 2048, 3072, 4096], "1024" = [2048, 3072, 4096, 5120, 6144, 7168, 8192], "2048" = range(4096, 16385, 1024), "4096" = range(8192, 30721, 1024) }, tostring(w.allocation.cpuUnits), []), w.allocation.memoryMiB) && length(w.allocation.evidenceId) >= 8]) &&
      sum([for w in var.release.workers : w.maxSources]) > var.release.global_source_cap,
    false)
    error_message = "Enabled relay requires a complete measured release, unique fixed worker slots, equal warm bounds, spare capacity and finite positive limits."
  }
}
