# VRDex MCP Read Tools

## Status

Hosted MCP implementation checkpoint for [#78](https://github.com/BASIC-BIT/VRDex/issues/78).

The web app now serves a hosted Streamable HTTP MCP endpoint at `/mcp` using the official TypeScript MCP server SDK. The first tool set is anonymous and read-only, so public-safe search/browser-like use cases do not require login.

The broader platform plan for hosted MCP OAuth, local/private MCP, API tokens, OAuth applications, rate limiting, and Swagger/OpenAPI docs lives in `docs/planning/public-api-and-mcp-platform.md`. This page remains the first read-only tool contract for the MCP slice.

The first `/api/v0` anonymous public read routes now exist for profiles, search,
events, worlds, and claim status, with schemas generated through
`packages/api-contracts`. Hosted MCP tools call those API/query surfaces instead
of scraping web pages. The private/local MCP package remains a later slice.

## Locked Direction

- Default to a standalone VRDex MCP for VRDex public data.
- Keep optional VRChat MCP bridge tools out of scope unless a linked follow-up issue justifies them.
- Build curated tools first; generated API coverage needs its own linked issue or ADR before implementation.
- Use compact outputs with stable IDs/slugs for follow-up calls.
- Preserve public visibility, opt-out, trust, and provenance rules.
- Do not expose authenticated claim/write operations in the first read-only slice.
- Keep event-operator presence/readiness signals out of the standalone public read tool contract.

## Current Hosted Tools

### `vrdex_search`

Purpose: search public profiles, worlds, and events.

Inputs:

- `query`: human search text
- `type`: optional `all`, `person`, `community`, `profile`, `world`, or `event`
- `limit`: optional bounded result count

Output:

- compact search results with `slug`, entity type, title, route path, score, and public preview fields
- clear empty result message

### `vrdex_get_profile`

Purpose: read one public profile by slug.

Inputs:

- `slug`
- `profileType`: optional guard when caller knows the expected type

Output:

- public profile fields only
- trust/provenance labels
- public links and events where allowed
- no private or suppressed fields

### `vrdex_list_upcoming_events`

Purpose: list upcoming public events.

Inputs:

- `limit`: optional bounded result count

Output:

- public event cards with stable slugs/IDs, title, start/end time, public host/participant/world context, and canonical URL

### `vrdex_get_event`

Purpose: read one public event.

Inputs:

- `slug`

Output:

- public event details, participant links, media links, world association state, and provenance labels

### `vrdex_get_world`

Purpose: read one public world by slug.

Inputs:

- `slug`

Output:

- public world details, media, outbound links, creator attributions, event context, and provenance labels

### `vrdex_list_active_worlds`

Purpose: list public worlds with upcoming or live events.

Inputs:

- `limit`: optional bounded result count

Output:

- public active world cards with the next event preview and upcoming event count

## Safety Rules

- Use public API/query behavior, not website scraping.
- Treat not found, private, opted-out, and suppressed records as the same public-safe absence unless the public API deliberately exposes a safer status.
- Do not expose raw provider IDs unless they are already public and documented as safe.
- Do not expose private contact details or moderation-only fields.
- Do not imply owner confirmation for unclaimed, imported, community-submitted, or partner-provided records.
- Include source/provenance summaries wherever public data may be mistaken as authoritative.

## Hosted Vs Local MCP

Candidate direction:

- hosted/remote MCP is suitable for public read-only data because VRDex public data is not tied to private VRChat cookies
- anonymous hosted MCP read tools should be allowed for public-safe search/browser-like use cases, with their own rate-limit class
- local MCP remains useful for self-hosted deployments and development
- authenticated write/claim tools, if ever added, need normal VRDex auth, scoped tokens, approvals, and audit trails

Optional VRChat bridge evaluation:

- a local bridge can be evaluated separately for operator-owned event workflows, not for the standalone public read tools
- candidate bridge tools can resolve VRChat users, groups, or worlds to candidate VRDex records, or provide private event-operator hints when the operator has local credentials
- bridge-derived presence or readiness must be treated as private, freshness-scoped, and non-authoritative
- bridge tools must not be required for `vrdex_event_get`, event discovery, profile claims, or public event watch surfaces

## Implementation Gate

Do not implement the standalone package until the public API/query shape supports these tools without scraping. [#78](https://github.com/BASIC-BIT/VRDex/issues/78) remains the prototype issue and should align with the broader platform plan before choosing package name, transport, auth posture, API dependencies, test fixtures, and distribution path.
