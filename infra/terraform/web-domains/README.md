# Web Domains Terraform

This stack manages production custom domains for the hosted VRDex web app.

- Vercel project: `vr-dex-web`
- Vercel project domain: `vrdex.net`
- Vercel project domain: `www.vrdex.net`
- Route 53 `A` record: `vrdex.net -> 76.76.21.21`
- Route 53 `A` record: `www.vrdex.net -> 76.76.21.21`

## Usage

1. Copy `terraform.tfvars.example` to `terraform.tfvars`.
2. Confirm `production_domain`, `production_www_domain`, and `route53_zone_id` target the intended hosted zone.
3. Export a Vercel token for Terraform: `VERCEL_API_TOKEN=<token>`. If reusing the GitHub secret value locally, set `VERCEL_API_TOKEN` to the same value as `VERCEL_TOKEN`.
4. Run `terraform init`.
5. Run `terraform plan` and review Vercel project-domain and Route 53 changes.
6. Apply only after confirming the target project, domains, and DNS zone.

## Clerk Production DNS

This stack also creates the five CNAMEs the Clerk production instance needs, so
`clerk.vrdex.net` can serve the Frontend API and Account Portal. Clerk issues no
certificate until all five resolve, so a partial set is worse than none — a
`precondition` fails the plan rather than creating some of them.

**These are off by default.** `manage_clerk_dns` defaults to false and the mail
and DKIM targets default to null, because those targets carry a Clerk instance
id. A fork that enabled them with BASIC BIT's values would delegate its own
authentication-email DNS to BASIC BIT's Clerk tenant, which
`docs/developers/self-hosting-and-iac.md` forbids. Self-hosted deployments should
leave them off, or supply their own instance's targets from Clerk's
Configure > Domains page.

Hosted CI supplies them through repository variables, the same mechanism the SES
and profile-assets stacks already use:

- `TERRAFORM_WEB_DOMAINS_MANAGE_CLERK_DNS`
- `TERRAFORM_WEB_DOMAINS_CLERK_MAIL_TARGET`
- `TERRAFORM_WEB_DOMAINS_CLERK_DKIM1_TARGET`
- `TERRAFORM_WEB_DOMAINS_CLERK_DKIM2_TARGET`

**Run this stack through the workflow, not locally.** Without those variables a
local `terraform plan` reports `5 to destroy`, and applying it would delete
production authentication DNS. Use
`gh workflow run terraform.yml -f stack=web-domains -f apply=true`, or export the
same four values as `TF_VAR_manage_clerk_dns`, `TF_VAR_clerk_mail_target`,
`TF_VAR_clerk_dkim1_target`, and `TF_VAR_clerk_dkim2_target` first.

`CLERK_JWT_ISSUER_DOMAIN` on the Convex deployment must be
`https://<clerk_frontend_api_subdomain>.<hosted_zone_name>`, the same host the
production publishable key encodes. Decode it rather than assuming the subdomain.

## State Backend

Terraform state for this stack is stored in the S3 backend declared in `versions.tf`:

- bucket: `vrdex-terraform-state`
- key: `web-domains/terraform.tfstate`
- region: `us-east-1`
- locking: S3 native lockfile (`use_lockfile = true`)

## Existing Resources

If any managed Vercel project domain already exists in Vercel, import it before applying rather than creating a duplicate. The Vercel provider import ID is:

```text
<team_id>/<project_id>/<domain>
```

Route 53 record import IDs use the normal AWS provider shape:

```text
<zone_id>_<record_name>_<record_type>
```
