# API And MCP Rollout Checklist

## Status

Current checklist for reviewing the public API and MCP platform foundation as
one PR.

## Contract And Docs

- OpenAPI is generated from shared schemas, not hand-written in parallel.
- `docs/api/openapi.json` matches the generated contract.
- `/api/v0/openapi.json` serves the same generated document.
- Developer docs cover public API, auth, OAuth apps, rate limits, MCP tools,
  self-hosting variables, and changelog notes.
- The Docusaurus docs build succeeds.

## Authentication And Security

- Bearer tokens are accepted only through `Authorization`.
- Personal API tokens are displayed once and stored as hashes.
- OAuth client secrets are displayed once and stored as hashes.
- OAuth access tokens are short-lived JWTs with issuer, audience, client id,
  token id, scope, and expiry validation.
- Refresh tokens rotate on successful refresh.
- Authorization Code uses PKCE with `S256`.
- Redirect URI matching is exact.
- API and MCP resources are validated separately.
- Hosted MCP OAuth is tested through Dynamic Client Registration.
- Client ID Metadata Document support is smoke-tested for clients that prefer
  URL-form client IDs.
- Revoked credentials are rejected and produce durable event metadata.

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
- `docs/developers/mcp-client-compatibility.md` lists the current major-client
  matrix and must have manual smoke results before external readiness is
  declared.

## Validation Commands

Run the narrow checks for changed areas plus the aggregate checks required by
the PR:

```sh
pnpm check:api-openapi
pnpm typecheck:api-contracts
pnpm --filter @basicbit/vrdex-mcp typecheck
pnpm --filter @basicbit/vrdex-mcp test
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
