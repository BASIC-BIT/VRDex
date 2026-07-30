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
- Upstash Redis through the Redis REST adapter for hosted API/MCP rate-limit counters
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
| Hosted API/MCP rate-limit Redis | `infra/terraform/rate-limit-redis` | Creates the Upstash Redis database for hot API/MCP counters and writes `VRDEX_RATE_LIMIT_STORE`, `VRDEX_RATE_LIMIT_REDIS_REST_URL`, `VRDEX_RATE_LIMIT_REDIS_REST_TOKEN`, and `VRDEX_RATE_LIMIT_REDIS_PREFIX` to the hosted Vercel project. Default PR previews stay unmanaged unless operators opt them into the shared store. |
| Vercel project, staging environment, and E2E helper vars | manual bootstrap plus docs | Documented in `docs/deployment/vercel-preview.md`; not Terraform-owned yet. |
| Docs Vercel project and `docs.vrdex.net` domain | `infra/terraform/docs-site` plus workflow | Owns the docs Vercel project, Vercel domain binding, and Route 53 DNS record; runbook lives in `docs/deployment/docs-site.md`. |
| Convex deployment keys and env vars | provider secret store plus docs | Documented in `docs/deployment/convex-environments.md` and `docs/deployment/ses-auth-email.md`. |
| Convex custom domains | deferred manual provider setup | Runbook lives in `docs/deployment/convex-environments.md`; requires Convex Pro and dashboard-provided DNS records before Route 53 records. |
| Profile asset storage | `infra/terraform/profile-assets` plus app runtime | Private S3 behavior, hosted Vercel OIDC auth, and runtime variable names are documented in `docs/deployment/aws-baseline.md`; lifecycle, deletion, CDN, and scanning remain follow-up work. |
| VRChat group telemetry collector | `infra/terraform/group-telemetry-collector` plus Convex control plane | Validation-only ECS/Fargate stack with account-scoped operating-system vault reuse for local proof, hosted account sessions under BASIC's recorded 2026-07-27 risk acceptance, one external secret per approved account, startup gate, alarms, budget, and hard task cap. Bootstrap and recovery live in `docs/deployment/group-telemetry-collector.md`. |
| VRCLinking proof adapter | `infra/terraform/vrclinking-adapter` plus Convex control plane | Lambda behind a public Function URL, authorized by a shared bearer token plus a per-delegation capability rather than by IAM, since Convex cannot sign SigV4. Its execution role can read every delegated community credential under the `vrdex/vrclinking/` name prefix — attach nothing else to it. Both shared secrets are provisioned outside Terraform, because a secret Terraform creates has its value in the state file. Deployment, rotation, and secret ownership live in `infra/terraform/vrclinking-adapter/README.md`. |

## Self-Hosted Minimum Components

A self-hosted operator should expect to provide:

- a web host capable of running the Next.js app
- a Convex deployment or compatible backend path supported by the repo at that time
- a domain and DNS host
- an SES sender identity or documented transactional email substitute once supported
- an asset object store compatible with the profile asset runtime configuration
- OAuth provider applications for enabled login providers
- a product analytics choice, with BASIC BIT hosted PostHog keys intentionally omitted from committed defaults
- secret storage for provider tokens, deploy keys, OAuth secrets, and email credentials
- when aggregate group telemetry is provider-approved and enabled, a dedicated operator-owned VRChat account, external per-account session secret containing no password or TOTP seed, and continuously running collector compatible with `workers/group-telemetry`

Self-hosting docs should distinguish required product configuration from BASIC BIT hosted deployment conveniences. Forks should not accidentally send analytics, email, or assets into BASIC BIT infrastructure.

## Public API, OAuth, And MCP Environment Inventory

Current API/MCP variables read by the web app:

| Variable | Scope | Required when | Notes |
| --- | --- | --- | --- |
| `CONVEX_ADMIN_TOKEN` | Web server secret | Route handlers call internal Convex functions. | Needed for server-side internal Convex list queries such as developer credential inventory. Use an environment-specific Convex admin/deploy token and rotate through the provider secret store. |
| `VRDEX_API_TOKEN_PEPPER` | Web server secret | Personal API tokens are created or validated. | Rotate by minting replacement tokens; old token hashes depend on the old pepper. |
| `VRDEX_OAUTH_CLIENT_SECRET_PEPPER` | Web server secret | Confidential OAuth client secrets are created or validated. | Rotate by issuing replacement client secrets. |
| `VRDEX_OAUTH_REFRESH_TOKEN_PEPPER` | Web server secret | Authorization-code or refresh-token OAuth grants are used. | Rotate by expiring active refresh tokens and requiring users to re-authorize; old refresh token hashes depend on the old pepper. |
| `VRDEX_OAUTH_ACCESS_TOKEN_SIGNING_KEY` | Web server secret | OAuth access tokens, JWKS, or OAuth bearer validation are used. | RSA private key PEM; keep in provider secret store. |
| `VRDEX_OAUTH_ACCESS_TOKEN_SIGNING_KID` | Web server config | Optional. | Advertised JWT key id; defaults to `vrdex-local`. |
| `VRDEX_OAUTH_ACCESS_TOKEN_ADDITIONAL_PUBLIC_JWKS` | Web server config | Optional during OAuth signing-key rotation. | JWKS JSON containing previous public keys to keep advertising and accepting until outstanding access tokens expire. |
| `VRDEX_OAUTH_ISSUER_URL` | Public URL config | Optional in single-origin deployments. | Overrides issuer origin for metadata and tokens. |
| `VRDEX_PUBLIC_API_BASE_URL` | Public URL config | Optional in single-origin deployments. | Defines the API resource/audience origin. |
| `VRDEX_MCP_RESOURCE_URI` | Public URL config | Optional in single-origin deployments. | Defaults to `<issuer>/mcp`. |
| `VRDEX_HOSTED_MCP_ANONYMOUS_READS` | Web server config | Optional. | Defaults to `true`. Set to `false` for an OAuth-only hosted MCP; anonymous requests receive a protected-resource challenge and tool descriptors advertise only `oauth2` with `mcp:read`. Invalid values fail configuration instead of silently enabling public access. |
| `VRDEX_HOSTED_MCP_EVENT_WRITES` | Web server config | Optional. | Defaults to `false`. When explicitly `true`, the hosted MCP advertises user-delegated event create/update tools and permits DCR/CIMD clients to request `mcp:write events:write`. Keep false in production until the separately approved activation rollout. |
| `VRDEX_RATE_LIMIT_STORE` | Web server config | Required in production. | Production accepts only `redis-rest` or `upstash`; previews and local development may use `memory`; `disabled` is local diagnostics only. |
| `VRDEX_DEPLOYMENT_ENV` | Web server config | Optional outside Vercel. | `development`, `preview`, `staging`, or `production`; defaults from `NODE_ENV`. Production rate limiting fails closed unless a shared store is configured. |
| `VRDEX_RATE_LIMIT_REDIS_REST_URL` | Web server config | Redis REST or Upstash mode. | Redis-compatible REST endpoint. BASIC BIT hosted production/staging values are Terraform-owned by `infra/terraform/rate-limit-redis`. |
| `VRDEX_RATE_LIMIT_REDIS_REST_TOKEN` | Web server secret | Redis REST or Upstash mode. | Bearer token for the Redis-compatible REST endpoint. BASIC BIT hosted production/staging values are written from the Upstash resource into Vercel by `infra/terraform/rate-limit-redis`; rotate by rotating the Upstash database credential and reapplying the stack. |
| `VRDEX_RATE_LIMIT_REDIS_PREFIX` | Web server config | Optional. | Prefix for isolating keys in shared Redis stores. BASIC BIT hosted production/staging default is `vrdex:rate-limit`. |
| `VRDEX_TRUSTED_PROXY_CLIENT_IP_HEADER` | Web server config | Self-hosted web traffic reaches VRDex through a trusted reverse proxy. | Name of the proxy-owned, single-IP header. The proxy must strip caller input, set the verified address, and block direct origin access. Do not set on Vercel; VRDex uses `X-Vercel-Forwarded-For` there. |

For self-hosted rate limiting, a configured client-IP header is a trust
contract with the reverse proxy, not a parser preference. Prefer a private
custom header such as `X-VRDEX-Connecting-IP`; never expose the application
origin directly or forward a client-provided copy unchanged. If the variable is
unset, VRDex deliberately groups anonymous requests into the `unknown` bucket.

Current local stdio MCP variables:

| Variable | Scope | Notes |
| --- | --- | --- |
| `VRDEX_API_BASE_URL` | Local client config | Hosted or self-hosted web origin, or explicit `/api/v0` base path. |
| `VRDEX_API_TOKEN` | Local client secret | Personal API token for authenticated API reads and, with `events:write`, local/private MCP event tools. |
| `VRDEX_OAUTH_ACCESS_TOKEN` | Local client secret | API-resource OAuth access token. |
| `VRDEX_OAUTH_TOKEN_FILE` | Local client secret path | Plain token file or JSON with `access_token`. |
| `VRDEX_MCP_OUTPUT_MODE` | Local client config | `compact` by default; `detail` pretty-prints JSON text output. |

The implemented `VRDEX_HOSTED_MCP_ANONYMOUS_READS` exposure control is
independent from the local stdio client, which remains governed by its own
credential configuration. Planned feature flags such as `VRDEX_PUBLIC_API_ENABLED`,
`VRDEX_DEVELOPER_DASHBOARD_ENABLED`,
`VRDEX_HOSTED_MCP_ENABLED`, and
`VRDEX_OAUTH_DYNAMIC_CLIENT_REGISTRATION_ENABLED` are not current code gates.
Add them only when the implementation actually checks them.

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
