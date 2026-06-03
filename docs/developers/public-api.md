# Public API Posture

## Status

Current direction for [#39](https://github.com/BASIC-BIT/VRDex/issues/39).

[#39](https://github.com/BASIC-BIT/VRDex/issues/39) owns the first documented public API direction. Current Convex functions, Next.js route handlers, and E2E helper routes are implementation surfaces, not the stable public product API.

## Locked Direction

- Public API behavior and limits should be documented before outside consumers depend on them.
- Public API routes should be versioned from the start.
- The first unstable public surface should use `/api/v0/...` so pre-launch breaking changes are honest and easy to isolate.
- Public API responses must preserve trust, provenance, claim, visibility, and opt-out semantics.
- First-party web usage and public consumer usage may share business logic while still using different transport, auth, and rate-limit layers.
- Structured integrations should prefer public API or MCP tools over website scraping.
- API docs should be usable by humans and agents, including compact examples and machine-readable schema docs once endpoints stabilize.

## First Public Read Surface

Candidate first public API endpoints:

- `GET /api/v0/profiles/:slug`
- `GET /api/v0/people/:slug`
- `GET /api/v0/communities/:slug`
- `GET /api/v0/search?q=`
- `GET /api/v0/cards/:slug`
- `GET /api/v0/worlds/:slug`
- `GET /api/v0/worlds/:slug/events`
- `GET /api/v0/worlds/active`
- `GET /api/v0/people/:slug/events`
- `GET /api/v0/communities/:slug/events`

The first public API should be read-only unless a specific write flow has an auth, rate-limit, audit, and abuse-handling design. `v0` can be replaced or deprecated before public launch if the implementation reveals a better shape.

## Client Classes

Use client classes instead of one global rate-limit model:

- first-party web app: normal product traffic, protected by app/session behavior and platform controls
- anonymous public clients: conservative unauthenticated read limits and cache-friendly responses
- trusted partners: explicit credentials, higher or specialized limits, and revocable access
- self-hosted local clients: operator-controlled limits documented by deployment configuration

Partner limits are a product and operations decision, not an excuse to bypass visibility, provenance, moderation, or opt-out rules.

## Rate-Limiting Intent

The first implementation should document:

- request identity basis, such as IP, token, partner key, or app session
- limit window and burst behavior
- cache headers where public data can be safely cached
- not-found behavior that does not leak private or suppressed records
- escalation path for trusted partner access

Candidate infrastructure can include Vercel/edge middleware, app-level checks, Convex-backed counters, Redis, or provider-native controls. Choose the smallest mechanism that fits the first API slice.

## Response Safety Rules

Public API responses must:

- hide `private` fields
- exclude `unlisted` fields from search, cards, and discovery-style projections
- honor profile-level opt-out and moderation suppression
- label unclaimed, community-submitted, imported, partner-provided, reviewed, and owner-confirmed data honestly
- avoid private auth identifiers, raw provider tokens, unreviewed contact exports, and moderation-only notes
- include stable IDs or slugs for follow-up calls where useful
- return compact not-found responses without hinting whether a private/suppressed object exists

## Documentation Shape

The first implementation issue for the public API should add:

- endpoint reference
- auth and rate-limit behavior
- OpenAPI or equivalent schema artifacts
- task-oriented examples for profile lookup, search, event lookup, profile cards, and partner-safe seed validation
- clear guidance to use API or MCP for structured reads instead of scraping public pages

## Non-goals for this pass

- implementing the public API now
- finalizing every endpoint
- authenticated public write APIs
- partner contracts
- full MCP implementation
