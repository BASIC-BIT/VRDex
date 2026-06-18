terraform {
  required_version = ">= 1.10.0"

  backend "s3" {
    bucket       = "vrdex-terraform-state"
    key          = "profile-assets/terraform.tfstate"
    region       = "us-east-1"
    encrypt      = true
    use_lockfile = true
  }

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }

    tls = {
      source  = "hashicorp/tls"
      version = "~> 4.0"
    }

    vercel = {
      source  = "vercel/vercel"
      version = "~> 4.0"
    }
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = local.tags
  }
}

provider "vercel" {}
