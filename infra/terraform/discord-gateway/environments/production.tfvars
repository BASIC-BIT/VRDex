# Production run state for the Discord gateway.
#
# Checked in deliberately, and deliberately narrow: the enable state is not
# account-specific, and keeping it in git means applying from a clean checkout
# cannot silently stop the gateway. The image digest and `convex_site_url` are
# supplied per run, as `-var` or `TF_VAR_` values, and never live here.
#
# It starts false so the first apply creates only the repository, secrets, roles
# and network. It flips to true in its own PR once the secrets hold values, per
# `docs/deployment/discord-gateway.md`. Apply production with:
#
#   terraform apply -var-file=environments/production.tfvars

enable_service = false
