variable "aws_region" {
  description = "AWS region for the Terraform state bucket."
  type        = string
  default     = "us-east-1"
}

variable "state_bucket_name" {
  description = "S3 bucket name used by VRDex Terraform stacks for remote state."
  type        = string
  default     = "vrdex-terraform-state"
}

variable "tags" {
  description = "Additional resource tags."
  type        = map(string)
  default     = {}
}
