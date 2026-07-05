# API And MCP Changelog

## Status

Changelog for the unstable `/api/v0` and MCP platform foundation.

`v0` is allowed to change before public launch. Breaking changes still need a
docs update and a changelog entry so early consumers and agents can adapt.

## 2026-07-04

Public API and MCP platform foundation checkpoint:

- added shared `@vrdex/api-contracts` schemas for public API responses and
  generated OpenAPI output
- added anonymous `/api/v0` public read routes for search, profiles, events,
  worlds, profile assets, and claim status
- added generated OpenAPI JSON at `/api/v0/openapi.json` and a web API
  reference page at `/developers/api`
- added personal API token creation, listing, revocation, hashed validation,
  and developer token UI
- added user-owned OAuth application registration, confidential client secrets,
  and app listing UI
- added OAuth metadata, JWKS, token, revoke, constrained dynamic MCP
  registration, Authorization Code with PKCE, refresh-token rotation, and
  Client Credentials support
- added hosted Streamable HTTP MCP at `/mcp` with anonymous public read tools
  and OAuth-authenticated MCP bearer handling
- added local stdio MCP workspace package `@basicbit/vrdex-mcp`
- added default API/MCP rate-limit classes with memory and Redis REST store
  modes
- added `GET /api/v0/usage/rate-limit` for route-class quota policy and caller
  window introspection
- added `GET /api/v0/me` for authenticated caller introspection
- added `GET /api/v0/me/profiles`, `GET /api/v0/me/communities`, and
  `GET /api/v0/me/events` for user-authorized profile, community, and
  community-managed event inventory
- added `GET /api/v0/developer/tokens` and
  `GET /api/v0/developer/oauth-apps` for `developer:read` user-owned
  credential metadata lists
- added `POST /api/v0/developer/tokens` for `developer:write` user-owned
  personal API token creation with one-time token value return
- added `POST /api/v0/developer/oauth-apps` for `developer:write` user-owned
  OAuth application creation with one-time confidential client secret return
- added `PATCH /api/v0/developer/oauth-apps/:clientId` for `developer:write`
  user-owned OAuth application metadata, redirect, grant, and scope updates
- added `POST /api/v0/developer/oauth-apps/:clientId/secrets` for
  `developer:write` confidential OAuth client secret creation with one-time
  secret return
- added `DELETE /api/v0/developer/tokens/:tokenId` and
  `DELETE /api/v0/developer/oauth-apps/:clientId` for `developer:write`
  user-owned credential revocation
- added developer docs for public API posture, auth, OAuth apps, rate limits,
  MCP tools, and rollout checks

Compatibility notes:

- API-resource OAuth tokens are required for `/api/v0`
- MCP-resource OAuth tokens are required for hosted `/mcp`
- local stdio MCP calls `/api/v0`, so it uses API-resource OAuth tokens
- bearer credentials in URL query parameters are rejected
- developer list routes require user authority; app-only OAuth tokens cannot
  enumerate a user's token or OAuth app inventory
- final quota numbers and trusted-partner escalation thresholds are still
  pre-launch decisions
