# Docs Site Deployment

## Status

Current deployment runbook for [#125](https://github.com/BASIC-BIT/VRDex/issues/125).

The Docusaurus docs app builds and the hosted docs site has been confirmed live at `https://docs.vrdex.net`. `infra/terraform/docs-site` owns the Vercel docs project, domain binding, and Route 53 DNS record.

## Current State

- `apps/docs` is the Docusaurus shell.
- Canonical markdown stays under `docs/`.
- `pnpm verify:docs` runs `markdownlint-cli2` and `docusaurus build`.
- `apps/docs/docusaurus.config.js` uses `url: "https://docs.vrdex.net"` and `baseUrl: "/"`.
- `infra/terraform/docs-site` owns the Vercel docs project, Vercel domain binding, and Route 53 DNS record.
- `https://docs.vrdex.net` has been verified live after Terraform stack application and DNS propagation.

## Target Hosted Shape

Create or import the docs-only Vercel project through `infra/terraform/docs-site`:

| Setting | Value |
| --- | --- |
| Vercel project name | `vr-dex-docs` |
| Repository | `BASIC-BIT/VRDex` |
| Vercel project root directory | repository root (`.`) |
| Docs app directory | `apps/docs`, selected by workflow `--cwd apps/docs` flags |
| Framework preset | Docusaurus or Other |
| Build command | `pnpm build`, from `apps/docs/vercel.json` |
| Output directory | `build`, from `apps/docs/vercel.json` |
| Production domain | `docs.vrdex.net` |

`apps/docs/vercel.json` records the docs-local build command and output directory. The `Docs Deploy` workflow runs Vercel CLI commands from the repository root with `--cwd apps/docs`, so the Vercel project root should stay at the repository root instead of also being set to `apps/docs`.

Use root-level `pnpm verify:docs` in CI before deployment, but keep the Vercel project build command relative to the docs app root.

## Terraform Setup

The provider setup stack lives at `infra/terraform/docs-site` and uses the shared S3 backend:

- bucket: `vrdex-terraform-state`
- key: `docs-site/terraform.tfstate`
- region: `us-east-1`
- locking: S3 native lockfile (`use_lockfile = true`)

Before first apply, import any manually created Vercel docs project/domain resources into the stack state instead of creating duplicates. Review the stack plan before applying Route 53 changes.

The Terraform CI/CD workflow plans this stack on pull requests when AWS and Vercel credentials are configured. After `Baseline Checks` succeeds on `main`, the workflow applies this stack automatically from CI. Use `workflow_dispatch` on the `Terraform` workflow for manual plan/apply operations.

## GitHub Actions Settings

The `Docs Deploy` workflow runs after `Baseline Checks` succeeds on `main` and can also be run manually.

It deploys only when these repository secrets exist:

- `VERCEL_TOKEN`
- `VERCEL_ORG_ID`
- `VERCEL_DOCS_PROJECT_ID`

If any required setting is missing, the workflow writes a skip summary and exits successfully instead of partially deploying docs. `VERCEL_DOCS_PROJECT_ID` should point to the docs Vercel project, not the existing web app project. After Terraform import or apply, use `terraform output -raw vercel_docs_project_id` from `infra/terraform/docs-site` as the source value for this GitHub secret.

## DNS

DNS for `docs.vrdex.net` is managed in the Route 53 public hosted zone for `vrdex.net` by `infra/terraform/docs-site`.

The hosted docs target is currently the Vercel `A` record value `76.76.21.21`. Do not commit secret values, local Terraform state, plans, or provider-generated private IDs into public docs.

Expected validation after DNS propagation:

```powershell
Resolve-DnsName -Name "docs.vrdex.net"
```

## Verification

Before provider setup:

- `pnpm verify:docs`
- `pnpm verify`
- `actionlint .github/workflows/terraform.yml`
- `terraform fmt -check -recursive infra/terraform`
- `terraform validate` for `infra/terraform/docs-site`
- `Docs Deploy` workflow skips with a missing-settings summary if the docs project secret is not configured

After provider setup:

- `Docs Deploy` workflow succeeds on `main`
- `https://docs.vrdex.net/` loads the Docusaurus landing page
- `https://docs.vrdex.net/docs/` loads the canonical docs index
- `https://docs.vrdex.net/docs/developers/` loads the developer docs
- `https://docs.vrdex.net/docs/engineering/` loads the engineering docs

## Safety Rules

- Do not expose private partner context in public Docusaurus docs.
- Do not commit provider IDs or generated DNS target values unless there is a specific public operational reason.
- Keep secret values in GitHub/Vercel/provider secret stores only.
- Keep public docs deployment separate from the `apps/web` Vercel project so docs changes do not accidentally alter app routing.
