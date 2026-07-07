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
- Refresh tokens can be revoked through `/oauth/revoke`; revocation also
  revokes active access tokens for the same client, user, and resource where
  stored token state supports that relationship.
- Authorization Code uses PKCE with `S256`.
- Redirect URI matching is exact.
- API and MCP resources are validated separately.
- Hosted MCP OAuth is tested through Dynamic Client Registration.
- The `/oauth/register` route has deterministic route-handler coverage for
  schema normalization, registration mutation inputs, rate-limit errors, and
  backend failures.
- The `/oauth/token` route has deterministic route-helper coverage for
  Authorization Code, refresh-token rotation, Client Credentials, and no-store
  OAuth errors before malformed exchanges reach Convex.
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
- `pnpm ops:api-rate-limits` prints standard and trusted-partner policy
  tables.
- Rate-limited responses include `Retry-After`, `RateLimit-Limit`,
  `RateLimit-Remaining`, and `RateLimit-Reset`.
- Trusted partner quota changes remain manual and revocable, and the runtime
  limiter applies the trusted-partner tier only after credential validation.

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
  every required day-one client row and every production-like hosted-readiness
  evidence row. The smoke can optionally probe a deployed hosted `/mcp`
  endpoint with `--hosted-url`, and can include constrained Dynamic Client
  Registration and Client ID Metadata Document probes with `--dcr` and `--cimd`.
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
  those probes. The manual workflow keeps selected hosted diagnostics running
  after a subcheck failure, so one run can expose data-backed read, DCR, and
  CIMD blockers separately while still failing if any selected probe fails.
  Record the production-like hosted-readiness rows with
  `pnpm record:mcp-hosted-evidence` so the aggregate readiness gate can verify
  data-backed anonymous reads, Dynamic Client Registration, and Client ID
  Metadata Document evidence separately from client UI smoke rows.
- `docs/developers/mcp-client-compatibility.md` lists the current major-client
  matrix and must have manual smoke results before external readiness is
  declared. Record those manual rows with `pnpm record:mcp-client-smoke` so
  pass/fail entries include a run date, target environment, and sanitized
  evidence pointer.
- Required hosted matrix rows cannot be recorded or verified as `pass` unless
  the matrix target environment names a same-branch Convex preview, staging,
  production-like, or production target. Lightweight PR preview transport
  evidence must stay separate from external-readiness evidence. Generated
  recorder commands are templates; replace every `<placeholder>` value before
  recording pass/fail evidence.
- `pnpm ops:mcp-client-smokes` generates the current day-one client smoke run
  plan from the matrix, including repo preflight commands, manual evidence
  prompts, and recorder command templates for pending rows.
- `pnpm ops:mcp-installed-clients` performs a read-only local preflight for
  installed Claude Code, Gemini CLI, VS Code, Cursor, and Windsurf CLI versions
  plus MCP configuration support. It also reports hosted OAuth smoke credential
  readiness for Claude Code and MCP Inspector by variable name only. It catches
  client drift and OAuth evidence blockers before manual smoke sessions but
  does not replace manual matrix evidence.
- `pnpm ops:mcp-client-session-pack` writes disposable VS Code, Cursor,
  Windsurf, and Gemini CLI MCP setup files under `.tmp-gh-artifacts/`,
  including local stdio, hosted anonymous HTTP, hosted token-header fallback
  configs, launch commands or settings snippets where supported, smoke prompts,
  evidence templates, and recorder commands. It also writes manual-only
  worksheets for Claude Desktop, Claude Code hosted OAuth, OpenAI/ChatGPT
  hosted rows, and MCP Inspector hosted OAuth. It does not replace manual matrix
  evidence; use it to keep those smoke sessions repeatable and to capture
  sanitized screenshot or transcript evidence before recording a row. Filled
  evidence templates can be recorded with
  `pnpm record:mcp-client-smoke -- --evidence-file <template.md>`; the recorder
  rejects untouched pending worksheets, placeholders, and evidence summaries
  that appear to contain tokens, secrets, or authorization headers. The session
  pack reads the checked matrix by default and fails if any required row that is
  not already `pass` lacks a generated worksheet. VS Code-family setup commands
  use isolated `--user-data-dir` paths and escaped JSON arguments because the
  current Windows CLIs reject fresh named profiles and raw PowerShell JSON for
  `--add-mcp`.
- `pnpm ops:mcp-add-mcp-preflight` writes disposable VS Code, Cursor, and
  Windsurf config/user-data directories and verifies that the installed CLIs
  accept the generated local stdio, hosted anonymous HTTP, and hosted
  token-header fallback `--add-mcp` definitions. It skips missing clients by
  default and fails rejected definitions. It does not replace manual matrix
  evidence because it does not list tools or call `vrdex_search` inside a real
  client session.
- `pnpm ops:mcp-oauth-smoke-credentials` can mint temporary staging OAuth
  smoke credentials through the existing gated E2E auth helper path when
  `VRDEX_E2E_BROWSER_TOKEN` and the matching server-side helper configuration
  are present. It creates a verified E2E account, creates a confidential
  developer OAuth app with `client_credentials` and `mcp:read`, verifies the
  token endpoint, and writes ignored env files under `.tmp-gh-artifacts/` for
  the Claude Code and MCP Inspector hosted OAuth smokes. It prints no client
  secret and refuses production origins unless `--allow-production` is passed
  for an explicit emergency operator run.
- `pnpm check:api-mcp-rollout` summarizes the generated OpenAPI contract,
  required docs, verification scripts, MCP client matrix, and hosted MCP
  production-like evidence state. The gate asserts every current checked-in
  `/api/v0` OpenAPI path plus both MCP evidence recorder commands. It reports
  pending required items in normal mode and becomes a failing external-readiness
  gate with `--require-ready`.
- Claude Code local stdio and hosted anonymous HTTP can be real-client smoked
  with `pnpm smoke:mcp-claude-code`, which runs the installed Claude Code CLI
  through a strict temporary MCP config. Use hosted mode with `--hosted-data`
  against a same-branch or production-like backend before recording Claude Code
  hosted anonymous-read readiness. For Claude Code hosted OAuth evidence, set a
  reviewed OAuth app client id and secret through
  `VRDEX_MCP_OAUTH_CLIENT_ID` / `VRDEX_MCP_OAUTH_CLIENT_SECRET` or the
  `VRDEX_CLAUDE_CODE_OAUTH_CLIENT_*` overrides; the smoke exchanges them for a
  short-lived MCP-resource token and validates an authenticated `vrdex_search`
  call without printing the token or client secret. `VRDEX_CLAUDE_CODE_OAUTH_TOKEN`
  remains supported for pre-minted token fallback runs.
- MCP Inspector hosted anonymous HTTP can be smoke-tested with
  `pnpm smoke:mcp-inspector`, which uses the Inspector CLI to validate hosted
  tool listing and public-read auth metadata. Use `--hosted-data` against a
  same-branch or production-like backend before recording Inspector hosted
  anonymous-read readiness. For Inspector hosted OAuth evidence, set the same
  reviewed OAuth app credentials or the
  `VRDEX_MCP_INSPECTOR_OAUTH_CLIENT_*` overrides; the smoke exchanges them for
  a short-lived MCP-resource token and validates an authenticated `tools/list`
  without printing the token or client secret.
- The `deployed-health.yml` `hosted-mcp-smoke` dispatch can also run the
  Inspector hosted OAuth smoke when `mcp_oauth=true` and repository secrets
  provide either `VRDEX_MCP_OAUTH_CLIENT_ID` plus
  `VRDEX_MCP_OAUTH_CLIENT_SECRET` or `VRDEX_MCP_INSPECTOR_OAUTH_TOKEN`. The job
  skips that OAuth subcheck cleanly when the input is enabled but the secrets are
  absent, so anonymous/data/DCR/CIMD health evidence is not blocked on reviewed
  OAuth credentials.

Use a command shaped like this for each manual matrix row:

```sh
pnpm record:mcp-client-smoke -- \
  --client mcp-inspector \
  --check hosted-anonymous-read \
  --status pass \
  --environment "<client/version/env>" \
  --evidence "<sanitized evidence link>"
```

Use a command shaped like this for each hosted production-like evidence row:

```sh
pnpm record:mcp-hosted-evidence -- \
  --check hosted-data-backed-anonymous-read \
  --status pass \
  --target-environment "<same-branch Convex preview / staging / production-like target>" \
  --environment "<runner / target>" \
  --evidence "<sanitized workflow link or command output>"
```

## Validation Commands

Run the narrow checks for changed areas plus the aggregate checks required by
the PR:

```sh
pnpm check:api-openapi
pnpm typecheck:api-contracts
pnpm typecheck:vrdex-mcp
pnpm test:vrdex-mcp
pnpm test:scripts
pnpm smoke:mcp-compat
pnpm check:mcp-client-matrix
pnpm ops:mcp-installed-clients
pnpm ops:mcp-client-smokes
pnpm ops:mcp-client-session-pack -- --hosted-url <preview-or-production-like-/mcp-url>
pnpm ops:mcp-add-mcp-preflight -- --hosted-url <preview-or-production-like-/mcp-url>
VRDEX_E2E_BROWSER_TOKEN=<browser-token> pnpm ops:mcp-oauth-smoke-credentials -- --base-url <production-like-origin>
pnpm check:api-mcp-rollout
pnpm smoke:mcp-compat -- --hosted-only --hosted-url <preview-or-production-like-/mcp-url>
pnpm smoke:mcp-compat -- --hosted-only --hosted-url <production-like-/mcp-url> --hosted-data --dcr --cimd --continue-on-failure
VRDEX_MCP_OAUTH_CLIENT_ID=<reviewed-client-id> VRDEX_MCP_OAUTH_CLIENT_SECRET=<client-secret> pnpm smoke:mcp-claude-code -- --mode hosted-http --hosted-url <production-like-/mcp-url> --hosted-data
pnpm smoke:mcp-inspector -- --hosted-url <preview-or-production-like-/mcp-url>
VRDEX_MCP_OAUTH_CLIENT_ID=<reviewed-client-id> VRDEX_MCP_OAUTH_CLIENT_SECRET=<client-secret> pnpm smoke:mcp-inspector -- --hosted-url <production-like-/mcp-url> --hosted-data
gh workflow run deployed-health.yml --ref <branch> -f target=hosted-mcp-smoke -f base_url=<production-like-/mcp-url> -f mcp_data=true -f mcp_dcr=true -f mcp_cimd=true -f mcp_oauth=true
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
