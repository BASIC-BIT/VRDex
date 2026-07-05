# API Authentication

## Status

Current implementation checkpoint for `/api/v0`, hosted MCP, and local stdio
MCP authentication.

Public read routes work anonymously by default. Bearer credentials are optional
for authenticated public-read limits and future scoped access. Bearer tokens
must be sent with the `Authorization` header and are rejected from URL query
parameters.

```http
Authorization: Bearer <token>
```

## Credential Types

| Credential | Current use |
| --- | --- |
| No bearer token | Anonymous public API and hosted MCP read tools. |
| Personal API token | Local scripts, private/local MCP, and authenticated public API reads. |
| OAuth access token | User-delegated and application-owned API/MCP access. |
| OAuth refresh token | Rotates user-delegated authorization-code sessions. |
| OAuth client secret | Confidential client authentication for token, refresh, and client-credentials requests. |

## Personal API Tokens

Signed-in developers create personal API tokens at `/developers/tokens`.

Token rules:

- token values are displayed once
- token values use the `vrdx_...` prefix format
- Convex stores token prefixes and verifier hashes, not raw token values
- tokens can be revoked immediately
- public API routes require `public:read` for current public-read access
- hosted MCP authenticated reads require `mcp:read`

Personal tokens are best for local automation and the local stdio MCP package:

```sh
VRDEX_API_TOKEN=<personal-api-token> pnpm --silent --dir <path-to-vrdex-checkout> exec tsx packages/vrdex-mcp/src/stdio.ts
```

## OAuth Access Tokens

OAuth access tokens are short-lived JWT bearer tokens. They are bound to:

- issuer
- audience/resource
- client id
- token id
- scope
- expiry

The API and MCP resources are intentionally distinct:

- `/api/v0` validates tokens issued for the API resource
- hosted `/mcp` validates tokens issued for the MCP resource
- local stdio MCP calls `/api/v0`, so it needs an API-resource token

The current implementation also checks Convex token state after verifying the
JWT signature and audience.

## OAuth Endpoints

| Endpoint | Purpose |
| --- | --- |
| `GET /.well-known/oauth-authorization-server` | OAuth issuer metadata. |
| `GET /.well-known/oauth-protected-resource` | MCP protected-resource metadata. |
| `GET /oauth/authorize` | Authorization Code with PKCE. |
| `POST /oauth/token` | `authorization_code`, `refresh_token`, and `client_credentials`. |
| `POST /oauth/revoke` | Access-token revocation. |
| `POST /oauth/register` | Constrained Dynamic Client Registration for hosted MCP clients. |
| `GET /oauth/jwks.json` | Public signing keys for JWT access tokens. |

Client ID Metadata Documents are a compatibility path to test for hosted MCP
clients that prefer preconfigured client metadata over Dynamic Client
Registration. DCR remains the first automatic registration path in this
checkpoint.

## Authorization Code With PKCE

Use this for user-delegated clients and hosted MCP clients that need user
approval.

Current constraints:

- public and confidential registered apps can use authorization-code exchange
- confidential apps must authenticate with an active client secret on code
  exchange and refresh
- dynamic MCP clients stay public/no-secret
- `code_challenge_method=S256`
- exact redirect URI matching
- single-use short-lived authorization codes
- rotating refresh tokens on every refresh
- scopes limited by registered client metadata

## Client Credentials

Use this for confidential server-to-server clients.

Current constraints:

- confidential OAuth app required
- client secret is shown once and then stored as a hash
- default scope fallback is `public:read`
- access tokens are still resource-bound
- there is no implicit user authority

## Current Caller Introspection

Use `GET /api/v0/me` with a personal API token or API-resource OAuth access
token to verify the credential class, owner/subject metadata, granted scopes,
trust tier, and current authenticated public-read rate-limit window. This route
does not list all of a user's tokens or OAuth apps.

## Current User Inventory

Use these endpoints for compact owner-scoped inventory:

| Endpoint | Required scope | Purpose |
| --- | --- | --- |
| `GET /api/v0/me/profiles` | `profile:read` | Owned person and community profile summaries. |
| `GET /api/v0/me/communities` | `community:read` | Owned community profile summaries. |
| `GET /api/v0/me/events` | `events:read` | Event summaries attached to owned community profiles. |

These routes require user authority. User-owned personal API tokens and
user-delegated API-resource OAuth access tokens qualify. Anonymous callers,
community-owned tokens, and OAuth client-credentials tokens do not.

## Current Profile Writes

Use `PATCH /api/v0/profiles/:slug` to update public metadata for a claimed
person or community profile owned by the current authenticated user.

Current constraints:

- requires `profile:write`
- requires user authority
- requires active ownership of the target profile
- requires claimed-owner field permission
- updates display name, aliases, tags, headline, bio, region, timezone, person
  pronouns and role tags, or community subtype and category tags
- clears optional text fields when they are sent as `null` or blank strings
- refreshes public search and vocabulary projections
- writes a profile audit event
- does not update slugs, claim state, publication state, field visibility,
  outbound links, media-kit assets, or page-builder settings in this checkpoint

## Current Profile Asset Uploads

Use `POST /api/v0/profiles/:slug/assets/upload-intent` to create a one-time
media-kit upload intent for a claimed person or community profile owned by the
current authenticated user.

Current constraints:

- requires `assets:write`
- requires user authority
- requires active ownership of the target profile
- requires a claimed profile
- accepts `originalFileName` for direct multipart uploads or `sourceUrl` for
  server-side imports
- accepts PNG, SVG, JPEG, and WebP image assets up to 12 MB
- returns `uploadUrl`, `uploadToken`, and `uploadTokenHeader`
- completes by posting the file or source import to `uploadUrl`, currently
  `POST /api/v0/profile-assets/upload-intents/:intentId`, with the returned
  `x-vrdex-upload-token` value
- does not accept bearer credentials on the upload transport
- consumes completed API-created intents into an active public profile asset
  with any supplied placement metadata
- uses the separate `asset_upload_intent` route class

## Current Event Writes

Use `POST /api/v0/events` to create a public event attached to a community
profile owned by the current authenticated user. Use
`PATCH /api/v0/events/:slug` to update an existing event attached to a community
profile owned by the current authenticated user.

Current constraints:

- requires `events:write`
- requires user authority
- requires `communitySlug`
- requires ownership of the target community profile
- update also requires ownership of the event's current community profile
- creates a published public event using the same sanitizers as the web event
  editor
- does not create or update standalone submitter-only events in this checkpoint

## Developer Resource Lists

Use `GET /api/v0/developer/tokens` and
`GET /api/v0/developer/oauth-apps` to list developer credential metadata for
the current user. Use `POST /api/v0/developer/tokens` to create a user-owned
personal API token and receive its raw value once. Use
`POST /api/v0/developer/oauth-apps` to create a user-owned OAuth application;
confidential clients receive their raw client secret value once. Use
`PATCH /api/v0/developer/oauth-apps/:clientId` to update app metadata,
redirects, allowed grants, and allowed scopes. Use
`POST /api/v0/developer/oauth-apps/:clientId/secrets` to create an additional
confidential-client secret and receive that raw secret once. Use
`DELETE /api/v0/developer/tokens/:tokenId` and
`DELETE /api/v0/developer/oauth-apps/:clientId` to revoke user-owned
developer credentials. List routes require `developer:read`; creation and
revocation routes require `developer:write`. All require a credential with user
authority:

- user-owned personal API tokens qualify
- user-delegated API-resource OAuth access tokens qualify
- OAuth client-credentials tokens do not imply user authority
- dynamic hosted MCP clients do not list user-owned developer resources

Raw personal token values and raw OAuth client secrets are never returned. OAuth
app revocation also revokes active client secrets for that app.

## Dynamic MCP Registration

`POST /oauth/register` exists for hosted MCP client compatibility. It does not
create normal developer apps.

Dynamic MCP clients are constrained to:

- public client metadata
- exact redirect URIs
- `authorization_code` grant metadata
- `code` response type metadata
- `token_endpoint_auth_method=none`
- MCP resource access
- `mcp:read` plus optional `public:read`

Before hosted MCP is declared externally ready, smoke both DCR and Client ID
Metadata Document OAuth paths in the major-client matrix where the current
client release supports both.

## Error Rules

- malformed, unknown, revoked, or expired bearer tokens return `401`
- missing scopes return `403`
- client-credentials tokens without user authority return `403` on developer
  list routes even when the app owner is known
- bearer tokens in URLs return `400`
- rate-limited requests return `429` with rate-limit headers
- failed auth must not reveal whether a private or suppressed object exists
