# API And MCP Changelog

## Status

Changelog for the unstable `/api/v0` and MCP platform foundation.

`v0` is allowed to change before public launch. Breaking changes still need a
docs update and a changelog entry so early consumers and agents can adapt.

## 2026-07-09

- moved OAuth consent completion and authorization-code issuance behind one
  internal Convex mutation that atomically binds the authenticated user to the
  hashed transaction, revalidates the stored client, consumes the transaction,
  and issues a code only for explicit approval
- isolated OAuth API and MCP quotas by access-token id while retaining a
  secondary client-wide abuse cap, and made production rate limiting fail closed
  unless a shared Redis REST store is explicitly configured
- enforced an absolute Client ID Metadata Document deadline across DNS,
  connection, and response streaming, and cancel rejected or oversized response
  bodies so slow-drip and non-200 peers cannot retain sockets
- made Gemini CLI smoke timeouts terminate the complete process tree on Windows
  and POSIX, with deterministic failure handling and parent/grandchild regression
  coverage
- combined API-contract and MCP verification into one PR job with one dependency
  install, made hosted preview coverage fail closed without same-branch Convex,
  and moved strict external readiness plus client-session artifacts to a manual
  launch workflow that live-smokes its selected host and rejects checked-in
  evidence that does not name the same target and commit
- added `pnpm test:web` to the existing Typecheck Web baseline job and the
  aggregate local verifier so the API, OAuth, MCP, and rate-limit route tests
  under `tests/web` are enforced without creating another GitHub Actions job
- applied standard bearer-query rejection and anonymous public-read rate
  limiting to the profile asset storage probe, with route-level regression
  coverage and matching OpenAPI security/error responses
- documented the upload-intent completion route's optional
  `multipart/form-data` body from the shared OpenAPI source: direct uploads
  require a binary `file`, while `sourceUrl` imports omit the body

- moved server-only API-token validation plus OAuth Dynamic Client Registration,
  Client ID Metadata Document materialization, authorization-client resolution,
  token exchange/rotation, revocation, and durable access-token validation to
  internal Convex functions; Next.js invokes them with Convex admin
  authentication, including atomic consent completion and code issuance
- hardened OAuth consent with short-lived, hashed, user-bound, single-use
  server transactions; approval no longer trusts hidden authorization fields,
  and production consent POSTs require a same-origin `Origin`
- enforced the declared `oauth_authorize` and `oauth_token` quotas across
  authorize, consent, token, and revocation routes with OAuth-compatible `429`
  bodies and standard rate-limit headers
- replaced unconditional forwarding-header trust with Vercel's
  `X-Vercel-Forwarded-For` contract and an explicit self-host trusted-proxy
  header configuration that fails into a shared `unknown` bucket
- pinned Client ID Metadata Document HTTPS connections to the validated DNS
  address while preserving original-host SNI, certificate verification,
  response-size limits, and redirects-disabled behavior
- added hosted MCP `search` and `fetch` compatibility aliases for OpenAI
  Responses API, ChatGPT deep research, and company-knowledge-style connectors;
  the aliases reuse the same anonymous public search/profile/event/world read
  surfaces, return URL-backed structured document results, and are counted in
  MCP tool invocation telemetry
- tightened `pnpm smoke:mcp-openai` so it loads repo-root `.env.local` without
  printing secret values, avoids inline key guidance in generated smoke plans,
  fails bounded live Responses API requests with a clear timeout, and
  preflights hosted `/mcp` for `search`/`fetch` plus data-backed results before
  calling OpenAI
- changed the default `pnpm smoke:mcp-openai` live model to `gpt-5.6-luna`,
  the current cost-sensitive GPT-5.6 tier, after verifying that it calls the
  staged remote MCP `search` and `fetch` tools
- tightened `pnpm smoke:mcp-compat -- --hosted-data` so hosted data-backed
  evidence requires a non-empty `vrdex_search` result and an OpenAI-compatible
  `search` result that can be passed to `fetch`; added `--hosted-query` /
  `VRDEX_MCP_SMOKE_QUERY` for targets whose public seed data needs a known
  non-empty query
- tightened hosted MCP evidence recording and rollout validation so
  `hosted-data-backed-anonymous-read` cannot be marked `pass` unless the
  sanitized evidence mentions `vrdex_search`, `search`, and `fetch` coverage
  from the same hosted data-backed smoke
- refreshed the major-client MCP source check against current official VS Code,
  Claude Code, Cursor, and Devin Desktop / Windsurf Cascade docs and narrowed
  the next burn-down batch to installed-app VS Code, Cursor, and Windsurf
  evidence, with hosted OAuth rows still gated on credentials or product-surface
  access
- extended `pnpm ops:mcp-client-smokes` and
  `pnpm ops:mcp-client-session-pack` with `--hosted-query` /
  `VRDEX_MCP_SMOKE_QUERY` so generated real-client smoke commands can target a
  known non-empty public search fixture
- aligned generated MCP client evidence worksheets with the selected
  `--hosted-query` value and clarified the OpenAI / ChatGPT hosted OAuth
  recorder placeholder so those rows ask for both `search` and `fetch`
  evidence
- aligned `pnpm ops:mcp-installed-clients` and
  `pnpm ops:mcp-oauth-smoke-credentials` hosted smoke guidance with the same
  known-query flags for Claude Code, Gemini CLI, OpenAI Responses API, and MCP
  Inspector
- recorded interim hosted MCP target diagnostics before the later staging
  redeploy: the earlier staging target returned HTTP 404 for `/mcp` and public
  search, while the PR preview exposed `search`/`fetch` but failed
  backend-dependent data-backed reads, DCR, and public-client CIMD
  authorization
- extended the MCP client session pack so newly reopened Claude Code and MCP
  Inspector hosted-anonymous rows get generated evidence worksheets instead of
  failing the worksheet-coverage guard
- added generated `docs/api/openapi.yaml` alongside `docs/api/openapi.json`;
  both artifacts are emitted from the shared API contract package, served under
  `/api/v0/openapi.{json,yaml}`, and covered by `pnpm check:api-openapi` drift
  detection
- documented `GET /api/v0/profile-assets/upload-intents/probe` in the shared
  OpenAPI contract as the profile asset upload storage health probe

## 2026-07-08

- moved public API query parsing for search, event lists, active worlds,
  authenticated owner inventory, and developer credential lists into shared API
  contract helpers; the generated OpenAPI artifact now documents the actual
  route-specific `limit` caps for upcoming/community events and active worlds
- added `apiWriteAuditEvents` and `pnpm ops:api-platform-observability` so
  operators can summarize public API write actions, rate-limit blocks, token
  validation failures, OAuth grant outcomes, and MCP tool calls from durable
  Convex event rows without exposing bearer tokens, OAuth secrets, upload
  tokens, or raw IP addresses
- added aggregate route-class request counters to the hot rate-limit backend
  and `pnpm ops:api-rate-limit-counts` so operators can read current
  request-count signals from Redis without writing every API/MCP request to
  Convex
- added durable `apiRateLimitEvents` rows for blocked public API, hosted MCP,
  Dynamic Client Registration, and Client ID Metadata Document rate-limit
  attempts, recording route class and identity kind without storing raw IPs,
  credential ids, Redis keys, or bearer values
- added durable `mcpToolEvents` records for accepted hosted MCP `tools/call`
  invocations so anonymous and authenticated tool usage can be counted by
  curated tool name and route class without storing bearer tokens or raw IP
  addresses
- added `infra/terraform/rate-limit-redis` to provision the BASIC BIT hosted
  Upstash Redis rate-limit counter store and write the corresponding Vercel
  runtime variables for production/staging while leaving default PR previews
  on memory unless operators explicitly opt them into the shared store; the
  Terraform workflow now validates/plans the stack with manual apply, and the
  API/MCP rollout checker now requires the stack files, lockfile, and CI wiring
- added an Open Blocker Summary to `pnpm ops:mcp-client-smokes` so the
  remaining day-one MCP client rows are grouped by the prerequisite that
  unlocks them, instead of appearing only as a flat non-pass matrix
- extended the generated `mcp-client-session-pack` README with the same
  Open Blocker Summary so uploaded PR artifacts are directly usable for
  operator smoke-session batching
- refreshed the production-like hosted MCP evidence rows with 2026-07-09
  staging evidence after PR branch staging deploy run `29037734496`: the
  data-backed anonymous-read, Dynamic Client Registration, and public-client
  Client ID Metadata Document rows now pass against
  `https://staging.vrdex.net/mcp`
- extended `pnpm ops:mcp-installed-clients` with informational CLI automation
  notes so VS Code `chat`, Cursor `--chat`/`agent`, and Windsurf setup-only
  surfaces are clearly treated as manual-only evidence paths unless the real
  client session lists tools and calls `vrdex_search`
- extended `pnpm ops:mcp-installed-clients` with read-only Claude Desktop
  process/app-path detection plus OpenAI Responses API and Gemini CLI model
  credential preconditions so missing provider setup is visible before a smoke
  session starts
- refreshed the installed-client preflight notes for VS Code 1.128.0, Cursor
  3.10.17, and Windsurf 1.110.1; their CLIs still accept the generated local
  stdio, hosted anonymous HTTP, and hosted token-header fallback `--add-mcp`
  definitions while the matrix rows stay pending until real app tool-call
  evidence is captured
- added `pnpm smoke:mcp-gemini-cli` as a repeatable real-client Gemini CLI
  harness for local stdio and hosted Streamable HTTP MCP smokes, with optional
  disposable `@google/gemini-cli` package execution and token-backed hosted
  OAuth fallback support
- recorded Gemini CLI local stdio as passing against the repo API fixture with
  Gemini CLI `0.50.0`; hosted anonymous staging still times out before a hosted
  MCP tool-call result, and a retry with a live staging query hit Gemini API
  quota before MCP evidence, so the row remains failed in the manual matrix
- added `pnpm smoke:mcp-openai` as a repeatable OpenAI Responses API remote
  MCP hosted anonymous-read harness, keeping ChatGPT Apps/Connectors UI and
  hosted OAuth evidence as separate product-surface rows
- recorded the OpenAI Responses API hosted anonymous row as passing against
  `https://staging.vrdex.net/mcp`: after the PR branch staging deploy, the
  smoke reached the Responses API and `gpt-5.6-luna` called hosted MCP `search`
  and `fetch`
- changed `GET /api/v0/search` to return a typed RFC 9457 `503` problem when
  the public search backend is temporarily unavailable, and regenerated the
  OpenAPI JSON/YAML artifacts from the shared contract source
- fixed the Gemini CLI smoke harness on Windows so disposable package execution
  routes through `cmd.exe` instead of spawning `npx.cmd` directly; local
  preflight can reach Gemini CLI and fails closed on provider auth/quota before
  any matrix row is recorded
- tightened the Gemini CLI smoke harness timeout path so a timed-out child
  process is given a short close grace before the disposable project directory
  is removed, reducing transient Windows cleanup locks during failed client
  smokes
- added `pnpm ops:mcp-hosted-oauth-prereqs` as a read-only GitHub Actions
  variable/secret audit for the hosted MCP OAuth evidence path, covering both
  reviewed OAuth smoke secrets and temporary credential generation without
  reading secret values
- clarified that `pnpm ops:mcp-installed-clients` reads only current-process
  OAuth credential-generation inputs and should be paired with
  `pnpm ops:mcp-hosted-oauth-prereqs` for the repository variable/secret audit
- extended `pnpm ops:mcp-client-session-pack` hosted OAuth worksheets and
  README guidance to include the GitHub prerequisite audit before manual OAuth
  evidence capture
- extended `pnpm ops:mcp-client-smokes` hosted OAuth setup hints to point
  operators at the same GitHub prerequisite audit before client sessions
- wired PR Baseline Checks to upload the generated
  `mcp-client-session-pack` artifact from the MCP verifier job so reviewers can
  start the remaining manual client smoke rows from checked setup files and
  evidence worksheets
- clarified generated MCP client worksheets so failed client attempts can be
  recorded with sanitized blocker evidence, not only successful tool-call
  transcripts
- extended `pnpm ops:mcp-installed-clients` to report whether the
  `deployed-health.yml` hosted MCP OAuth smoke can mint temporary credentials
  through the hosted E2E auth/developer-credential helper gate, without
  printing browser tokens or generated client secrets

## 2026-07-07

- tightened `pnpm check:api-mcp-rollout` so the aggregate readiness gate checks
  every current checked-in `/api/v0` OpenAPI path and requires both MCP evidence
  recorder scripts before launch-readiness claims
- tightened the MCP client and hosted evidence recorders so pass/fail entries
  cannot use generated `<placeholder>` evidence, environment, or target values
- added Gemini CLI to the required day-one MCP client matrix after a current
  docs pass confirmed stdio, Streamable HTTP, OAuth discovery, Dynamic Client
  Registration, and `/mcp auth` support
- extended `pnpm smoke:mcp-inspector` with reviewed OAuth app client-credentials
  token acquisition plus `VRDEX_MCP_INSPECTOR_OAUTH_TOKEN` fallback support so
  Inspector hosted OAuth evidence can validate authenticated `tools/list` with
  an MCP-resource `mcp:read` token without printing the token or client secret
- extended `pnpm smoke:mcp-claude-code -- --mode hosted-http` with reviewed
  OAuth app client-credentials token acquisition plus
  `VRDEX_CLAUDE_CODE_OAUTH_TOKEN` fallback support so Claude Code hosted OAuth
  evidence can validate an authenticated `vrdex_search` call with an
  MCP-resource `mcp:read` token without printing the token or client secret
- added `pnpm ops:mcp-client-session-pack` to generate disposable VS Code,
  Cursor, Windsurf, and Gemini CLI MCP smoke-session configs, prompts, launch
  commands where supported, per-row evidence templates, and recorder commands
  under `.tmp-gh-artifacts/`
- extended `pnpm record:mcp-client-smoke` with `--evidence-file` so a completed
  generated worksheet can drive a matrix update while still rejecting pending
  worksheets, placeholders, and evidence summaries that appear to contain
  tokens, secrets, or authorization headers
- extended `pnpm ops:mcp-client-session-pack` with manual-only evidence
  worksheets for Claude Desktop, Claude Code hosted OAuth, OpenAI/ChatGPT
  hosted rows, and MCP Inspector hosted OAuth so every remaining required MCP
  client row can use the same worksheet recorder flow
- tightened `pnpm ops:mcp-client-session-pack` so it reads the MCP client smoke
  matrix and fails if a required row that is not already `pass` lacks a
  generated worksheet
- corrected VS Code, Cursor, and Windsurf smoke-session setup commands to use
  isolated `--user-data-dir` paths and PowerShell-safe escaped JSON for
  `--add-mcp` after the current Windows CLIs rejected fresh named profiles and
  raw `(Get-Content -Raw ...)` JSON arguments
- tightened `pnpm ops:mcp-client-session-pack` so each generated VS Code,
  Cursor, and Windsurf row uses its own isolated user-data directory instead of
  letting local, hosted anonymous, and token-fallback configs overwrite the same
  `vrdex` server entry
- added `pnpm ops:mcp-add-mcp-preflight` to verify that installed VS Code,
  Cursor, and Windsurf CLIs accept the generated local stdio, hosted anonymous
  HTTP, and hosted token-header fallback `--add-mcp` definitions before a human
  starts manual tool-list and `vrdex_search` evidence capture
- tightened `pnpm ops:mcp-add-mcp-preflight` selector parsing so repeated
  `--client` and `--config` flags are additive, matching the existing
  comma-separated selector form
- added `pnpm ops:mcp-oauth-smoke-credentials` to mint temporary staging OAuth
  smoke credentials through the gated E2E auth helper path, verify
  client-credentials `mcp:read` token issuance, and write ignored env files for
  Claude Code and MCP Inspector hosted OAuth smokes without printing the client
  secret
- wired the manual `deployed-health.yml` `hosted-mcp-smoke` OAuth path to mint
  temporary staging smoke credentials through the same helper when repository
  OAuth smoke secrets are absent but hosted E2E auth and developer-credential
  helpers are enabled
- extended `pnpm ops:mcp-installed-clients` to report hosted OAuth smoke
  credential readiness for Claude Code and MCP Inspector without printing
  secret values

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
