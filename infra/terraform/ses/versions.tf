terraform {
  required_version = ">= 1.6.0"

  backend "s3" {
    bucket         = "vrdex-terraform-state"
    key            = "ses/terraform.tfstate"
    region         = "us-east-1"
    dynamodb_table = "vrdex-terraform-locks"
    encrypt        = true
  }

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = local.tags
  }
}
