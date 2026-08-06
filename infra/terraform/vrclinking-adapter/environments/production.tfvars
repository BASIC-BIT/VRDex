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

# Enables the delegated-key write path: the Vercel-OIDC role the web app assumes
# to store a pasted VRCLinking key, plus the two environment variables that tell
# it the role and the region. Every field defaults to the checked-in team and
# project, so an empty object is the whole opt-in.
#
# Here for the same reason `enable_service` is: it is enable state, not an
# account-specific identifier, and applying without it would destroy the role
# and both variables — which reads to a community owner as the delegation form
# quietly deciding it is unavailable.
#
# `staging_custom_environment_ids` is NOT here, because Vercel environment ids
# are account-specific. It comes from `TF_VAR_staging_custom_environment_ids`,
# and applying without it destroys the staging copies of both variables the same
# way. Export it alongside this file.
vercel_delegation_writer = {}
