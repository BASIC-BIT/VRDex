terraform {
  required_version = ">= 1.10.0"

  backend "s3" {
    bucket       = "vrdex-terraform-state"
    key          = "vrclinking-adapter/terraform.tfstate"
    region       = "us-east-1"
    encrypt      = true
    use_lockfile = true
  }

  required_providers {
    # 6.28 or newer, unlike the `~> 5.0` the other stacks pin. AWS began
    # requiring `lambda:InvokeFunction` on function URLs in October 2025, and
    # `invoked_via_function_url` — the only way to grant it without also
    # handing direct `Invoke` to every AWS principal — landed in 6.28.0.
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.28"
    }

    # Only for the delegated-key write path: the role ARN has to reach the web
    # project as an environment variable, and hand-setting it there would leave
    # the one value that decides whether the delegation form works outside IaC.
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
