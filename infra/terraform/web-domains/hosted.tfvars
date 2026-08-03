# BASIC BIT hosted values for the Clerk production instance DNS.
#
# Checked in on purpose. Every value here is a public DNS record that anyone can
# dig, and keeping them in the repository means the hosted DNS state can be
# reconstructed after a repository or dashboard rebuild. Holding them only as
# GitHub repository variables made the live records depend on dashboard state
# that nothing in git could restore.
#
# NOT auto-loaded. Terraform reads `terraform.tfvars` and `*.auto.tfvars`
# automatically; this file is applied only when passed with `-var-file`, and
# `terraform.yml` passes it only for the canonical BASIC BIT repository. A fork
# therefore plans no Clerk records and never delegates its authentication-email
# DNS to this Clerk tenant, which `docs/developers/self-hosting-and-iac.md`
# requires. Self-hosted deployments should copy this file and substitute their
# own instance's targets from Clerk's Configure > Domains page.
#
# The instance id in the mail targets belongs to the Clerk production instance
# for clerk.vrdex.net. Changing instances means changing all three.

manage_clerk_dns   = true
clerk_mail_target  = "mail.49kratywlj1f.clerk.services"
clerk_dkim1_target = "dkim1.49kratywlj1f.clerk.services"
clerk_dkim2_target = "dkim2.49kratywlj1f.clerk.services"
