# VRDex Partner Agent Skill

## Purpose

Use this guidance when integrating another project, bot, website, or agent workflow with VRDex public data.

This is the canonical Docusaurus-visible version of the portable partner-agent skill. Tool-specific skill files under `skills/` should stay thin and point here instead of becoming a hidden second source of truth.

## Read First

- [Product spec](../planning/product-spec.md) for product nouns and user flows
- [Profile schema](../backend/profile-schema.md) for profile fields, trust states, visibility, and source attribution
- [Profile access and claims](../backend/profile-access-and-claims.md) for claim, ownership, and field-visibility rules
- [Search discovery](../backend/search-discovery.md) for public discovery behavior
- [Public API posture](./public-api.md) for API posture and rate-limit expectations
- [VRDex MCP read tools](./vrdex-mcp-read-tools.md) for planned read-only MCP tools
- [Seed import model](../planning/seed-import-model.md) for partner seed-import boundaries

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

## Reference Options

- Read the Docusaurus page when working inside VRDex or when the public docs site is reachable.
- Vendor `skills/vrdex/SKILL.md` only as a thin compatibility entry point for agent tools that expect a skill file.
- If this guidance is copied into another repo, keep links pointed at the canonical VRDex docs instead of duplicating full product docs.

## Common Tasks

### Profile Lookup

- Search by name, alias, tag, or slug through the public API once [#39](https://github.com/BASIC-BIT/VRDex/issues/39) lands.
- Return canonical URL, display name, profile type, trust label, and compact public summary.
- Include stable slug/ID for follow-up lookups.

### Event Lookup

- Use public event reads or MCP event tools once the [#78](https://github.com/BASIC-BIT/VRDex/issues/78) prototype lands.
- Preserve public host, participant, world, and media-link provenance.
- Do not imply live VRChat attendance unless VRDex has a documented safe source.

### Media Links

- Treat profile and event media links as public only when they pass visibility, review, and provenance checks.
- Preserve source labels such as owner-authored, reviewed, partner-provided, or community-submitted.
- Do not rehost private source media, raw exports, or unreviewed third-party assets through partner integrations.

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

- [OpenCode adapter notes](./opencode-skill-adapter.md) describe how external OpenCode repos can reference this guidance.
- Other agent tools can vendor a thin pointer file, but this Docusaurus page should stay the canonical human-reviewable source.
