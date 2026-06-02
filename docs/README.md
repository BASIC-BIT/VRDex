# Docs

This repo keeps durable markdown under `docs/` so product, developer, engineering, and agentic knowledge stays structured and discoverable.

## Lanes

- `docs/public/README.md` - plain-language user-facing product docs for current behavior
- `docs/developers/README.md` - integration, API, self-hosting, deployment, and partner-agent docs
- `docs/engineering/README.md` - ADRs, alternatives considered, deep technical notes, and maintainer/operator context

## Current Sections

- `docs/planning/README.md` - product, architecture, roadmap, backlog, and issue-planning docs; treat as engineering until promoted
- `docs/agentic/README.md` - software-factory, onboarding, control-loop, and agent workflow docs; treat as engineering/operator context
- `docs/backend/convex-bootstrap.md` - backend bootstrap workflow and structure notes
- `docs/backend/event-schema.md` - event records, participant links, media links, and world-association notes
- `docs/developers/public-api.md` - public API posture, versioning, client classes, and rate-limiting direction
- `docs/developers/vrdex-mcp-read-tools.md` - documentation-only first pass for standalone read-only VRDex MCP tools
- `docs/deployment/aws-baseline.md` - first-pass AWS service baseline for SES and future S3 assets
- `docs/developers/self-hosting-and-iac.md` - self-hosting, hosted deployment, and IaC ownership direction
- `docs/deployment/vercel-preview.md` - initial Vercel hosted-preview setup and validation path
- `docs/deployment/ses-auth-email.md` - SES auth email and Convex environment variables
- `docs/testing/playwright-visual-preview.md` - current Playwright screenshot preview and data-flow artifact workflow
- `docs/testing/playwright-image-diffing.md` - planned committed-baseline image diff workflow

Useful starting points:

- `docs/agentic/contributor-workflow.md` - contributor contract and onboarding pointer
- root `README.md` - current workspace bootstrap commands, including the initial web app
- `apps/docs` - Docusaurus scaffold that serves the canonical markdown from `docs/`
- `skills/vrdex/SKILL.md` - portable partner-agent skill that points back to public docs

## Working rule

- use `AGENTS.md` for short durable repo-wide rules
- use `AGENTS.local.md` for personal/operator preferences only
- use `docs/` for canonical human+agent reference material
- use skills as thin routing/onboarding layers that point back to docs
- use `apps/docs` as the browsable Docusaurus shell, not as a second source of truth
