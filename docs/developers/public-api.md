# Public API Posture

## Status

Current direction for [#39](https://github.com/BASIC-BIT/VRDex/issues/39).

[#39](https://github.com/BASIC-BIT/VRDex/issues/39) owns the first documented public API direction. Current Convex functions, Next.js route handlers, and E2E helper routes are implementation surfaces, not the stable public product API.

The full implementation-facing plan for API tokens, OAuth apps, rate limiting, Swagger/OpenAPI docs, and hosted/private MCP now lives in `docs/planning/public-api-and-mcp-platform.md`. This page remains the compact public API posture reference.

## Current v0 Implementation Checkpoint

`/api/v0` is now backed by shared TypeScript contract schemas in `packages/api-contracts`.
The checked-in OpenAPI artifact is `docs/api/openapi.json`, and the web app serves
the same generated document at `GET /api/v0/openapi.json`. The web app renders
the generated API reference at `/developers/api`. Signed-in developers can
manage personal API tokens at `/developers/tokens`; token creation uses a
first-party session route outside the public `/api/v0` contract, so it is not
included in the public OpenAPI document. Signed-in developers can also register
user-owned OAuth client apps at `/developers/apps`; the app registry and hashed
client-secret storage are in place. OAuth metadata, JWKS, client-credentials
token issuance, token revocation, constrained dynamic client registration for
hosted MCP clients, and public-client Authorization Code with PKCE are also in
place; refresh-token rotation and confidential-client authorization-code
exchange remain later implementation checkpoints.

Implemented public reads are anonymous by default and accept optional scoped
API bearer tokens or OAuth access tokens for authenticated public-read traffic:

| Route | Purpose |
| --- | --- |
| `GET /api/v0/search?q=` | Search public profiles, worlds, and events. |
| `GET /api/v0/profiles/:slug` | Read a public person or community profile. |
| `GET /api/v0/profiles/:slug/assets` | Read public profile media-kit assets. |
| `GET /api/v0/profiles/:slug/assets/:assetId/file` | Download a public profile media-kit asset. |
| `GET /api/v0/profiles/:slug/logos` | Read public profile logo assets. |
| `GET /api/v0/profiles/:slug/logos.zip` | Download public profile logos as a ZIP. |
| `GET /api/v0/people/:slug` | Read a public person profile. |
| `GET /api/v0/people/:slug/events` | Read public upcoming events for a person profile. |
| `GET /api/v0/communities/:slug` | Read a public community profile. |
| `GET /api/v0/communities/:slug/events` | Read public upcoming hosted events for a community profile. |
| `GET /api/v0/events/:slug` | Read a public event. |
| `GET /api/v0/events/upcoming` | List upcoming public events from discovery data. |
| `GET /api/v0/worlds/:slug` | Read a public world. |
| `GET /api/v0/worlds/active` | List worlds with upcoming or live public events. |
| `GET /api/v0/claims/:slug/status` | Read public claim and trust state. |

All public read routes reject bearer tokens in URL query parameters. Send API
tokens and future OAuth access tokens through the `Authorization` header only.

When a public read request has no bearer token, it is treated as anonymous
traffic. When it has an opaque API bearer token, the Next.js route handler
parses the `vrdx_...` token, hashes it with `VRDEX_API_TOKEN_PEPPER`, and asks
Convex to validate the token prefix, hash, status, expiry, and required scopes.
When it has an OAuth JWT access token, the route handler validates the issuer,
audience/resource, signature, expiry, and scope claims with
`VRDEX_OAUTH_ACCESS_TOKEN_SIGNING_KEY`, then asks Convex to confirm the stored
access-token id, client id, resource, status, expiry, and scopes. Convex stores
token prefixes, hashes, OAuth access-token ids, ownership, scopes, lifecycle
metadata, and audit events, but never raw personal token or OAuth client-secret
values.

Current personal API token backend primitives:

- `apiTokens.createPersonalToken`
- `apiTokens.listPersonalTokens`
- `apiTokens.revokePersonalToken`
- `apiTokens.validateBearerTokenHash`

Current OAuth app registry primitives:

- `oauthApps.createPersonalApplication`
- `oauthApps.listPersonalApplications`
- `oauthApps.revokePersonalApplication`
- `oauthApps.createDynamicMcpClient`
- `oauthApps.resolveAuthorizationClient`
- `oauthApps.issueAuthorizationCode`
- `oauthApps.consumeAuthorizationCode`
- `oauthApps.issueClientCredentialsAccessToken`
- `oauthApps.revokeClientAccessToken`

Current OAuth issuer routes:

- `GET /.well-known/oauth-authorization-server`
- `GET /.well-known/oauth-protected-resource`
- `GET /oauth/authorize`, for public-client Authorization Code with PKCE consent
- `GET /oauth/jwks.json`
- `POST /oauth/register`, for constrained hosted MCP Dynamic Client Registration
- `POST /oauth/token`, for public-client `authorization_code` and confidential `client_credentials`
- `POST /oauth/revoke`, currently for JWT access-token revocation

`POST /oauth/register` is not the normal developer-app creation path. It creates
separate public dynamic MCP clients with exact redirect URIs, `authorization_code`
grant metadata, `code` response type metadata, `token_endpoint_auth_method=none`,
the MCP resource, and only `mcp:read` plus optional `public:read` scope. These
clients are for hosted MCP OAuth compatibility.

`GET /oauth/authorize` currently supports public clients with
`code_challenge_method=S256`. Approval creates a short-lived single-use
authorization code, and `POST /oauth/token` exchanges that code for a
resource-bound JWT access token. Refresh tokens are intentionally not issued in
this checkpoint.

Current hosted MCP route:

- `GET|POST|DELETE /mcp`, Streamable HTTP MCP with anonymous public read tools

Current token validation behavior:

- malformed, unknown, revoked, or expired bearer tokens return `401`
- scope-insufficient bearer tokens return `403`
- public read routes currently require `public:read`
- OAuth access tokens must be issued for the API resource to count as authenticated API traffic
- OAuth access tokens issued for the MCP resource and carrying `mcp:read` count as authenticated MCP traffic
- anonymous public reads still work without credentials

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
- `GET /api/v0/profiles/:slug/assets`
- `GET /api/v0/profiles/:slug/logos`
- `GET /api/v0/profiles/:slug/logos.zip`
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

Current recommendation: use Redis-compatible TTL counters for hosted
high-volume anonymous public API and hosted MCP traffic. Keep Convex as the
durable source for token/app ownership, quota policy, trusted-partner
overrides, coarse usage summaries, and audit events. Local development can use
an in-memory adapter; self-hosted production should document a
Redis-compatible option.

Current implementation:

- `VRDEX_RATE_LIMIT_STORE=memory` uses a process-local fixed-window counter.
- `VRDEX_RATE_LIMIT_STORE=redis-rest` or `upstash` uses a Redis-compatible REST
  pipeline with `VRDEX_RATE_LIMIT_REDIS_REST_URL` and
  `VRDEX_RATE_LIMIT_REDIS_REST_TOKEN`.
- `VRDEX_RATE_LIMIT_REDIS_PREFIX` isolates keys when shared infrastructure is
  used.
- `VRDEX_RATE_LIMIT_STORE=disabled` is only for local diagnostics.

## Response Safety Rules

Public API responses must:

- hide `private` fields
- exclude `unlisted` fields from search, cards, and discovery-style projections
- honor profile-level opt-out and moderation suppression
- label unclaimed, community-submitted, imported, partner-provided, reviewed, and owner-confirmed data honestly
- avoid private auth identifiers, raw provider tokens, unreviewed contact exports, and moderation-only notes
- include stable IDs or slugs for follow-up calls where useful
- return compact not-found responses without hinting whether a private/suppressed object exists
- expose profile media-kit assets from VRDex-managed storage rather than hotlinking external source URLs as canonical downloads
- include primary logo plus additional public logos where logo lookup is requested
- include bounded avatar appearance metadata only as presentation hints, including border color/thickness/softness and roundedness, never as arbitrary CSS
- include bounded profile section ordering only as known public section keys, never as arbitrary page-builder blocks

## Documentation Shape

The first implementation issue for the public API should add:

- endpoint reference
- auth and rate-limit behavior
- OpenAPI artifacts generated from shared API contract schemas
- task-oriented examples for profile lookup, search, event lookup, profile cards, and partner-safe seed validation
- clear guidance to use API or MCP for structured reads instead of scraping public pages

## Non-goals for the original posture pass

- implementing the public API now
- finalizing every endpoint
- replacing the full platform plan in `docs/planning/public-api-and-mcp-platform.md`
- partner contracts beyond the auth/rate-limit hooks needed for future implementation
