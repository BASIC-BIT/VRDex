---
name: vrdex
description: Help external partner agents understand VRDex's public product model, trust/provenance rules, API posture, website navigation, and MCP direction without relying on private repo context.
---

# VRDex Partner Agent Skill

## Purpose

Use this skill when integrating another project, bot, website, or agent workflow with VRDex public data.

This file is a compatibility entry point for agent tooling. The canonical human-reviewable guidance lives in `docs/developers/partner-agent-skill.md` so it is visible in Docusaurus.

## Read First

- `docs/developers/partner-agent-skill.md` for the canonical partner-agent guidance
- `docs/planning/product-spec.md` for product nouns and user flows
- `docs/backend/profile-schema.md` for profile fields, trust states, visibility, and source attribution
- `docs/backend/profile-access-and-claims.md` for claim, ownership, and field-visibility rules
- `docs/backend/search-discovery.md` for public discovery behavior
- `docs/developers/public-api.md` for API posture and rate-limit expectations
- `docs/developers/vrdex-mcp-read-tools.md` for planned read-only MCP tools
- `docs/planning/seed-import-model.md` for partner seed-import boundaries

## Adapter Notes

- OpenCode reference guidance: `docs/developers/opencode-skill-adapter.md`
- Other agent tools can vendor or link this `SKILL.md`, but substantial guidance belongs in Docusaurus-visible docs.
