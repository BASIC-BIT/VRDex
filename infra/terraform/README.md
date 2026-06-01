# Terraform Stacks

VRDex keeps small infrastructure stacks separate so credentials, blast radius, and apply cadence stay clear.

- `ses/`: AWS SES sender identity and least-privilege Convex email credentials.
- `posthog/`: hosted PostHog project metadata for product analytics.
- `vercel/`: Vercel project environment variables for the hosted web app.

Each stack uses the shared S3 state bucket `vrdex-terraform-state` with a stack-specific state key and S3 native locking. Do not commit `terraform.tfvars`, local state, plans, or provider directories.
