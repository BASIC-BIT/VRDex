# API And MCP Rollout Checklist

## Status

Current checklist for reviewing the public API and MCP platform foundation as
one PR.

## Contract And Docs

- OpenAPI is generated from shared schemas, not hand-written in parallel.
- `docs/api/openapi.json` matches the generated contract.
- `/api/v0/openapi.json` serves the same generated document.
- Baseline Checks runs `pnpm verify:api-contracts` so OpenAPI drift,
  route/OpenAPI parity, contract typechecking, and contract tests are enforced
  in PR CI.
- Developer docs cover public API, auth, OAuth apps, rate limits, MCP tools,
  self-hosting variables, and changelog notes.
- The Docusaurus docs build succeeds.

## Authentication And Security

- Bearer tokens are accepted only through `Authorization`.
- Personal API tokens are displayed once and stored as hashes.
- OAuth client secrets are displayed once and stored as hashes.
- OAuth access tokens are short-lived JWTs with issuer, audience, client id,
  token id, scope, and expiry validation.
- OAuth signing-key rotation keeps previous public keys in JWKS and bearer
  verification until outstanding access tokens expire.
- Refresh tokens rotate on successful refresh.
- Authorization Code uses PKCE with `S256`.
- Redirect URI matching is exact.
- API and MCP resources are validated separately.
- Hosted MCP OAuth is tested through Dynamic Client Registration.
- The `/oauth/register` route has deterministic route-handler coverage for
  schema normalization, registration mutation inputs, rate-limit errors, and
  backend failures.
- Client ID Metadata Document support is smoke-tested through the checked-in
  public MCP client metadata document when a same-branch Convex preview backend
  is available.
- Revoked credentials are rejected and produce durable event metadata for
  personal API-token and OAuth access-token validation.

## Rate Limits And Operations

- Anonymous API reads, authenticated API reads, hosted MCP reads, OAuth token
  requests, and developer credential management use separate route classes.
- Hosted high-volume deployments use a Redis-compatible counter store.
- Local development can use the memory store.
- `pnpm ops:api-rate-limits` prints the default policy table.
- Rate-limited responses include `Retry-After`, `RateLimit-Limit`,
  `RateLimit-Remaining`, and `RateLimit-Reset`.
- Trusted partner quota changes remain manual and revocable.

## MCP Compatibility

- Hosted `/mcp` supports anonymous public read tools.
- Hosted `/mcp` accepts MCP-resource OAuth tokens with `mcp:read`.
- Hosted `/mcp` returns protected-resource metadata and `mcp:read` scope hints
  in bearer challenges for invalid or insufficient OAuth tokens.
- Local stdio MCP supports hosted and self-hosted API base URLs.
- Local stdio MCP can run with anonymous reads, personal API tokens, or
  API-resource OAuth access tokens.
- Baseline Checks runs `pnpm verify:vrdex-mcp`, including
  `pnpm smoke:mcp-compat`, for package typechecking, package tests, and shared
  local stdio protocol coverage across every curated read tool. The verifier
  also validates
  `docs/developers/mcp-client-smoke-results.json` so the manual matrix keeps
  every required day-one client row. The smoke can optionally probe a deployed
  hosted `/mcp` endpoint with `--hosted-url`, and can include constrained
  Dynamic Client Registration and Client ID Metadata Document probes with
  `--dcr` and `--cimd`.
- Baseline Checks runs `Hosted MCP Preview Smoke` after the Vercel preview. It
  runs anonymous hosted Streamable HTTP, an anonymous `vrdex_search` tool call,
  OAuth metadata, and bearer-challenge checks whenever a preview URL exists. It
  adds Dynamic Client Registration and Client ID Metadata Document authorization
  when a same-branch Convex preview backend is available, and records that
  preview-backend prerequisite when `CONVEX_DEPLOY_KEY_PREVIEW` is not
  configured.
- The manual `Deployed Health Checks` workflow target `hosted-mcp-smoke` can run
  the same hosted smoke against a staging, production-like, or same-branch
  Convex preview target. Use its `mcp_dcr` and `mcp_cimd` inputs for
  external-readiness evidence when the automatic PR preview lane cannot enable
  those probes.
- `docs/developers/mcp-client-compatibility.md` lists the current major-client
  matrix and must have manual smoke results before external readiness is
  declared. Record those manual rows with `pnpm record:mcp-client-smoke` so
  pass/fail entries include a run date, target environment, and sanitized
  evidence pointer.
- Claude Code local stdio can be real-client smoked with
  `pnpm smoke:mcp-claude-code`, which runs the installed Claude Code CLI against
  the repo fixture through a strict temporary MCP config.

Use a command shaped like this for each manual matrix row:

```sh
pnpm record:mcp-client-smoke -- \
  --client mcp-inspector \
  --check hosted-anonymous-read \
  --status pass \
  --environment "<client/version/env>" \
  --evidence "<sanitized evidence link>"
```

## Validation Commands

Run the narrow checks for changed areas plus the aggregate checks required by
the PR:

```sh
pnpm check:api-openapi
pnpm typecheck:api-contracts
pnpm typecheck:vrdex-mcp
pnpm test:vrdex-mcp
pnpm smoke:mcp-compat
pnpm check:mcp-client-matrix
pnpm typecheck:backend
pnpm test:backend
pnpm typecheck:web
pnpm lint:web
pnpm lint:markdown
node --import tsx --test tests/web/**/*.test.ts
git diff --check
```

Use visual verification for changed UI surfaces. This checklist adds no visual
requirement for docs-only or backend-only edits.
