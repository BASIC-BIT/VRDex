# Production run state for the VRCLinking proof adapter.
#
# Same split as `group-telemetry-collector/environments/production.tfvars`: the
# enable state is not account-specific and belongs in the repository, while the
# shared-secret ARN is and stays in the operator's gitignored
# `terraform.tfvars`. A clean checkout that applied only the checked-in
# configuration would set `enable_service = false` and tear down a live claim
# path.
#
# Apply production with:
#
#   terraform apply -var-file=environments/production.tfvars
#
# alongside the operator's local `terraform.tfvars`.

enable_service = true
