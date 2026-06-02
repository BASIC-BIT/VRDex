# Agent Integration Surface

## Purpose

Define how VRDex should become easy for other people's AI coding agents to understand and integrate with, without forcing every partner to reverse-engineer the website, API, or product model from scratch.

Tracking issue: `#73`.

## Working Thesis

VRDex should not only expose public data. It should expose an agent-readable product surface that makes outside repos, partner tools, and AI-coded projects good VRDex citizens by default.

The ideal developer experience:

- a partner points their coding agent at the VRDex skill or installs it into their repo
- the agent immediately understands VRDex's product model, API rules, trust/provenance boundaries, and website navigation patterns
- the agent can integrate profiles, events, links, embeds, and partner sync without hallucinating the product contract
- when richer structured actions are useful, the partner can use the VRDex MCP or public API instead of brittle website scraping

## Inspiration

### Basics agentic dogfooding

Useful pattern:

- portable skills should live in tool-agnostic `skills/<skill-name>/SKILL.md` paths, with adapters for OpenCode, Claude, Cursor, Codex, or other agents as needed
- keep the canonical skill small and route to docs for deeper details
- skills should encode repeatable workflows and tribal knowledge, not one-off notes
- install paths should be easy to copy into another repo's `AGENTS.md` or agent configuration

### VRChat MCP

Useful pattern:

- curated tools first, generated API coverage second
- small explicit tools with single purposes
- human-friendly inputs such as names or slugs where reasonable
- chainable outputs that include both labels and IDs
- compact summaries by default, with detail tools for follow-up
- clear not-found and stale-data guidance
- documented distribution surfaces and install snippets

## Product Surfaces

### 1. Portable VRDex Skill

Candidate direction:

- use the Docusaurus-visible canonical guidance at `docs/developers/partner-agent-skill.md`, not only an OpenCode-local `.opencode` skill
- keep tool-specific skill files short and pointed at public docs, API reference, navigation guide, and MCP docs
- include adapter docs for OpenCode, Claude Code, Codex, Cursor, Copilot/VS Code, and other common agent tools as they become practical
- make the installation story simple enough for partner repos: copy, vendor, submodule, package, or point an agent at the hosted skill URL

The skill should teach agents:

- VRDex's core nouns: person, community, profile, event, source, claim, visibility, opt-out, partner seed, event participant
- when to use public API vs website navigation vs MCP
- how to handle provenance, confidence, opt-out, and owner-confirmed data
- how to avoid scraping third-party competitors or treating unverified records as authoritative
- how to create partner integrations that preserve attribution and correction paths

### 2. Public API And OpenAPI Docs

Candidate direction:

- publish stable public API docs with examples for profile lookup, search, events, media links, and partner-safe export/import flows
- publish machine-readable OpenAPI or equivalent schema docs that agents can consume
- provide compact examples for common integration tasks, not only exhaustive endpoint reference
- document rate limits, authentication, partner tokens, and self-hosting behavior clearly

### 3. Website Navigation Guidance

Candidate direction:

- provide a lightweight website navigation guide for agents that need to inspect public VRDex pages or partner docs
- document stable route patterns for profiles, communities, events, docs, and API reference pages
- consider publishing `llms.txt`, `llms-full.txt`, or a similar agent-oriented sitemap once the public docs site exists
- prefer API/MCP for structured data and reserve browser navigation for visual/UI verification, docs reading, and human-like exploration

### 4. VRDex MCP

Candidate direction:

- a standalone `@basicbit/vrdex-mcp` is likely the cleanest long-term product surface
- because VRDex's core public data is not tied to private VRChat cookies, a hosted or remote MCP may be safer than VRChat MCP's current local-only auth model
- authenticated write or claim tools should still use normal VRDex auth, scoped tokens, approvals, and audit trails
- the MCP should expose curated tools first and optionally generated API coverage later
- MCP resources could expose common read surfaces such as profile cards, upcoming events, and partner documentation

The documentation-only first read-tool contract lives in `docs/developers/vrdex-mcp-read-tools.md`.

Candidate curated tools:

- `vrdex_profile_search`
- `vrdex_profile_get`
- `vrdex_community_search`
- `vrdex_community_get`
- `vrdex_events_upcoming`
- `vrdex_event_get`
- `vrdex_profile_links_get`
- `vrdex_partner_seed_validate`
- `vrdex_partner_seed_preview`
- `vrdex_claim_status_get`

### 5. VRChat MCP Bridge

Candidate direction:

- keep the default VRDex MCP standalone so VRDex's public/product API does not become coupled to private VRChat account automation
- consider optional bridge tools in VRChat MCP later when cross-context workflows are compelling, such as resolving a VRChat group/user/world to a VRDex profile or opening a VRDex event/profile from VRChat context
- do not put VRDex partner data or VRDex claim operations behind VRChat cookies

## Safety And Trust Rules

- Agent-facing docs and skills must preserve VRDex's source/provenance model.
- Public integrations should not imply that unclaimed, community-submitted, imported, or AI-extracted data is owner-confirmed.
- Partner imports should not encourage dumping raw spreadsheets into repos or public APIs.
- Website navigation guidance should discourage scraping when an API or MCP endpoint exists.
- Any authenticated MCP write or claim tool should be approval-friendly, auditable, and scoped.

## Rollout Order

Current recommendation:

1. Document the agent integration surface and MCP direction.
2. Publish public API posture and route/schema conventions.
3. Create a portable VRDex skill that points to canonical docs.
4. Add a website navigation guide and agent sitemap once public docs/routes exist.
5. Prototype standalone VRDex MCP read tools after the public API shape stabilizes.
6. Evaluate optional VRChat MCP bridge tools only after standalone VRDex tools prove useful.

## See Also

- `docs/planning/product-spec.md`
- `docs/planning/prd.md`
- `docs/planning/engineering-strategy.md`
