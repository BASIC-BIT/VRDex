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
