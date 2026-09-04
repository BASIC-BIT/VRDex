# The collector's VRChat session has to be created from the collector's own
# egress address: VRChat pins a session to the network that created it, and
# refuses it from anywhere else (2026-09-04, three logins, see
# docs/planning/collector-session-reauth-research.md section 4a). This host
# sits in the collector's private subnet, so anything tunnelled through it
# leaves from the NAT gateway's Elastic IP. It runs a loopback-only CONNECT
# proxy; the operator reaches it with SSM port forwarding and points the
# login harness at it. It is stopped between recoveries.
locals {
  tags = merge({
    Project   = "VRDex"
    ManagedBy = "Terraform"
    Component = "group-telemetry-collector"
  }, var.tags)
}

data "aws_iam_policy_document" "assume" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "host" {
  name               = var.name
  assume_role_policy = data.aws_iam_policy_document.assume.json
  tags               = local.tags
}

# Session Manager only. No ingress, no SSH key, no other permissions.
resource "aws_iam_role_policy_attachment" "ssm" {
  role       = aws_iam_role.host.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_instance_profile" "host" {
  name = var.name
  role = aws_iam_role.host.name
  tags = local.tags
}

resource "aws_instance" "host" {
  ami                         = var.ami_id
  instance_type               = var.instance_type
  subnet_id                   = var.subnet_id
  vpc_security_group_ids      = [var.security_group_id]
  associate_public_ip_address = false
  iam_instance_profile        = aws_iam_instance_profile.host.name
  user_data                   = file("${path.module}/connect-proxy.sh")
  # User data only runs on first boot, so an edit to it must replace the host.
  user_data_replace_on_change = true
  tags                        = merge(local.tags, { Name = var.name })

  metadata_options {
    http_tokens = "required"
  }
}

resource "aws_ec2_instance_state" "host" {
  instance_id = aws_instance.host.id
  state       = var.running ? "running" : "stopped"
}
