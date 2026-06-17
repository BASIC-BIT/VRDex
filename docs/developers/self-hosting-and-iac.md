# Self-hosting and infrastructure as code

## Status

Current direction for [#42](https://github.com/BASIC-BIT/VRDex/issues/42).

VRDex should be open-source, self-hostable, and reproducible from the repo. The hosted BASIC BIT deployment is the first operating path, not the only intended deployment shape.

## Locked Decisions

- Infrastructure and provider configuration should be represented as code or checked-in documentation whenever the platform supports it.
- Secret values belong in provider secret stores, not in git.
- The repo should commit expected variable names, scopes, owners, and recreation paths so hosted deployment state does not become dashboard-only tribal knowledge.
- Manual dashboard changes are acceptable for bootstrap or emergencies, but must be followed by docs, scripts, Terraform, or workflow updates.
- Self-hosting should stay real, but it does not mean v0.5 needs one-click automation for every provider.

## Current Hosted Deployment Shape

The hosted BASIC BIT deployment uses:

- `Next.js` web app in `apps/web`
- Vercel project `vr-dex-web` for web hosting and staging deploys
- Convex Cloud development and production deployments for application data/functions/auth
- AWS SES for auth email
- Route 53 for `vrdex.net` DNS records
- PostHog project `447783` for hosted product analytics
- Terraform stacks under `infra/terraform/`
- GitHub Actions for baseline checks, deployed health, CodeQL, and staging deploys
- GitHub Actions Terraform CI/CD for provider-backed plan/apply after merge
- Docusaurus scaffold under `apps/docs`, reading canonical markdown from `docs/`; [#125](https://github.com/BASIC-BIT/VRDex/issues/125) owns deployment to `docs.vrdex.net`

## IaC Ownership Table

| Area | Current owner | Notes |
| --- | --- | --- |
| Terraform backend | `infra/terraform/state-mgmt` | S3 bucket `vrdex-terraform-state`; stack-specific state keys with S3 native locking. |
| SES auth email | `infra/terraform/ses` | Domain identity, DKIM, MAIL FROM, Route 53 records, and optional IAM sender key. |
| PostHog project metadata | `infra/terraform/posthog` | Imports hosted project `447783`; sensitive project token output feeds Vercel stack locally. |
| Hosted Vercel web domains | `infra/terraform/web-domains` | Owns the `vrdex.net` and `www.vrdex.net` Vercel project-domain bindings and Route 53 records. |
| Hosted Vercel PostHog env vars | `infra/terraform/vercel` | Owns `NEXT_PUBLIC_POSTHOG_KEY`/`NEXT_PUBLIC_POSTHOG_HOST` for production, default preview, and configured staging custom environment IDs. |
| Vercel project, staging environment, and E2E helper vars | manual bootstrap plus docs | Documented in `docs/deployment/vercel-preview.md`; not Terraform-owned yet. |
| Docs Vercel project and `docs.vrdex.net` domain | `infra/terraform/docs-site` plus workflow | Owns the docs Vercel project, Vercel domain binding, and Route 53 DNS record; runbook lives in `docs/deployment/docs-site.md`. |
| Convex deployment keys and env vars | provider secret store plus docs | Documented in `docs/deployment/convex-environments.md` and `docs/deployment/ses-auth-email.md`. |
| Convex custom domains | deferred manual provider setup | Runbook lives in `docs/deployment/convex-environments.md`; requires Convex Pro and dashboard-provided DNS records before Route 53 records. |
| Profile asset storage | app runtime plus planned Terraform baseline | Runtime variable names and private S3 behavior are documented in `docs/deployment/aws-baseline.md`; [#115](https://github.com/BASIC-BIT/VRDex/issues/115) still owns fuller Terraform/lifecycle hardening. |

## Self-Hosted Minimum Components

A self-hosted operator should expect to provide:

- a web host capable of running the Next.js app
- a Convex deployment or compatible backend path supported by the repo at that time
- a domain and DNS host
- an SES sender identity or documented transactional email substitute once supported
- an asset object store once profile uploads are implemented by [#115](https://github.com/BASIC-BIT/VRDex/issues/115)
- OAuth provider applications for enabled login providers
- a product analytics choice, with BASIC BIT hosted PostHog keys intentionally omitted from committed defaults
- secret storage for provider tokens, deploy keys, OAuth secrets, and email credentials

Self-hosting docs should distinguish required product configuration from BASIC BIT hosted deployment conveniences. Forks should not accidentally send analytics, email, or assets into BASIC BIT infrastructure.

## Reproducibility Rules

- Prefer Terraform or checked-in workflows for infrastructure state when provider support is stable.
- Prefer Terraform CI/CD for provider-backed stacks: plan on pull requests when credentials are present, apply after merge from CI, and keep manual dispatch as an operator fallback.
- Prefer docs plus exact provider object names when provider APIs are awkward or risky for the first bootstrap.
- Do not commit secret values, local Terraform state, local provider caches, or generated access-key secrets.
- When a secret must be manually set, document the variable name, target provider, intended environment, and how to recreate or rotate it.
- Keep docs close to the owning audience: public product behavior under `docs/public/`, developer/operator contracts under `docs/developers/`, deployment implementation notes under `docs/deployment/`, and planning or alternatives under engineering-oriented docs.

## Scope Boundary For This Doc

This page is not a complete self-hosting guide yet. For [#42](https://github.com/BASIC-BIT/VRDex/issues/42), it only needs to make hosted provider choices and reproducibility gaps visible enough that follow-up implementation work has an owning doc, stack, or issue.

Concrete boundary:

- committed defaults must not contain BASIC BIT-only provider IDs, analytics keys, domains, or secret names as if they are universal settings
- required provider values should be listed by name and environment when they exist
- manually bootstrapped provider objects should link to their owning docs, Terraform stack, or follow-up issue
- unsupported deployment shapes should be omitted unless a linked issue or ADR owns the path
