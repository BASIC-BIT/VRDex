# Developer Docs

## Purpose

Developer docs explain how external developers, self-hosted operators, and partner agents integrate with or run VRDex.

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

- `docs/developers/public-api.md`
- `docs/developers/self-hosting-and-iac.md`
- `docs/developers/vrdex-mcp-read-tools.md`
- `skills/vrdex/SKILL.md`

Deployment docs under `docs/deployment/` are currently developer/operator docs too. Move or mirror only when that improves clarity instead of creating duplicated maintenance.
