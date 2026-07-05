# OAuth Applications

## Status

Current implementation checkpoint for user-owned and owner-managed community
developer OAuth apps.

Normal developer apps are created from `/developers/apps` or
`POST /api/v0/developer/oauth-apps`. Choose a claimed community in the
dashboard, or supply `ownerCommunitySlug` to the API, to create an app owned by
a community profile actively owned by the current user.

## App Ownership

Current implementation:

- user-owned apps are supported
- community-owned apps are supported for active community owners
- staff/admin delegation for community-owned apps is deferred
- dynamic MCP clients are stored separately from normal developer apps
- trusted partner review is manual, not self-serve

OAuth app records include client identity, owner, redirect URIs, allowed grants,
allowed scopes, status, trust tier, and lifecycle timestamps.

Omit `ownerCommunitySlug` when creating a user-owned app. Include
`ownerCommunitySlug` to create an app owned by that community. Only claimed
community profiles can own OAuth apps, and only the active singleton community
owner can create, update, rotate secrets for, or revoke the app in this first
pass.

Use `PATCH /api/v0/developer/oauth-apps/:clientId` to update app metadata,
redirect URIs, allowed grants, and allowed scopes. Client type is immutable;
create a replacement app when moving between public and confidential clients.

## Client Types

| Client type | Current use |
| --- | --- |
| Public | Authorization Code with PKCE and refresh-token rotation. |
| Confidential | Authorization Code with PKCE, refresh-token rotation, Client Credentials, and hashed client-secret validation. |

Public clients must use PKCE and do not have client secrets.

Confidential clients can receive a client secret at app creation and can create
additional secrets through
`POST /api/v0/developer/oauth-apps/:clientId/secrets`. Secret values are
displayed once. VRDex stores only the secret prefix and hash. Confidential
clients also use PKCE for authorization-code flow and must authenticate with an
active client secret when exchanging codes or rotating refresh tokens.

## Redirect URIs

Redirect URI rules:

- exact match only
- HTTPS required for production redirects
- localhost loopback redirects are allowed for local development
- redirect changes should be treated as security-sensitive app edits

## Scopes

Current public platform scopes include:

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

Most current public-read integrations should request only `public:read` or
`mcp:read`.

## Current Flows

Authorization Code with PKCE:

1. Developer registers a public or confidential app and exact redirect URI.
2. Client sends the user to `GET /oauth/authorize`.
3. User approves the consent screen.
4. Client exchanges the code with `POST /oauth/token`.
5. Confidential clients authenticate with an active client secret during code
   exchange and refresh.
6. Client rotates refresh tokens through the `refresh_token` grant.

Client Credentials:

1. Developer registers a confidential app.
2. VRDex shows the client secret once.
3. Server-side client calls `POST /oauth/token`.
4. VRDex issues a short-lived resource-bound access token.

## Dynamic MCP Clients

Dynamic MCP Client Registration is available at `POST /oauth/register` for
hosted MCP clients that cannot rely on a preconfigured VRDex client id.

Dynamic clients are not normal self-serve developer apps. They are stored in a
separate table and can be reviewed or promoted later if an operator decides
that is appropriate.

Client ID Metadata Documents are tracked as a hosted MCP compatibility path for
clients that prefer preconfigured metadata over Dynamic Client Registration.
They do not change the self-serve ownership model: normal developer apps are
user-owned or owned by communities the current user actively owns, while dynamic
MCP clients stay separate.

## Trusted Partner Review

Trusted partner access is a manual operator process.

Before raising quotas or trust tier, confirm:

- accountable owner and contact path
- intended data surfaces and traffic shape
- whether the app is user-delegated, application-owned, or both
- monitoring and abuse response path
- revocation plan

Trusted partner status should never bypass public visibility, opt-out,
suppression, provenance, or object-level authorization rules.
