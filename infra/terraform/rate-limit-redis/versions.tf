terraform {
  required_version = ">= 1.10.0"

  backend "s3" {
    bucket       = "vrdex-terraform-state"
    key          = "rate-limit-redis/terraform.tfstate"
    region       = "us-east-1"
    encrypt      = true
    use_lockfile = true
  }

  required_providers {
    upstash = {
      source  = "upstash/upstash"
      version = ">= 2.1.0, < 3.0.0"
    }

    vercel = {
      source  = "vercel/vercel"
      version = ">= 4.8.0, < 5.0.0"
    }
  }
}

provider "upstash" {
  email   = var.upstash_email
  api_key = var.upstash_api_key
}

provider "vercel" {
  team = var.vercel_team_id
}
