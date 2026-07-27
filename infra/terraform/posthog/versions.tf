terraform {
  required_version = ">= 1.10.0"

  backend "s3" {
    bucket       = "vrdex-terraform-state"
    key          = "posthog/terraform.tfstate"
    region       = "us-east-1"
    encrypt      = true
    use_lockfile = true
  }

  required_providers {
    posthog = {
      source  = "PostHog/posthog"
      version = ">= 1.0.13, < 2.0.0"
    }
  }
}

provider "posthog" {
  host            = var.posthog_host
  organization_id = var.posthog_organization_id
  project_id      = tostring(var.posthog_project_id)
}
