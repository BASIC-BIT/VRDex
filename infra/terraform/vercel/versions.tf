terraform {
  required_version = ">= 1.10.0"

  backend "s3" {
    bucket       = "vrdex-terraform-state"
    key          = "vercel/terraform.tfstate"
    region       = "us-east-1"
    encrypt      = true
    use_lockfile = true
  }

  required_providers {
    vercel = {
      source  = "vercel/vercel"
      version = ">= 4.8.0, < 5.0.0"
    }
  }
}

provider "vercel" {
  team = var.vercel_team_id
}
