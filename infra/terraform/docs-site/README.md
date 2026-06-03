# Docs Site Terraform

This stack manages provider-side infrastructure for the public Docusaurus docs site at `docs.vrdex.net`.

It creates or imports:

- Vercel project `vr-dex-docs`
- Vercel project domain `docs.vrdex.net`
- Route 53 `A` record `docs.vrdex.net -> 76.76.21.21`

The docs build remains owned by `apps/docs/vercel.json` and `.github/workflows/docs-deploy.yml`. This stack only manages provider infrastructure and DNS.

## Usage

1. Copy `terraform.tfvars.example` to `terraform.tfvars` if overriding defaults.
2. Export a Vercel token for Terraform: `VERCEL_API_TOKEN=<token>`. If reusing the GitHub secret value locally, set `VERCEL_API_TOKEN` to the same value as `VERCEL_TOKEN`.
3. Run `terraform init`.
4. Import existing provider objects before the first plan if they were created manually:

```powershell
terraform import vercel_project.docs <vercel_team_id>/<vercel_docs_project_id>
terraform import vercel_project_domain.docs <vercel_team_id>/<vercel_docs_project_id>/<docs.vrdex.net>
```

- Run `terraform plan` and review Vercel and Route 53 changes.
- Apply only after confirming the target Vercel project, Route 53 zone, and DNS record.
- Store `terraform output -raw vercel_docs_project_id` in GitHub secret `VERCEL_DOCS_PROJECT_ID`.

## State Backend

Terraform state for this stack is stored in the S3 backend declared in `versions.tf`:

- bucket: `vrdex-terraform-state`
- key: `docs-site/terraform.tfstate`
- region: `us-east-1`
- locking: S3 native lockfile (`use_lockfile = true`)

## Verification

After apply and DNS propagation:

```powershell
Resolve-DnsName -Name "docs.vrdex.net"
```

Then verify:

- `https://docs.vrdex.net/`
- `https://docs.vrdex.net/docs/`
- `https://docs.vrdex.net/docs/developers/`
- `https://docs.vrdex.net/docs/engineering/`
