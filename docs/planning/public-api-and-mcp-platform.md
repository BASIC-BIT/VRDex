# Public API And MCP Platform Plan

## Status

Current recommendation.

This plan expands the completed public API posture work from [#39](https://github.com/BASIC-BIT/VRDex/issues/39), the agent integration roadmap from [#73](https://github.com/BASIC-BIT/VRDex/issues/73), and the open read-only MCP prototype from [#78](https://github.com/BASIC-BIT/VRDex/issues/78) into one executable platform backlog chunk.

The intended delivery shape is one implementation PR with internally testable slices. The PR can carry multiple commits and checkpoints, but the product surface should review as one coherent API, auth, docs, and MCP platform foundation.

## Goals

- make VRDex usable outside the web app without scraping
- publish a documented `/api/v0` HTTP API with generated Swagger/OpenAPI reference
- support anonymous public reads, minted API tokens, OAuth user-delegated flows, and OAuth application flows
- expose a hosted public MCP that can use OAuth
- expose a private/local MCP path that can use API tokens or OAuth against hosted and self-hosted deployments
- keep public data safety, trust labels, provenance, opt-out, and suppression rules identical across web, API, OpenAPI examples, and MCP tools
- keep the implementation self-hostable and reproducible through docs, checked-in config, and environment-variable inventory

## Non-goals

- a permanently stable `v1` API contract before launch
- raw VRChat cookie automation or private VRChat account bridging inside the default VRDex MCP
- broad partner sync contracts for every external provider
- unrestricted public write APIs
- billing-tier enforcement beyond the rate-limit and capability hooks needed for this platform foundation
- one giant role/permission matrix for every future tool

## Product Thesis

VRDex's API and MCP are product surfaces, not internal plumbing. They should let communities, partner sites, bots, and coding agents use VRDex data without pretending that public web pages are the integration contract.

The first useful version should feel small and sharp:

- public reads are easy and safe
- authenticated access is explicit and revocable
- OAuth apps are understandable to normal developers
- Swagger docs and MCP tools agree on the same data model
- self-hosted operators can run the same shape without hidden dashboard-only steps

## Locked Decisions

- `Locked decision`: The HTTP API starts under `/api/v0/...`.
- `Locked decision`: `v0` is explicitly unstable until public launch, but breaking changes still require docs and changelog updates.
- `Locked decision`: Public API, MCP, and Swagger examples must preserve trust, provenance, claim, visibility, opt-out, and suppression semantics.
- `Locked decision`: Structured integrations should prefer public API or MCP tools over website scraping.
- `Locked decision`: OpenAPI artifacts must be generated from shared API contract schemas, not hand-rolled as a parallel source of truth.
- `Locked decision`: Hosted MCP should expose anonymous public read tools on day one, with anonymous callers treated as a distinct rate-limit class.
- `Locked decision`: Token values must never be stored in plaintext. Display newly minted API tokens and OAuth client secrets only once, then store verifier hashes plus metadata.
- `Locked decision`: Bearer tokens must not be accepted from URL query parameters.
- `Locked decision`: OAuth access tokens must be audience/resource-bound. VRDex must not accept or pass through tokens minted for another resource.
- `Locked decision`: Hosted MCP over HTTP follows the current MCP authorization model and Streamable HTTP transport.
- `Locked decision`: Local stdio MCP uses environment or local config credentials and does not try to run the HTTP MCP authorization handshake over stdio.
- `Locked decision`: Normal developer apps support user-owned apps plus owner-managed community-owned apps. Staff/admin delegation for community-owned apps is a later capability.

## Current Recommendations

- `Current recommendation`: Treat this as `EPIC-12 Public API foundation` plus the first implementation wave for `#78`.
- `Current recommendation`: Use one developer platform model for API tokens, OAuth applications, OAuth grants, dynamic MCP client registrations, and MCP access.
- `Current recommendation`: Keep anonymous public reads first, then authenticated reads, then narrow audited writes.
- `Current recommendation`: Use Convex as the authoritative application data and policy layer, with Next.js route handlers as the public HTTP gateway.
- `Current recommendation`: Put the VRDex OAuth authorization server in Next.js route handlers backed by Convex tables and internal Convex functions. Convex remains the data/control plane; Next owns browser redirects, consent UX, metadata endpoints, token routes, CORS, and HTTP semantics.
- `Current recommendation`: Do not treat Convex Auth's inbound sign-in providers as the third-party developer OAuth issuer. Convex Auth remains first-party account authentication; the VRDex developer platform issues tokens for external clients.
- `Current recommendation`: Use shared TypeScript API contract schemas as the source of truth for runtime validation, response typing, example generation, and OpenAPI generation. Convex validators remain the database/function boundary.
- `Current recommendation`: Keep the generated artifact on OpenAPI 3.1.x for Swagger UI and `zod-openapi` compatibility, even though OpenAPI 3.2.0 is the latest published spec. Track 3.2.0 as a later generator/tooling upgrade, not a launch blocker.
- `Current recommendation`: Use Zod 4 plus `zod-openapi` as the first contract toolchain. The implementation spike has validated the route shape enough to keep this as the current path.
- `Current recommendation`: Use opaque hashed personal API tokens. Use short-lived RFC 9068-style JWT OAuth access tokens with audience/resource binding, plus opaque refresh-token rotation for user-delegated OAuth flows.
- `Current recommendation`: Support OAuth Authorization Code with PKCE for user-delegated apps and Client Credentials for app-only access.
- `Current recommendation`: Start normal developer apps with manual OAuth app registration in the VRDex developer dashboard and API. Include constrained Dynamic Client Registration for hosted MCP OAuth on day one, stored separately from user/community-owned apps until reviewed or promoted.
- `Current recommendation`: Treat Client ID Metadata Documents as a compatibility path for MCP clients that prefer preconfigured metadata over Dynamic Client Registration. Keep DCR as the first implemented automatic path, but include CIMD in the hosted-client smoke matrix before external readiness.
- `Current recommendation`: Rate-limit by route class, IP, token, OAuth client, user, app owner, and dynamic MCP client. Do not use one global bucket for every caller.
- `Current recommendation`: Use a Redis-compatible TTL counter store for high-volume hosted anonymous public API and MCP traffic. Keep Convex as the durable source for policy, app/token ownership, partner overrides, coarse usage summaries, and audit events.
- `Current recommendation`: Launch the hosted MCP as read-oriented first, even if the auth platform already supports scopes that make later write tools possible.
- `Current recommendation`: Trusted partner access is a manual review tier with very high quotas compared with normal personal tokens, but it still needs contact ownership, abuse/cost guardrails, observability, and fast revocation.

## Candidate Directions

- `Candidate direction`: Add a dedicated API hostname later, but keep the first public route shape under the web app until operational pressure justifies a split.
- `Candidate direction`: Publish `/.well-known/oauth-authorization-server` and OAuth protected-resource metadata from the web app route-handler surface.
- `Candidate direction`: Use an adapter interface for rate-limit storage so hosted deployments can use Upstash/Vercel KV/Valkey/Redis-compatible infrastructure, local development can use an in-memory adapter, and self-hosted production can bring its own Redis-compatible store.
- `Candidate direction`: Add a hosted MCP compatibility matrix for every major MCP client available at implementation time. The matrix should cover anonymous Streamable HTTP reads, OAuth hosted tools, and stdio private/local configuration.
- `Candidate direction`: Add an optional generated MCP coverage layer from OpenAPI only after curated tools prove useful.

## Interview Later

- `Interview later`: Final default quota numbers for anonymous, personal-token, trusted-partner, and self-hosted callers after production traffic and cost signals exist.
- `Interview later`: Whether partner application flows can access anything beyond public data before formal partner contracts exist.
- `Interview later`: Whether self-hosted deployments need built-in multi-tenant OAuth issuer support or only one issuer per deployment.
- `Interview later`: Whether paid tiers should raise API and MCP limits at launch or only after organic demand appears.
- `Interview later`: Which staff/admin delegation workflows are needed for community-owned OAuth apps after the owner-only first pass.

## Client Classes

### Anonymous Public Clients

Use cases:

- public profile lookup
- search
- public event discovery
- public world/event association reads
- OpenAPI and docs examples

Properties:

- no bearer credential
- conservative IP and route limits
- cache-friendly responses where visibility rules allow
- no private, unlisted, suppressed, or moderation-only data

### Personal API Tokens

Use cases:

- personal scripts
- private MCP configuration
- self-hosted operator workflows
- trusted automation owned by a VRDex user

Properties:

- minted from account developer settings
- scoped
- optionally expires
- revocable
- last-used timestamp and coarse usage metadata
- cannot bypass profile visibility, ownership, or opt-out rules

### OAuth User-Delegated Apps

Use cases:

- partner apps acting for a signed-in VRDex user
- desktop clients
- agents that need user approval for scoped access
- hosted MCP user sessions

Properties:

- Authorization Code with PKCE
- explicit user consent screen
- exact redirect URI matching
- short-lived access tokens
- refresh token rotation
- revocable per user and app
- scoped to user-authorized capabilities

### OAuth Application Apps

Use cases:

- server-to-server integrations
- partner jobs
- application-owned public data reads
- future approved partner syncs

Properties:

- Client Credentials grant
- no implied user authority
- limited scopes until partner contracts exist
- rate limits tied to OAuth client and owning user/community
- secrets rotatable from the developer dashboard

### Dynamic MCP Clients

Use cases:

- hosted MCP clients that need OAuth registration without a hand-created client id
- broad day-one compatibility across major MCP clients

Properties:

- registered through constrained Dynamic Client Registration
- public client type by default
- no client secret unless the client is manually promoted
- limited to MCP resource access
- anonymous/public read and user-delegated read scopes only at first
- lower default trust than manually reviewed developer apps
- rate-limited by dynamic client id, IP, user grant, and route class

### First-Party Web App

Use cases:

- normal VRDex product usage
- owner editing flows
- internal admin screens

Properties:

- may share service functions with public API routes
- uses first-party session auth instead of public API tokens
- still goes through the same visibility and permission policy helpers

### Hosted MCP

Use cases:

- remote agent integrations
- partner coding agents
- docs-aware public queries
- anonymous search/browser-like public data reads
- user-authorized workflows later

Properties:

- Streamable HTTP transport
- protected by OAuth when a tool needs auth
- public read tools are available without auth where the same data is already safely public
- anonymous callers use the anonymous MCP rate-limit class
- uses MCP resource metadata and audience/resource-bound tokens

### Private Or Local MCP

Use cases:

- local developer use
- self-hosted deployment automation
- private community operations
- MCP clients that prefer stdio

Properties:

- package candidate: `@basicbit/vrdex-mcp`
- stdio transport by default
- configured with `VRDEX_API_BASE_URL`
- configured with `VRDEX_API_TOKEN` or a local OAuth token file
- no website scraping
- no raw VRChat credential dependency

## API Surface Plan

### API-0: Anonymous Public Reads

Purpose:

- give public clients and agents stable read endpoints before any write surface exists

Candidate endpoints:

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
- `GET /api/v0/events/:slug`
- `GET /api/v0/events/upcoming`
- `GET /api/v0/people/:slug/events`
- `GET /api/v0/communities/:slug/events`
- `GET /api/v0/claims/:slug/status`

Acceptance criteria:

- every response has a documented schema
- not-found, private, opted-out, and suppressed records collapse to a public-safe absence unless a route deliberately exposes a safer status
- examples include trust/provenance labels when data may be mistaken as owner-confirmed
- public pages, API responses, and MCP tools use the same local-time event presentation rules where applicable

### API-1: Authenticated Reads

Purpose:

- let users and trusted apps read scoped account-owned or partner-approved data without creating write risk

Candidate endpoints:

- `GET /api/v0/me`
- `GET /api/v0/me/profiles`
- `GET /api/v0/me/communities`
- `GET /api/v0/me/events`
- `GET /api/v0/developer/tokens`
- `GET /api/v0/developer/oauth-apps`
- `GET /api/v0/usage/rate-limit`

Acceptance criteria:

- API tokens and OAuth access tokens both work through a shared credential validation layer
- responses are scoped by user/app authority
- authenticated reads do not leak unrelated private profile, claim, or moderation state

### API-2: Narrow Authenticated Writes

Purpose:

- support the first useful external automation without making claims, moderation, or ownership unsafe

Candidate endpoints:

- `POST /api/v0/developer/tokens`
- `DELETE /api/v0/developer/tokens/:tokenId`
- `POST /api/v0/developer/oauth-apps`
- `PATCH /api/v0/developer/oauth-apps/:clientId`
- `POST /api/v0/developer/oauth-apps/:clientId/secrets`
- `POST /api/v0/events`
- `PATCH /api/v0/events/:slug`
- `POST /api/v0/events/:id/assets/upload-intent`
- `PATCH /api/v0/profiles/:slug`
- `POST /api/v0/profiles/:slug/assets/upload-intent`

Acceptance criteria:

- every write has scope, permission, audit, abuse, and rollback behavior
- ownership or staff capability checks are explicit
- writes that affect public pages have validation and moderation hooks
- claim-level actions still require verified email and product-specific claim checks

Implementation checkpoint:

- `PATCH /api/v0/profiles/:slug` now updates claimed-owner profile metadata for
  active owners with `profile:write`, refreshes search/vocabulary projections,
  and writes a profile audit event. Slug changes, claims, publication state,
  field visibility, outbound links, media-kit assets, and page-builder settings
  remain out of this checkpoint.
- `POST /api/v0/profiles/:slug/assets/upload-intent` now creates one-time
  profile media upload intents for active claimed-profile owners with
  `assets:write`. Completed uploads are consumed into active public profile
  assets and optional media-kit placements through the existing upload-token
  transport.
- `POST /api/v0/profile-assets/upload-intents/:intentId` is now described in
  the generated OpenAPI contract as the one-time upload-token transport that
  completes direct file uploads or source imports.
- `POST /api/v0/events/:id/assets/upload-intent` remains deferred until event
  asset storage and placement semantics exist; the profile media-kit path uses
  existing storage primitives and does not invent an event asset model.

## Auth Platform

### Data Model

Candidate Convex tables:

- `apiTokens`
- `apiTokenEvents`
- `oauthApplications`
- `oauthApplicationRedirectUris`
- `oauthApplicationSecrets`
- `oauthDynamicClientRegistrations`
- `oauthAuthorizations`
- `oauthAccessTokens`
- `oauthRefreshTokens`
- `oauthConsents`
- `oauthAuthorizationCodes`
- `oauthClientEvents`
- `apiRateLimitEvents`

API token fields:

- internal token id
- token prefix for display and lookup
- hashed token verifier
- owner user id
- optional owner community id
- label
- scopes
- status
- expiry
- created at
- last used at
- last used route class
- revoke reason

OAuth application fields:

- client id
- hashed current secret for confidential clients
- client type: public or confidential
- app owner: user or community
- display name
- description
- logo URL
- docs URL
- privacy URL
- terms URL
- redirect URIs
- allowed grants
- allowed scopes
- status
- created at
- reviewed at, if trusted-partner status is later added

Dynamic MCP client registration fields:

- client id
- registration access token hash, if supported
- client name
- client URI
- logo URI
- redirect URIs
- grant types
- response types
- token endpoint auth method
- contacts
- software id/version, if supplied
- allowed scopes
- status
- created at
- last used at
- promoted app id, if manually reviewed later

OAuth grant fields:

- authorization code hash
- PKCE challenge and method
- redirect URI
- user id
- client id
- requested scopes
- approved scopes
- resource indicator
- expiry
- consumed at

Token event fields:

- credential id
- user id, if user-bound
- client id, if OAuth-bound
- route class
- scope result
- rate-limit result
- status code class
- timestamp

Do not store raw bearer tokens, raw client secrets, or full Authorization headers.

### API Token Flow

User flow:

1. User opens account developer settings.
2. User creates a token with label, scopes, and optional expiry.
3. VRDex displays the token value once.
4. User copies it into a script, CI secret, or local MCP config.
5. API requests use `Authorization: Bearer <token>`.
6. User can see last-used metadata and revoke the token.

Implementation requirements:

- generate high-entropy opaque token values
- include a recognizable prefix such as `vrdx_`
- hash the verifier portion before storage
- support immediate revocation
- reject query-string token usage
- add scope checks before data access
- update last-used metadata without logging secrets

### OAuth App Registration

User flow:

1. Developer creates an OAuth app.
2. Developer chooses public or confidential client type.
3. Developer registers exact redirect URIs.
4. VRDex issues a client id.
5. Confidential clients can mint and rotate client secrets.
6. Developers can revoke the app or rotate secrets without deleting usage history.

Implementation requirements:

- exact redirect URI matching
- HTTPS redirect URIs except localhost loopback development redirects
- public clients require PKCE
- confidential clients store hashed secrets only
- app ownership supports user-owned apps and owner-managed community apps
- community-owned staff/admin delegation is deferred until broader community
  authority is stable enough
- reviewed/trusted partner status is a manual operator decision with explicit
  contact ownership, quota class, monitoring, and revocation

Issuer placement:

- Next.js route handlers own the OAuth HTTP surface.
- Convex stores applications, grants, consents, tokens, rotation state, revocation state, and audit events.
- Next route handlers call Convex queries/mutations/actions for durable state changes.
- Convex Auth continues to authenticate the signed-in VRDex account during authorization and consent.
- A separate OAuth service is deferred until scale, compliance, or cross-app reuse justifies the operational cost.

Rationale:

- OAuth has browser-facing redirects, consent screens, metadata endpoints, token responses, CORS, cookies, and HTTP error semantics that are natural in the web app.
- Convex is still the best place for transactional application state, ownership policy, and audit records.
- A dedicated service would add deployment and self-hosting surface before the product has proven it needs that boundary.

### OAuth User-Delegated Flow

Required grant:

- Authorization Code with PKCE

Required endpoints:

- `GET /.well-known/oauth-authorization-server`
- `GET /oauth/authorize`
- `POST /oauth/token`
- `POST /oauth/revoke`
- `GET /oauth/jwks.json`, if JWT access tokens are used

Candidate optional endpoints:

- `POST /oauth/introspect`, if trusted partners, self-hosted components, or future opaque-token use cases need resource-server lookup
- `POST /oauth/register`, for constrained MCP Dynamic Client Registration if required for major client compatibility
- Client ID Metadata Document publication for MCP clients that support CIMD instead of Dynamic Client Registration

Behavior:

- consent screen shows app name, owner, scopes, redirect host, and resource
- auth codes are single-use and short-lived
- access tokens are short-lived
- refresh tokens rotate
- scope downgrades are supported
- revocation removes refresh tokens and invalidates outstanding access tokens where practical

Token format:

- OAuth access tokens are short-lived JWTs following the OAuth JWT access token profile.
- Required claims include issuer, subject or application subject, audience/resource, client id, scope, issued-at, expiry, and token id.
- Resource servers validate issuer, audience/resource, expiry, signature, scopes, and revoked token ids where needed.
- OAuth refresh tokens remain opaque, hashed, rotated, and stored server-side.
- Personal API tokens remain opaque and hashed; they are not JWTs.

### OAuth Application Flow

Required grant:

- Client Credentials

Behavior:

- no user identity is implied
- allowed scopes are constrained by app status
- first version should usually allow public reads and maybe partner-approved ingestion or export scopes only after review
- rate limits bind to client id and owner

### Dynamic Client Registration For MCP

Purpose:

- make hosted MCP OAuth work with major MCP clients that cannot rely on a preconfigured VRDex client id

Current recommendation:

- include `POST /oauth/register` for hosted MCP clients in the first MCP OAuth implementation
- test Client ID Metadata Document compatibility before external hosted MCP readiness, especially for clients that support CIMD as an alternative to Dynamic Client Registration
- restrict dynamically registered clients to public-client behavior until manually reviewed
- allow only exact redirect URIs and localhost loopback development redirects
- allow only MCP resource access and the initial public/read-oriented scopes
- rate-limit registrations by IP, software metadata, and redirect host
- expose dynamic clients separately from manually created normal developer apps in admin/ops views
- allow manual promotion from dynamic MCP client to reviewed developer app later

Implementation checkpoint:

- `/oauth/register` stores dynamic MCP clients in a separate Convex table from
  user- and community-owned OAuth applications.
- registration is public-client-only and returns no client secret.
- `/oauth/authorize` supports Authorization Code with PKCE using
  `code_challenge_method=S256` for public apps, confidential apps, and dynamic
  MCP clients.
- `/oauth/token` exchanges authorization codes for short-lived resource-bound
  JWT access tokens and rotating opaque refresh tokens. Confidential apps must
  authenticate with an active client secret during code exchange and refresh;
  dynamic MCP clients remain public/no-secret clients.

### Scopes

Candidate initial scopes:

- `public:read`
- `profile:read`
- `profile:write`
- `community:read`
- `community:write`
- `events:read`
- `events:write`
- `assets:read`
- `assets:write`
- `developer:read`
- `developer:write`
- `mcp:read`
- `mcp:write`

Scope rules:

- public data still obeys public visibility and suppression rules
- write scopes are necessary but never sufficient
- ownership, staff capability, verified-email state, and object-level policy still run after scope validation
- app-only scopes cannot perform user-owned actions unless an explicit product grant exists

## Rate Limiting And Abuse Controls

### Rate Limit Dimensions

Use layered identity keys:

- route class
- IP address
- bearer token id
- OAuth client id
- user id
- app owner id
- dynamic MCP client id
- self-hosted deployment id, if introduced later

Route classes:

- anonymous public reads
- authenticated public reads
- developer token/app management
- OAuth authorize/token/revoke
- asset upload intent creation
- public writes
- anonymous MCP public read tool calls
- authenticated MCP tool calls

Backend choice:

- the backend is the storage/execution path for hot per-window request counters,
  not the source of quota policy or durable audit history
- high-volume hosted anonymous API and hosted MCP counters should use a Redis-compatible TTL counter store
- Convex should store quota policy, token/app ownership, trusted partner overrides, coarse usage summaries, and durable audit events
- local development can use an in-memory adapter
- self-hosted production should document a Redis-compatible option, with Convex-only counters allowed only for low-traffic deployments that accept the cost and write-load tradeoff

Why this is a separate question:

- anonymous public reads can create high-cardinality counters keyed by IP, route class, and window
- those counters expire quickly and do not need to be part of the core product database
- Redis-style increment-plus-expiry counters are a standard fit for public API
  rate limiting because the data is intentionally short-lived
- trusted app/token policy and audit data are durable business records and do belong in Convex
- separating hot TTL counters from durable policy avoids turning every anonymous search/MCP request into a Convex write

Recommended response behavior:

- include rate-limit headers on public API responses once the header shape is chosen
- use `Retry-After` for blocked requests
- do not reveal whether a suppressed private record exists while explaining rate-limit state
- log enough metadata to debug abuse without retaining secrets

Quota values:

- `Interview later`: choose real numbers after API endpoint shape and hosting cost are clearer
- `Current recommendation`: document placeholder classes before implementation, then set conservative defaults in code
- `Current recommendation`: trusted partners should have very high practical
  quotas compared with normal personal tokens, high enough that normal partner
  workloads do not feel personal-token caps
- `Current recommendation`: trusted partner access is not literally unmetered;
  it remains controlled by manual review, contact ownership, monitoring, cost
  guardrails, and fast revocation instead of a self-serve automatic upgrade

### Abuse Rules

- repeated invalid-token usage should produce credential events and eventually temporary blocks
- high-cardinality anonymous search should have stricter limits than direct profile lookup
- token creation and OAuth app creation need lower write limits than normal public reads
- dynamic MCP client registration needs stricter limits than anonymous read tools
- suspicious OAuth redirect changes should require app-owner action and audit history
- revoked, expired, or scope-insufficient credentials should fail before data access

## OpenAPI And Swagger Docs

### Documentation Surfaces

Required surfaces:

- checked-in OpenAPI description
- generated JSON at a public route
- Swagger UI page in developer docs or the web app
- Docusaurus developer guide with task examples
- API changelog

Candidate paths:

- `packages/api-contracts/src/schemas.ts`
- `packages/api-contracts/src/openapi.ts`
- `docs/api/openapi.yaml`
- `apps/web/src/app/api/v0/openapi.json/route.ts`
- `apps/web/src/app/developers/api/page.tsx`
- `docs/developers/public-api.md`
- `docs/developers/api-auth.md`
- `docs/developers/api-rate-limits.md`
- `docs/developers/mcp.md`

### Spec Rules

- generate the OpenAPI document from shared API contract schemas
- keep the generated artifact on OpenAPI 3.1.x until the selected generator and Swagger tooling have stable 3.2.0 support
- describe request and response schemas for every public route
- document auth requirements per operation
- document rate-limit behavior per route class
- include public-safe not-found behavior
- include trust/provenance fields in examples
- keep example payloads short and realistic
- validate the spec in CI
- smoke-test the Swagger UI route visually when UI changes are made

### Source Of Truth

`Current recommendation`: make shared TypeScript API contract schemas the source of truth for the external contract. Generate OpenAPI from those schemas and make route handlers validate requests and representative responses against the same contract layer.

Convex validators remain the database and Convex function boundary. The API contract layer should sit at the public HTTP boundary and translate Convex return values into public response shapes.

Candidate toolchain:

- Zod 4 schemas for public API request/response contracts
- `zod-openapi` for OpenAPI 3.1.x document generation
- generated `openapi.json` and `openapi.yaml` checked in or generated in CI, with a drift check
- route tests that validate representative payloads against the shared schemas
- type exports that can be reused by the MCP package

Implementation checkpoint:

- do a short spike before the full implementation PR to prove the chosen generator handles unions, branded IDs, nullable fields, examples, and response variants cleanly
- if Zod/OpenAPI generation creates awkward schema output, choose the next simplest schema-first toolchain rather than falling back to hand-written OpenAPI

## MCP Platform

### Hosted Public MCP

Transport:

- Streamable HTTP

Candidate endpoint:

- `/mcp`

Current checkpoint:

- implemented in the web app with `@modelcontextprotocol/server`
- anonymous public read tools are served through the `anonymous_mcp_public_read` rate-limit class
- OAuth access tokens issued for the MCP resource are accepted for the authenticated MCP rate-limit class
- OAuth protected-resource metadata exists; non-public OAuth-protected MCP tools remain a later checkpoint

Required metadata:

- OAuth protected resource metadata
- authorization server metadata
- resource indicator support in authorization and token requests

Auth behavior:

- anonymous read tools are required for public-safe search/browser-like read operations
- anonymous read tools must not trigger OAuth or client registration prompts
- anonymous MCP callers use separate route classes and quotas from anonymous HTTP API callers
- authenticated tools require `Authorization: Bearer <access-token>`
- MCP tokens must be issued for the VRDex MCP resource
- do not accept tokens issued for the plain web app, another MCP, or another resource
- return `WWW-Authenticate` with protected resource metadata when auth is required
- support constrained Dynamic Client Registration if required by major MCP clients

Day-one client compatibility:

- support Streamable HTTP for hosted MCP
- support stdio for private/local MCP
- maintain an implementation-time compatibility matrix for the major MCP clients available then, including Claude Desktop, Claude Code, VS Code/Copilot surfaces, Cursor, OpenAI/ChatGPT MCP-capable surfaces, Devin/Windsurf, and MCP Inspector unless the current ecosystem has shifted
- test anonymous hosted read tools, OAuth hosted tools, and local stdio token configuration separately
- do not declare hosted MCP ready until the matrix covers the mainstream clients VRDex users and partner agents are likely to use

First hosted tools:

- `vrdex_search`
- `vrdex_get_profile`
- `vrdex_get_event`
- `vrdex_list_upcoming_events`
- `vrdex_get_world`
- `vrdex_list_active_worlds`

Later hosted tools:

- `vrdex_my_profiles`
- `vrdex_my_events`
- `vrdex_event_create`
- `vrdex_event_update`
- `vrdex_profile_update`
- `vrdex_asset_upload_intent_create`

Safety rules:

- tool outputs are compact by default
- outputs include stable IDs/slugs for follow-up
- provenance is included when needed to avoid false authority
- no private owner account fields
- no moderation-only notes
- no write tool without scope, product permission, audit, and human-approval-friendly design

### Private Or Local MCP

Package candidate:

- `@basicbit/vrdex-mcp`

Current checkpoint:

- implemented as the `packages/vrdex-mcp` workspace package
- starts a stdio MCP server with the same six curated read tools as hosted MCP
- calls `/api/v0` public API routes and validates responses with
  `@vrdex/api-contracts`
- supports anonymous public reads, personal API tokens, OAuth access tokens, and
  OAuth token files
- normalizes hosted and self-hosted `VRDEX_API_BASE_URL` values to the `/api/v0`
  route prefix
- requires API-resource OAuth tokens because the stdio package calls `/api/v0`;
  hosted Streamable HTTP MCP continues to use MCP-resource OAuth tokens

Transports:

- stdio first
- Streamable HTTP client mode only if useful later

Configuration:

- `VRDEX_API_BASE_URL`
- `VRDEX_API_TOKEN`
- `VRDEX_OAUTH_ACCESS_TOKEN`
- `VRDEX_OAUTH_TOKEN_FILE`
- `VRDEX_MCP_OUTPUT_MODE`, optional compact/detail switch

Behavior:

- uses public API routes, not website scraping
- works against hosted VRDex and self-hosted deployments
- supports personal API tokens from the start
- supports OAuth access tokens directly or from local token files
- does not require private VRChat cookies

Distribution:

- publish local workspace package instructions in developer docs
- include MCP client configuration snippets
- keep install snippets free of real token values
- include self-hosted base URL examples
- add registry publishing instructions after the package is ready to ship
  outside the monorepo

### Private Hosted MCP For Self-Hosting

Self-hosted operators may want a deployment-private MCP endpoint for staff or community automation.

Current recommendation:

- use the same MCP server codepath
- use the deployment's own OAuth issuer and API tokens
- allow operators to disable public anonymous tools
- document environment variables and reverse-proxy requirements
- do not create a separate unaudited admin MCP surface

## Developer And Admin UX

### Developer Dashboard

Candidate routes:

- `/account/developers`
- `/account/developers/tokens`
- `/account/developers/apps`
- `/account/developers/apps/:clientId`
- `/account/developers/usage`

Required capabilities:

- create API token
- revoke API token
- inspect token last-used metadata
- create OAuth app
- edit OAuth app metadata
- manage redirect URIs
- rotate client secret
- revoke OAuth app
- view active user grants for owned apps

First ownership pass:

- user-owned developer apps
- community-owned developer apps for claimed community profiles managed by the active singleton owner
- staff/admin delegation for community-owned developer apps after broader community authority is stable enough
- dynamically registered MCP clients visible to admins/operators, not normal self-serve developer app management at first

UX rules:

- use crisp labels, not explanatory filler
- show token values only once
- show redirect URI validation errors inline
- keep scopes human-readable
- separate app ownership, app identity, and credential management
- show destructive actions with clear confirmation

### Consent Screen

Required display:

- app name
- app owner
- requested scopes
- redirect host
- whether the app is reviewed/trusted, if that concept exists
- what VRDex account is authorizing the request

Required actions:

- approve
- cancel
- scope downgrade if supported

### Admin And Operations

Required capabilities:

- inspect suspicious API clients
- revoke API tokens and OAuth apps
- suspend token creation for an abusive account
- view rate-limit events
- view OAuth app metadata history
- audit write actions performed through API or MCP

## Infrastructure And Self-Hosting

### Candidate Environment Variables

Public URLs:

- `VRDEX_PUBLIC_APP_URL`
- `VRDEX_PUBLIC_API_BASE_URL`
- `VRDEX_OAUTH_ISSUER_URL`
- `VRDEX_MCP_RESOURCE_URI`

Secrets and signing:

- `VRDEX_API_TOKEN_PEPPER`
- `VRDEX_OAUTH_ACCESS_TOKEN_SIGNING_KEY`, if JWT access tokens are used
- `VRDEX_OAUTH_ACCESS_TOKEN_SIGNING_KID`, optional JWT key id
- `VRDEX_OAUTH_REFRESH_TOKEN_PEPPER`
- `VRDEX_OAUTH_CLIENT_SECRET_PEPPER`

Rate limiting:

- `VRDEX_RATE_LIMIT_STORE`, currently `memory`, `redis-rest`, `upstash`, or `disabled`
- `VRDEX_RATE_LIMIT_REDIS_REST_URL`, if a Redis-compatible REST adapter is selected
- `VRDEX_RATE_LIMIT_REDIS_REST_TOKEN`, if a Redis-compatible REST adapter is selected
- `VRDEX_RATE_LIMIT_REDIS_URL`, if a direct Redis adapter is added later
- `VRDEX_RATE_LIMIT_REDIS_PREFIX`, if shared Redis infrastructure is used

Feature flags:

- `VRDEX_PUBLIC_API_ENABLED`
- `VRDEX_DEVELOPER_DASHBOARD_ENABLED`
- `VRDEX_HOSTED_MCP_ENABLED`
- `VRDEX_OAUTH_DYNAMIC_CLIENT_REGISTRATION_ENABLED`

Docs:

- each variable needs owner, scope, default, hosted value source, self-hosted setup path, and rotation notes where applicable

### Deployment Requirements

- HTTPS for production OAuth and MCP endpoints
- loopback redirect support for local OAuth clients
- documented Convex environment variables
- checked-in route and environment inventory
- no dashboard-only required variables without docs
- self-hosted base URL examples in API, Swagger, and MCP docs

### Security Requirements

- reject bearer tokens in query strings
- exact-match OAuth redirect URIs
- PKCE for public clients
- HTTPS for production OAuth endpoints
- audience/resource validation for OAuth access tokens
- refresh-token rotation
- token revocation
- client-secret rotation
- least-privilege scopes
- object-level authorization after scope validation
- audit logs for write actions
- secret redaction in logs
- CORS rules for public API routes
- CSRF protection for browser-based OAuth and developer dashboard actions

## Observability

Required signals:

- API request counts by route class
- rate-limit blocks by route class and identity type
- OAuth grant success/failure counts
- token validation failures
- MCP tool invocation counts
- write action audit trails
- revoked credential usage attempts

Do not log:

- bearer token values
- OAuth client secrets
- full authorization headers
- private profile fields returned only to authorized users

## Delivery Plan For One PR

### Slice 1: Contracts And Route Helpers

Deliverables:

- shared API contract schema package or module
- shared public API response helpers
- auth error helpers
- public-safe not-found helper
- scope and route-class definitions
- generated OpenAPI skeleton
- docs links from existing public API and MCP pages

Validation:

- unit tests for response helpers and scope parsing
- OpenAPI lint or schema validation
- generated OpenAPI drift check
- `git diff --check`

### Slice 2: Anonymous Public Reads And Swagger

Deliverables:

- public read endpoints for profiles, search, events, worlds, and claim status
- OpenAPI operation definitions generated from shared contract schemas
- Swagger UI route/page
- public API examples

Validation:

- route integration tests
- schema/example validation
- visual screenshot review for Swagger/developer docs UI

### Slice 3: API Tokens

Deliverables:

- `apiTokens` storage
- token mint/revoke routes
- developer dashboard token UI
- bearer token validation
- route-class rate-limit hook
- token docs

Validation:

- token generation/hash/revocation tests
- E2E token mint and API call
- query-string token rejection test
- visual review for token UI

### Slice 4: OAuth Apps And Grants

Deliverables:

- Next.js OAuth route handlers backed by Convex state
- OAuth app registration UI
- Authorization Code with PKCE
- Client Credentials
- constrained Dynamic Client Registration for hosted MCP if required by compatibility testing
- token, revoke, and metadata endpoints
- consent screen
- OAuth docs

Validation:

- PKCE tests
- redirect URI tests
- consent flow E2E with test client
- token audience/resource tests
- revocation tests
- dynamic MCP client registration tests if enabled

### Slice 5: Hosted MCP

Deliverables:

- Streamable HTTP MCP endpoint
- MCP resource metadata
- read-only curated tools
- anonymous public read tool access
- OAuth-protected tool path
- major MCP client compatibility matrix
- MCP docs

Validation:

- MCP handshake tests
- tool contract tests
- anonymous public read tool tests
- invalid audience/resource test
- auth-required `WWW-Authenticate` test
- compatibility smoke tests for major hosted MCP clients available at implementation time

### Slice 6: Private/Local MCP Package

Deliverables:

- `@basicbit/vrdex-mcp` package or workspace
- stdio transport
- API token config
- hosted and self-hosted base URL config
- MCP client install snippets

Validation:

- package smoke test
- local stdio tool call test
- self-hosted base URL fixture test

Implementation checkpoint:

- `packages/vrdex-mcp` now provides the stdio workspace package
- package tests cover config loading, API route calls with bearer credentials,
  self-hosted base URL normalization, and a JSON-RPC stdio `vrdex_search` call
  against a local API fixture

### Slice 7: Rate Limits, Audit, And Operations

Deliverables:

- configured default rate-limit classes
- Redis-compatible TTL counter adapter for hosted high-volume anonymous API/MCP traffic
- in-memory adapter for local development
- usage metadata
- credential event logs
- operational admin views or scripts
- docs for quota classes and escalation

Validation:

- rate-limit tests by identity type
- revoked token usage event test
- Redis adapter TTL/window tests
- admin/ops docs review

Implementation checkpoint:

- default route-class policies are exported from the web rate-limit helper
- `pnpm ops:api-rate-limits` prints the default policy table for operators
- Redis REST fixed-window counter behavior is covered by direct TTL/window tests
- revoked API-token validation maps to a rejected usage-event metadata shape in
  backend tests
- `docs/developers/api-rate-limits.md` documents store modes, current default
  quotas, response headers, credential events, and trusted-partner escalation

### Slice 8: Final Docs And Rollout

Deliverables:

- public API guide
- auth guide
- rate-limit guide
- OAuth app guide
- MCP guide
- self-hosted environment inventory
- changelog entry
- issue/PR checklist

Validation:

- docs build
- docs link check if available
- visual screenshot evidence for any changed UI
- all lint/type/test jobs required by repo merge policy

Implementation checkpoint:

- final developer docs now include API auth, OAuth apps, rate limits, MCP read
  tools, an MCP client compatibility matrix, an API/MCP changelog, and a
  rollout checklist
- self-hosting docs include the current API, OAuth, hosted MCP, rate-limit, and
  local stdio MCP environment inventory

## Suggested Issue Slices

If this epic is split before implementation, keep the issue count small:

1. Public API contracts, OpenAPI, and Swagger docs.
2. API token auth, developer token UI, and Redis-compatible rate limits.
3. OAuth app registry, Next.js-backed issuer routes, Authorization Code with PKCE, Client Credentials, and metadata endpoints.
4. Hosted VRDex MCP with anonymous public reads, OAuth, Dynamic Client Registration if needed, and read-only curated tools.
5. Private/local `@basicbit/vrdex-mcp` package with token and OAuth configuration.
6. Developer docs, self-hosting docs, observability, and rollout checks.

For a single PR, these become commit-level checkpoints instead of separate merge units.

## Verification Matrix

Required before PR readiness:

- lint
- typecheck
- unit tests for token, OAuth, scope, rate-limit, and schema helpers
- route integration tests for anonymous and authenticated API requests
- OpenAPI validation
- Swagger UI smoke test
- API token E2E
- OAuth test-client E2E
- hosted MCP handshake/tool tests
- stdio MCP smoke test
- major MCP client compatibility matrix results
- docs build
- visual verification for developer dashboard, consent screen, and Swagger docs

Security-specific tests:

- revoked token is rejected
- expired token is rejected
- missing scope is rejected
- invalid OAuth audience/resource is rejected
- redirect URI mismatch is rejected
- PKCE verifier mismatch is rejected
- bearer token in query string is rejected
- private/suppressed record reads return public-safe absence
- rate-limited requests do not leak object existence

## Documentation Updates Required With Implementation

- `docs/developers/public-api.md`
- `docs/developers/vrdex-mcp-read-tools.md`
- `docs/developers/self-hosting-and-iac.md`
- `docs/deployment/convex-environments.md`
- Docusaurus API reference pages
- OpenAPI description
- MCP install/config guide
- environment variable inventory
- changelog or release note

## Source Trail

- [MCP Authorization](https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization)
- [MCP Transports](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports)
- [MCP remote server guide](https://modelcontextprotocol.io/docs/develop/connect-remote-servers)
- [MCP Inspector](https://modelcontextprotocol.io/docs/tools/inspector)
- [Claude Code MCP docs](https://docs.anthropic.com/en/docs/claude-code/mcp)
- [VS Code MCP servers](https://code.visualstudio.com/docs/agent-customization/mcp-servers)
- [Devin Desktop / Windsurf Cascade MCP](https://docs.devin.ai/desktop/cascade/mcp)
- [OpenAI MCP and Connectors](https://platform.openai.com/docs/mcp)
- [OpenAPI Specification](https://spec.openapis.org/oas/latest.html)
- [Zod 4 JSON Schema conversion](https://zod.dev/v4)
- [zod-openapi](https://github.com/samchungy/zod-openapi)
- [Convex HTTP actions and server APIs](https://docs.convex.dev/api/modules/server)
- [Convex function auth](https://docs.convex.dev/auth/functions-auth)
- [Convex Auth](https://github.com/get-convex/convex-auth)
- [OAuth 2.1 draft](https://datatracker.ietf.org/doc/html/draft-ietf-oauth-v2-1)
- [RFC 9700: Best Current Practice for OAuth 2.0 Security](https://www.rfc-editor.org/rfc/rfc9700.html)
- [RFC 8414: OAuth 2.0 Authorization Server Metadata](https://datatracker.ietf.org/doc/html/rfc8414)
- [RFC 7591: OAuth 2.0 Dynamic Client Registration Protocol](https://datatracker.ietf.org/doc/html/rfc7591)
- [RFC 9728: OAuth 2.0 Protected Resource Metadata](https://datatracker.ietf.org/doc/html/rfc9728)
- [RFC 8707: Resource Indicators for OAuth 2.0](https://datatracker.ietf.org/doc/html/rfc8707)
- [RFC 9068: JSON Web Token Profile for OAuth 2.0 Access Tokens](https://datatracker.ietf.org/doc/html/rfc9068)
- [RFC 7009: OAuth 2.0 Token Revocation](https://datatracker.ietf.org/doc/html/rfc7009)
- [RFC 7662: OAuth 2.0 Token Introspection](https://datatracker.ietf.org/doc/html/rfc7662)
- [RFC 6585: 429 Too Many Requests](https://www.rfc-editor.org/rfc/rfc6585.html)
- [RFC 9457: Problem Details for HTTP APIs](https://www.rfc-editor.org/rfc/rfc9457.html)
- [Redis rate limiter pattern](https://redis.io/docs/latest/commands/incr/)

## Follow-Up Decisions From Maintainer Review

- OpenAPI should be generated from shared schemas rather than hand-rolled.
- OAuth issuer placement is a technical design decision; current recommendation is Next.js route handlers backed by Convex state.
- OAuth access token format is a technical design decision; current recommendation is short-lived JWT access tokens plus opaque rotated refresh tokens.
- The rate-limit backend question means where high-cardinality request counters live. Current recommendation is Redis-compatible TTL counters for hosted anonymous/high-volume traffic, with Convex retaining durable policy and audit state.
- Hosted MCP should support anonymous public read tools from day one.
- Day-one MCP support should target every major MCP client available at implementation time through a compatibility matrix.
- First-pass developer apps support user-owned apps and owner-managed community-owned apps.
- Community-owned OAuth app staff/admin delegation should be considered after broader community authority is stable enough.
- Trusted partner access is manually reviewed and should have much higher practical quotas than normal personal tokens, while retaining monitoring, cost controls, and revocation.
- Rate-limit backend language refers to hot, expiring request counters rather than durable product state; Convex keeps durable ownership, policy, review, summary, and audit records.

## Remaining Open Research

- Track OpenAPI 3.2.0 generator and Swagger UI support. The current checked-in artifact stays on 3.1.x.
- Define OAuth signing-key rotation operations once deployment secret management is wired. The current checkpoint uses Node's built-in crypto APIs for RS256 JWT access tokens and advertises an explicit JWT key id when configured.
- Confirm the hosted rate-limit provider for production, such as Upstash, Vercel KV, Valkey, or another Redis-compatible store.
- Run the implementation-time major MCP client smoke matrix against a deployed preview or production-like environment, including anonymous hosted reads, OAuth through Dynamic Client Registration, OAuth through Client ID Metadata Documents where supported, and local stdio configuration.
- Choose final default quota numbers and partner escalation thresholds after initial traffic and operator cost signals exist.
