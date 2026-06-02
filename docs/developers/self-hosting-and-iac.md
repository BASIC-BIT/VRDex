# Self-Hosting And Infrastructure As Code

## Status

Current direction for [#42](https://github.com/BASIC-BIT/VRDex/issues/42).

VRDex should be open-source, self-hostable, and reproducible from the repo. The hosted BASIC BIT deployment is the first operating path, not the only intended deployment shape.

## Locked Decisions

- Infrastructure and provider configuration should be represented as code or checked-in documentation whenever the platform supports it.
- Secret values belong in provider secret stores, not in git.
- The repo should commit expected variable names, scopes, owners, and recreation paths so hosted deployment state does not become dashboard-only tribal knowledge.
- Manual dashboard changes are acceptable for bootstrap or emergency work, but they need a follow-up docs, script, Terraform, or workflow artifact.
- Self-hosting should stay real, but it does not mean v0.5 needs one-click automation for every provider.

## Current Hosted Deployment Shape

The BASIC BIT hosted deployment currently uses:

- `Next.js` web app in `apps/web`
- Vercel project `vr-dex-web` for web hosting and staging deploys
- Convex Cloud development and production deployments for application data/functions/auth
- AWS SES for auth email
- Route 53 for `vrdex.net` DNS records
- PostHog project `447783` for hosted product analytics
- Terraform stacks under `infra/terraform/`
- GitHub Actions for baseline checks, deployed health, CodeQL, and staging deploys
- Docusaurus scaffold under `apps/docs`, reading canonical markdown from `docs/`

## IaC Ownership Table

| Area | Current owner | Notes |
| --- | --- | --- |
| Terraform backend | S3 bucket `vrdex-terraform-state` | Stack-specific state keys with S3 native locking. |
| SES auth email | `infra/terraform/ses` | Domain identity, DKIM, MAIL FROM, Route 53 records, and optional IAM sender key. |
| PostHog project metadata | `infra/terraform/posthog` | Imports hosted project `447783`; sensitive project token output feeds Vercel stack locally. |
| Hosted Vercel PostHog env vars | `infra/terraform/vercel` | Owns `NEXT_PUBLIC_POSTHOG_KEY` and `NEXT_PUBLIC_POSTHOG_HOST` for production, default preview, and configured staging custom environment IDs. |
| Vercel project, staging environment, and E2E helper vars | manual bootstrap plus docs | Documented in `docs/deployment/vercel-preview.md`; not Terraform-owned yet. |
| Convex deployment keys and env vars | provider secret store plus docs | Documented in `docs/deployment/convex-environments.md` and `docs/deployment/ses-auth-email.md`. |
| Convex custom domains | deferred manual provider setup | Requires Convex Pro and dashboard-provided DNS records before Route 53 records. |
| Profile asset storage | planned follow-up | Direction documented in `docs/deployment/aws-baseline.md`; [#115](https://github.com/BASIC-BIT/VRDex/issues/115) owns the S3 Terraform/runtime baseline. |

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
- Prefer docs plus exact provider object names when provider APIs are awkward or risky for the first bootstrap.
- Do not commit secret values, local Terraform state, local provider caches, or generated access-key secrets.
- When a secret must be manually set, document the variable name, target provider, intended environment, and how to recreate or rotate it.
- Keep docs close to the owning audience: public product behavior under `docs/public/`, developer/operator contracts under `docs/developers/`, deployment implementation notes under `docs/deployment/`, and planning or alternatives under engineering-oriented docs.

## Hosted Vs Self-Hosted Expectations

Hosted BASIC BIT deployment can move faster by using Vercel, Convex Cloud, PostHog Cloud, Route 53, and SES directly.

Self-hosted deployment should be able to reproduce the product shape with its own accounts and domains, but early self-hosting can require manual setup. The important v0.5 boundary is that implementation must not hard-code BASIC BIT project IDs, analytics keys, domains, or provider secrets as universal defaults.

## Not Yet Promised

- one-command production self-hosting
- cloud-agnostic replacements for every managed service
- final Kubernetes/container deployment story
- final local-only replacement for Convex Cloud
- public asset CDN topology
- production compliance hardening checklist
