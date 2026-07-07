# API And MCP Changelog

## Status

Changelog for the unstable `/api/v0` and MCP platform foundation.

`v0` is allowed to change before public launch. Breaking changes still need a
docs update and a changelog entry so early consumers and agents can adapt.

## 2026-07-06

- added `GET /api/v0/worlds/:slug/events` with a shared
  `PublicWorldEventsResponse` contract for recent and upcoming public events
  linked to a published world
- added `pnpm ops:mcp-client-smokes` to generate the current day-one MCP
  client smoke run plan, including repo preflight commands, manual evidence
  prompts, and recorder command templates from the checked matrix
- added `pnpm record:mcp-client-smoke` to record sanitized manual MCP client
  smoke evidence into the checked compatibility matrix without hand-editing
  JSON
- added `pnpm smoke:mcp-claude-code` as a repeatable real-client Claude Code
  local stdio and hosted anonymous HTTP smoke
- extended `pnpm smoke:mcp-claude-code -- --mode hosted-http` with
  `--hosted-data` so Claude Code hosted anonymous-read readiness can require a
  non-empty data-backed public search
- added `pnpm smoke:mcp-inspector` as a repeatable hosted MCP Inspector CLI
  smoke for tool-list/auth-metadata coverage and optional data-backed public
  search readiness
- added `pnpm check:api-mcp-rollout` as an aggregate readiness audit for the
  generated OpenAPI artifact, required docs, verification scripts, MCP client
  matrix, and production-like hosted MCP evidence state
- added deterministic `/oauth/token` route-helper coverage for Authorization
  Code, refresh-token rotation, Client Credentials, and no-store OAuth errors
  before malformed exchanges reach Convex
- added `pnpm ops:mcp-installed-clients` to capture installed MCP client CLI
  version/configuration preflight evidence before manual day-one client smokes
- tightened MCP smoke result recording so required hosted rows need an explicit
  same-branch, staging, production-like, or production target before they can
  be marked as external-readiness pass evidence
- tightened MCP client matrix verification so hand-edited required hosted pass
  rows still need non-pending same-branch, staging, production-like, or
  production target evidence
- added `pnpm test:scripts` to exercise repo script regression tests from the
  MCP verification path
- improved hosted MCP data-backed smoke diagnostics so tool-error responses
  include sanitized error content instead of a generic failure
- returned non-empty public-safe hosted MCP tool errors when the public data
  backend is unavailable, without exposing backend exception text
- added `pnpm smoke:mcp-compat -- --hosted-only` for focused remote hosted MCP
  target checks without rerunning local stdio profile smokes
- added hosted MCP tool descriptor auth metadata so every curated public read
  tool advertises `_meta["securitySchemes"]` with `noauth` plus optional
  `oauth2`/`mcp:read`
- split hosted MCP smoke coverage so lightweight preview checks still cover
  transport, descriptors, OAuth metadata, and bearer challenges, while
  `--hosted-data` / `VRDEX_MCP_SMOKE_DATA` gates non-empty public reads against
  a same-branch or production-like Convex backend
- added `pnpm smoke:mcp-compat -- --continue-on-failure` and
  `VRDEX_MCP_SMOKE_CONTINUE_ON_FAILURE` so production-like hosted diagnostics
  can report data-backed read, DCR, and CIMD subcheck failures in one run while
  still exiting non-zero when any selected probe fails

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
  registration, Authorization Code with PKCE, refresh-token rotation,
  refresh-token revocation, and Client Credentials support
- added OAuth access-token signing-key rotation support for retaining previous
  public keys in JWKS and bearer verification until outstanding tokens expire
- added OAuth access-token validation event metadata for accepted and rejected
  API/MCP bearer checks
- added public-client Client ID Metadata Document support for hosted MCP OAuth
  clients that use URL-form client ids
- added confidential-client support for OAuth authorization-code and
  refresh-token exchange, requiring active client-secret authentication while
  keeping PKCE mandatory
- added hosted Streamable HTTP MCP at `/mcp` with anonymous public read tools
  and OAuth-authenticated MCP bearer handling
- added MCP protected-resource scope metadata and scope-aware
  `WWW-Authenticate` challenges for malformed, invalid, or insufficient OAuth
  bearer tokens
- added local stdio MCP workspace package `@basicbit/vrdex-mcp`
- added default API/MCP rate-limit classes with memory and Redis REST store
  modes
- added trusted-partner effective rate-limit policies for validated
  trusted-partner personal tokens and OAuth applications
- added a checked manual MCP client smoke-results artifact and verifier so
  day-one client compatibility evidence is explicit before external readiness
- added structured hosted MCP readiness evidence rows and a recorder command so
  data-backed anonymous reads, DCR, and CIMD proof are checked separately from
  client UI smoke rows
- added `GET /api/v0/usage/rate-limit` for route-class quota policy and caller
  window introspection
- added `GET /api/v0/me` for authenticated caller introspection
- added `GET /api/v0/me/profiles`, `GET /api/v0/me/communities`, and
  `GET /api/v0/me/events` for user-authorized profile, community, and
  community-managed event inventory
- added `PATCH /api/v0/profiles/:slug` for `profile:write` claimed-owner
  metadata updates against profiles owned by the current authenticated user
- added `POST /api/v0/profiles/:slug/assets/upload-intent` for `assets:write`
  one-time media-kit uploads against claimed profiles owned by the current
  authenticated user
- documented `POST /api/v0/profile-assets/upload-intents/:intentId` in the
  generated OpenAPI contract as the one-time upload-token transport for direct
  file uploads and server-side source imports
- documented `GET /api/v0/profiles/:slug/assets/:assetId/file` and
  `GET /api/v0/profiles/:slug/logos.zip` in the generated OpenAPI contract as
  binary download routes, and added route/OpenAPI parity checking to the
  contract drift check
- added `POST /api/v0/events` for `events:write` public event creation against
  community profiles owned by the current authenticated user
- added `PATCH /api/v0/events/:slug` for `events:write` public event updates
  against community-owned events managed by the current authenticated user
- added `GET /api/v0/developer/tokens` and
  `GET /api/v0/developer/oauth-apps` for `developer:read` user-owned
  credential metadata lists
- extended `GET /api/v0/developer/oauth-apps` to include OAuth apps owned by
  claimed community profiles the current authenticated user actively owns
- added `POST /api/v0/developer/tokens` for `developer:write` user-owned
  personal API token creation with one-time token value return
- added `POST /api/v0/developer/oauth-apps` for `developer:write` user-owned
  OAuth application creation with one-time confidential client secret return
- added `ownerCommunitySlug` to `POST /api/v0/developer/oauth-apps` for
  owner-only community OAuth application creation
- added claimed-community owner selection to `/developers/apps` so the
  dashboard can create and list community-owned OAuth apps
- added `PATCH /api/v0/developer/oauth-apps/:clientId` for `developer:write`
  user-owned and community-owned OAuth application metadata, redirect, grant,
  and scope updates
- added `POST /api/v0/developer/oauth-apps/:clientId/secrets` for
  `developer:write` user-owned and community-owned confidential OAuth client
  secret creation with one-time secret return
- added `DELETE /api/v0/developer/tokens/:tokenId` and
  `DELETE /api/v0/developer/oauth-apps/:clientId` for `developer:write`
  user-owned and community-owned credential revocation
- added developer docs for public API posture, auth, OAuth apps, rate limits,
  MCP tools, and rollout checks

Compatibility notes:

- API-resource OAuth tokens are required for `/api/v0`
- MCP-resource OAuth tokens are required for hosted `/mcp`
- local stdio MCP calls `/api/v0`, so it uses API-resource OAuth tokens
- bearer credentials in URL query parameters are rejected
- developer list routes require user authority; app-only OAuth tokens cannot
  enumerate a user's token or OAuth app inventory
- profile asset upload-intent creation uses the `asset_upload_intent`
  route-limit class, while the upload transport uses the one-time upload token
- final quota numbers and trusted-partner escalation thresholds remain
  pre-launch tuning decisions even though trusted-partner credentials now have a
  distinct effective quota tier
