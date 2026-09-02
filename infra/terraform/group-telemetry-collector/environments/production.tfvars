# Production run state for the group telemetry collector fleet.
#
# Checked in deliberately, and deliberately narrow. `terraform.tfvars` is
# gitignored because it carries account-specific identifiers — the ECR image
# digest, the secret ARN, subnet and security group ids. None of that belongs in
# the repository, but the *enable state* is not account-specific and losing it
# is what made a clean checkout dangerous: applying with only the checked-in
# configuration would set `enable_service = false` and `desired_count = 0`, and
# since this fleet now resolves VRChat ownership proofs, that silently disables a
# production claim path. The request budget lives here for the same reason: an
# explicit production adjustment must be reflected in source control before a
# later image release can safely plan against it.
#
# The variable defaults stay disabled so standing up a *new* environment is safe
# by default, per the bring-up sequence in
# `docs/deployment/group-telemetry-collector.md`. Apply production with:
#
#   terraform apply -var-file=environments/production.tfvars
#
# alongside the operator's local `terraform.tfvars`.

enable_service      = true
desired_count       = 1
requests_per_minute = 30
