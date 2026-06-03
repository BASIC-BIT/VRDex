# Service Cross-Link Map

## Purpose

Use this page as the high-level map between VRDex services, docs, and implementation surfaces. Link from service-specific pages back to this map when readers need to understand how one area affects another.

## Public Product Surfaces

| Surface | Purpose | Related Docs |
| --- | --- | --- |
| Web app | Public profiles, discovery, submissions, events, worlds, auth, and account pages. | [Product spec](../planning/product-spec.md), [Search discovery](../backend/search-discovery.md), [Profile access and claims](../backend/profile-access-and-claims.md) |
| Docs site | Human and agent-readable source of truth. | [Docs strategy](../planning/docs-strategy.md), [Public docs](../public/README.md), [Developer docs](../developers/README.md), [Engineering docs](./README.md) |
| Public API | Future versioned read surface for structured consumers. | [Public API posture](../developers/public-api.md), [VRDex MCP read tools](../developers/vrdex-mcp-read-tools.md) |
| Partner-agent skill | Product-facing integration guidance for external agents. | [Partner agent skill](../developers/partner-agent-skill.md), [OpenCode adapter](../developers/opencode-skill-adapter.md) |

## Hosted Infrastructure

| Service | Purpose | Related Docs |
| --- | --- | --- |
| Vercel | Hosted web deployments, preview deployments, staging helpers. | [Vercel preview deployment](../deployment/vercel-preview.md), [Self-hosting and IaC](../developers/self-hosting-and-iac.md) |
| Convex | Application data, functions, auth integration, local backend verification. | [Convex bootstrap](../backend/convex-bootstrap.md), [Convex environments](../deployment/convex-environments.md) |
| AWS SES | Auth email sender and domain email verification. | [SES auth email](../deployment/ses-auth-email.md), [AWS service baseline](../deployment/aws-baseline.md) |
| AWS S3 | Planned private profile asset storage baseline. | [AWS service baseline](../deployment/aws-baseline.md) |
| Route 53 | DNS records for hosted domains, SES, and future provider-owned records. | [AWS service baseline](../deployment/aws-baseline.md), [Self-hosting and IaC](../developers/self-hosting-and-iac.md) |
| PostHog | Hosted product analytics and feature-flag direction. | [Product analytics and feature flags](../agentic/product-analytics-and-feature-flags.md), [Self-hosting and IaC](../developers/self-hosting-and-iac.md) |
| GitHub Actions | Baseline checks, CodeQL, hosted health checks, and deployment automation. | [Contributor workflow](../agentic/contributor-workflow.md), [Definition of done](../agentic/definition-of-done.md) |
| Terraform | Reproducible provider configuration and hosted bootstrap state. | [Self-hosting and IaC](../developers/self-hosting-and-iac.md), `infra/terraform/README.md` |

## Cross-Linking Rule

- Service docs should link to their owning implementation docs and to adjacent services they depend on.
- Product-facing pages should link to developer or engineering detail only when the reader needs deeper context.
- Developer docs should link to public behavior and implementation constraints so integrations preserve trust, visibility, and provenance.
- Engineering docs should link back to public/developer surfaces when a decision changes what users or external consumers can rely on.
