[CmdletBinding()]
param(
  [Parameter(Mandatory)]
  [string] $TemplateId,

  [Parameter(Mandatory)]
  [ValidateNotNullOrEmpty()]
  [string[]] $GpuTypeIds
)

$ErrorActionPreference = "Stop"

$payload = [ordered]@{
  templateId = $TemplateId
  computeType = "GPU"
  executionTimeoutMs = 330000
  flashboot = $true
  gpuCount = 1
  gpuTypeIds = $GpuTypeIds
  idleTimeout = 30
  name = "vrdex-temporal-beta"
  scalerType = "REQUEST_COUNT"
  scalerValue = 1
  workersMax = 1
  workersMin = 0
}

[pscustomobject]@{
  mode = "plan_only"
  billableChangePerformed = $false
  requiredBillableChange = "Create one scale-to-zero RunPod Serverless Load Balancer endpoint"
  manualBootstrapReason = "The current public runpodctl and REST create contracts do not expose the Load Balancer endpoint-type selector."
  manualBootstrapAction = "After explicit approval, select Load Balancer in the RunPod console and copy these reviewed settings."
  request = $payload
} | ConvertTo-Json -Depth 6