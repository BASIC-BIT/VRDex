terraform {
  required_version = ">= 1.10.0"

  backend "s3" {
    bucket       = "vrdex-terraform-state"
    key          = "web-domains/terraform.tfstate"
    region       = "us-east-1"
    encrypt      = true
    use_lockfile = true
  }

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.100.0, < 6.0.0"
    }

    vercel = {
      source  = "vercel/vercel"
      version = ">= 4.8.0, < 5.0.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

provider "vercel" {
  team = var.vercel_team_id
}
