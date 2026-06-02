# Docs Site Deployment

## Status

Current deployment runbook for [#125](https://github.com/BASIC-BIT/VRDex/issues/125).

The Docusaurus docs app exists and builds, but `https://docs.vrdex.net` is not live until the Vercel docs project, custom domain binding, GitHub secret, and Route 53 DNS record are configured.

## Current State

- `apps/docs` is the Docusaurus shell.
- Canonical markdown stays under `docs/`.
- `pnpm verify:docs` runs `markdownlint-cli2` and `docusaurus build`.
- `apps/docs/docusaurus.config.js` uses `url: "https://docs.vrdex.net"` and `baseUrl: "/"`.
- `docs.vrdex.net` currently has no DNS record.

## Target Hosted Shape

Create or import a Vercel project for docs only:

| Setting | Value |
| --- | --- |
| Vercel project name | `vr-dex-docs` |
| Repository | `BASIC-BIT/VRDex` |
| Root directory | `apps/docs` |
| Framework preset | Docusaurus or Other |
| Build command | `pnpm build` |
| Output directory | `build` |
| Production domain | `docs.vrdex.net` |

`apps/docs/vercel.json` records the docs-local build command and output directory. The `Docs Deploy` workflow runs Vercel CLI commands from the repository root with `--cwd apps/docs`, which keeps the deploy path reproducible even if the provider project root setting is still `.`.

Use root-level `pnpm verify:docs` in CI before deployment, but keep the Vercel project build command relative to the docs app root.

## GitHub Actions Settings

The `Docs Deploy` workflow runs after `Baseline Checks` succeeds on `main` and can also be run manually.

It deploys only when these repository secrets exist:

- `VERCEL_TOKEN`
- `VERCEL_ORG_ID`
- `VERCEL_DOCS_PROJECT_ID`

If any required setting is missing, the workflow writes a skip summary and exits successfully instead of partially deploying docs. `VERCEL_DOCS_PROJECT_ID` should point to the docs Vercel project, not the existing web app project.

## DNS

DNS for `docs.vrdex.net` should be managed in the Route 53 public hosted zone for `vrdex.net`.

After `docs.vrdex.net` is added to the Vercel docs project, copy the exact DNS record Vercel provides into Route 53. Do not commit provider-generated hosted zone IDs, project IDs, account IDs, or secret values into public docs.

Expected validation after DNS propagation:

```powershell
Resolve-DnsName -Name "docs.vrdex.net"
```

## Verification

Before provider setup:

- `pnpm verify:docs`
- `pnpm verify`
- `Docs Deploy` workflow skips with a missing-settings summary if the docs project secret is not configured

After provider setup:

- `Docs Deploy` workflow succeeds on `main`
- `https://docs.vrdex.net/` loads the Docusaurus landing page
- `https://docs.vrdex.net/docs/` loads the canonical docs index
- `https://docs.vrdex.net/docs/developers/` loads the developer lane
- `https://docs.vrdex.net/docs/engineering/` loads the engineering lane

## Safety Rules

- Do not expose private partner context in public Docusaurus docs.
- Do not commit provider IDs or generated DNS target values unless there is a specific public operational reason.
- Keep secret values in GitHub/Vercel/provider secret stores only.
- Keep public docs deployment separate from the `apps/web` Vercel project so docs changes do not accidentally alter app routing.
