---
name: vrdex
description: Help external partner agents understand VRDex's public product model, trust/provenance rules, API posture, website navigation, and MCP direction without relying on private repo context.
---

# VRDex Partner Agent Skill

## Purpose

Use this skill when integrating another project, bot, website, or agent workflow with VRDex public data.

This is the portable product-facing skill. It is separate from repo-local maintainer onboarding under `.opencode/skills/`.

## Read First

- `docs/planning/product-spec.md` for product nouns and user flows
- `docs/backend/profile-schema.md` for profile fields, trust states, visibility, and source attribution
- `docs/backend/profile-access-and-claims.md` for claim, ownership, and field-visibility rules
- `docs/backend/search-discovery.md` for public discovery behavior
- `docs/developers/public-api.md` for API posture and rate-limit expectations
- `docs/developers/vrdex-mcp-read-tools.md` for planned read-only MCP tools
- `docs/planning/seed-import-model.md` for partner seed-import boundaries

## Core Nouns

- `person`: a DJ, VJ, host, photographer, performer, creator, or scene staff profile
- `community`: a club, collective, venue, group, brand, agency, or other non-person scene entity
- `profile`: the shared public identity record behind people and communities
- `claim`: a process that attaches owner authority to an existing profile without replacing the record
- `trust label`: public copy derived from claim state and creation/source provenance
- `field visibility`: per-field `public`, `unlisted`, or `private` surfacing control
- `opt-out`: profile-level public surfacing suppression, separate from field privacy
- `world`: a VRChat world/venue record, separate from person/community profiles
- `event`: a public event record that can link to profiles and worlds
- `partner seed`: a permissioned candidate import that needs review before publication

## Trust Rules

- Do not treat unclaimed, community-submitted, imported, or partner-provided records as owner-confirmed.
- Preserve provenance labels when showing or transforming VRDex data.
- Respect field visibility and opt-out across profile pages, search, cards, API responses, MCP tools, and exports.
- Do not publish private contact details, raw provider tokens, moderation-only notes, or raw third-party spreadsheets.
- Use correction, claim, review, or suppression paths for disputed data instead of overwriting public facts silently.

## Integration Order

1. Prefer a documented public API or MCP tool for structured reads.
2. Use website navigation only for human-visible pages, docs, and visual/UI verification.
3. Avoid scraping public pages when an API or MCP route exists.
4. Keep partner imports as reviewed candidate data until VRDex explicitly publishes or links them.
5. Ask for a product decision before adding a new trust state, provider-specific sync path, or public write behavior.

## Common Tasks

### Profile Lookup

- Search by name, alias, tag, or slug through the public API once available.
- Return canonical URL, display name, profile type, trust label, and compact public summary.
- Include stable slug/ID for follow-up lookups.

### Event Lookup

- Use public event reads or future MCP event tools.
- Preserve public host, participant, world, and media-link provenance.
- Do not imply live VRChat attendance unless VRDex has a documented safe source.

### Partner Seed Validation

- Normalize candidate rows only enough to preview them.
- Attach source, confidence, review state, and visibility per proposed field.
- Use fake fixtures in repos and tests unless explicit permission exists for real data handling.

### Website Navigation

- Public person profiles are expected at `/p/<slug>`.
- Public community profiles are expected at `/c/<slug>`.
- Public world pages are expected at `/w/<slug>`.
- Event routes and final API routes should be read from current docs before use.

## Non-Goals

- Do not automate claim or owner-write flows through this skill.
- Do not couple VRDex public data to private VRChat cookie-based auth.
- Do not include private partner context, raw exports, unpublished negotiations, or secrets.
- Do not invent provider-specific API behavior from one natural-language example.

## Adapter Notes

- OpenCode reference guidance: `skills/vrdex/adapters/opencode.md`
- Other agent tools can vendor or link this `SKILL.md` directly and keep tool-specific install details outside the canonical skill.
