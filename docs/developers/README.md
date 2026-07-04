# Developer Docs

## Purpose

Developer docs explain how external developers, self-hosted operators, and partner agents integrate with VRDex or run it themselves.

Audience:

- API consumers
- self-hosted operators
- partner-tool authors
- external agents integrating with VRDex public data

## What Belongs Here

- public API shape and versioning
- rate-limit and auth posture for public consumers
- self-hosting setup expectations
- deployment and provider variable names
- portable skill and MCP integration guidance
- stable route/schema examples for external tools

## What Does Not Belong Here

- private BASIC BIT credentials or project secrets
- long product ideation notes
- alternatives we considered but are not asking developers to act on
- local agent workflow experiments unless they affect external integration

## Current Entry Points

- [VRDex partner-agent skill](./partner-agent-skill.md)
- [OpenCode skill adapter](./opencode-skill-adapter.md)
- [Public API posture](./public-api.md)
- [API authentication](./api-auth.md)
- [OAuth applications](./oauth-apps.md)
- [API and MCP rate limits](./api-rate-limits.md)
- [Self-hosting and IaC](./self-hosting-and-iac.md)
- [VRDex MCP read tools](./vrdex-mcp-read-tools.md)
- [API and MCP changelog](./api-changelog.md)
- [API and MCP rollout checklist](./api-mcp-rollout-checklist.md)
- [Service cross-link map](../engineering/service-map.md)

Files:

- `docs/developers/partner-agent-skill.md`
- `docs/developers/opencode-skill-adapter.md`
- `docs/developers/public-api.md`
- `docs/developers/api-auth.md`
- `docs/developers/oauth-apps.md`
- `docs/developers/api-rate-limits.md`
- `docs/developers/self-hosting-and-iac.md`
- `docs/developers/vrdex-mcp-read-tools.md`
- `docs/developers/api-changelog.md`
- `docs/developers/api-mcp-rollout-checklist.md`
- `docs/engineering/service-map.md`
- `skills/vrdex/SKILL.md`, compatibility pointer only

Deployment docs under `docs/deployment/` also serve developers and operators today. Move or mirror them only when that improves clarity without creating duplicated maintenance.
