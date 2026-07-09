# API And MCP Rollout Checklist

## Status

Current checklist for reviewing the public API and MCP platform foundation as
one PR.

## Contract And Docs

- OpenAPI is generated from shared schemas, not hand-written in parallel.
- `docs/api/openapi.json` and `docs/api/openapi.yaml` match the generated
  contract.
- `/api/v0/openapi.json` and `/api/v0/openapi.yaml` serve the same generated
  document in JSON and YAML forms.
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
- Hosted high-volume deployments use a Redis-compatible counter store, with
  BASIC BIT hosted production/staging provisioning owned by
  `infra/terraform/rate-limit-redis`.
- Local development can use the memory store.
- `pnpm ops:api-rate-limits` prints standard and trusted-partner policy
  tables.
- `pnpm ops:api-rate-limit-counts` prints current Redis REST aggregate request
  counts and TTLs by route class when the hosted counter env vars are present.
- `pnpm ops:api-platform-observability` prints a sanitized Convex summary of
  durable API/MCP event rows, including rate-limit blocks, token validation,
  OAuth grant outcomes, MCP tool calls, and write-audit rows over a bounded
  time window.
- Rate-limited responses include `Retry-After`, `RateLimit-Limit`,
  `RateLimit-Remaining`, and `RateLimit-Reset`.
- API request counts are tracked through aggregate route-class counter keys in
  the active rate-limit backend, separate from identity buckets used for
  enforcement.
- Rate-limit blocks are recorded in `apiRateLimitEvents` by route class and
  identity kind without storing IP addresses, credential ids, Redis keys, or
  bearer values.
- Accepted hosted MCP tool calls are recorded in `mcpToolEvents` by curated
  tool name and accepted MCP route class for anonymous/authenticated usage
  counts.
- Public API profile writes, event writes, API upload-intent creation, and API
  upload completion are recorded in `apiWriteAuditEvents` by action, route
  class, actor kind, resource type, result, owner reference where available,
  and target resource ids.
- OAuth grant outcomes and OAuth access-token validation failures are
  summarized from `oauthClientEvents`; personal API-token validation failures
  are summarized from `apiTokenEvents`.
- Trusted partner quota changes remain manual and revocable, and the runtime
  limiter applies the trusted-partner tier only after credential validation.

## MCP Compatibility

- Hosted `/mcp` supports anonymous public read tools.
- Hosted `/mcp` exposes OpenAI/ChatGPT-compatible anonymous `search` and
  `fetch` aliases over the public profile, event, and world read surfaces.
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
  On pull requests, the same job uploads an `mcp-client-session-pack` artifact
  with generated setup files and evidence worksheets for the remaining manual
  client matrix rows.
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
  CIMD blockers separately while still failing if any selected probe fails. Use
  `mcp_oauth=true` when the run should use configured repository OAuth smoke
  secrets or, on staging/same-branch targets, mint temporary smoke credentials
  from hosted E2E auth and developer-credential helpers.
  Record the production-like hosted-readiness rows with
  `pnpm record:mcp-hosted-evidence` so the aggregate readiness gate can verify
  data-backed anonymous reads, Dynamic Client Registration, and Client ID
  Metadata Document evidence separately from client UI smoke rows. A
  `hosted-data-backed-anonymous-read` pass must include the stricter
  `--hosted-data` evidence shape: `vrdex_search`, OpenAI-compatible `search`,
  and `fetch` document text from the same target.
- `docs/developers/mcp-client-compatibility.md` lists the current major-client
  matrix and must have manual smoke results before external readiness is
  declared. Record those manual rows with `pnpm record:mcp-client-smoke` so
  pass/fail entries include a run date, target environment, and sanitized
  evidence pointer.
- The major-client matrix source check was refreshed on 2026-07-09 against the
  current official docs for VS Code, Claude Code, Cursor, and Devin Desktop /
  Windsurf Cascade. Those docs keep remote HTTP/Streamable HTTP, local stdio,
  and hosted OAuth behavior in scope, so the next burn-down batch is real
  installed-app evidence for VS Code, Cursor, and Windsurf rather than another
  protocol redesign.
- Required hosted matrix rows cannot be recorded or verified as `pass` unless
  the matrix target environment names a same-branch Convex preview, staging,
  production-like, or production target. Lightweight PR preview transport
  evidence must stay separate from external-readiness evidence. Generated
  recorder commands are templates; replace every `<placeholder>` value before
  recording pass/fail evidence.
- `pnpm ops:mcp-client-smokes` generates the current day-one client smoke run
  plan from the matrix, including repo preflight commands, manual evidence
  prompts, recorder command templates for pending rows, and an Open Blocker
  Summary that groups remaining work by the prerequisite needed to unlock it.
- `pnpm ops:mcp-installed-clients` performs a read-only local preflight for
  installed Claude Code, Gemini CLI, VS Code, Cursor, and Windsurf CLI versions
  plus MCP configuration support. It also reports Claude Desktop process or
  common app-path availability on Windows, OpenAI Responses API and Gemini CLI
  auth readiness, and hosted OAuth smoke credential readiness by variable name
  only, including the `deployed-health.yml` temporary credential-generation gate
  (`VRDEX_HOSTED_E2E_AUTH_HELPERS`,
  `VRDEX_HOSTED_E2E_DEVELOPER_CREDENTIALS`, and
  `VRDEX_HOSTED_E2E_BROWSER_TOKEN`). It catches client drift and OAuth evidence
  blockers before manual smoke sessions but does not replace manual matrix
  evidence. Its credential tables load repo-root `.env.local` if present, then
  read the current process environment without printing secret values; run
  `pnpm ops:mcp-hosted-oauth-prereqs` for the GitHub repository
  variable/secret audit. Its CLI automation notes are informational: VS Code `chat`, Cursor
  `--chat`/`agent`, and Windsurf setup CLI checks do not count as matrix
  evidence unless the real client session lists tools and calls `vrdex_search`
  or, for OpenAI/ChatGPT-compatible surfaces, `search` plus `fetch`.
- Current 2026-07-09 repository audit for PR #159: hosted OAuth evidence is
  still `partial`. `VRDEX_HOSTED_E2E_AUTH_HELPERS=true` and the
  `VRDEX_HOSTED_E2E_BROWSER_TOKEN` secret are present, but reviewed OAuth smoke
  secrets, `VRDEX_MCP_INSPECTOR_OAUTH_TOKEN`, and
  `VRDEX_HOSTED_E2E_DEVELOPER_CREDENTIALS=true` are absent. Do not mark hosted
  OAuth rows pass until one complete credential path is configured and a
  matching smoke run is recorded.
- `pnpm ops:mcp-client-session-pack` writes disposable VS Code, Cursor,
  Windsurf, and Gemini CLI MCP setup files under `.tmp-gh-artifacts/`,
  including local stdio, hosted anonymous HTTP, hosted token-header fallback
  configs, launch commands or settings snippets where supported, smoke prompts,
  evidence templates, recorder commands, and the same Open Blocker Summary
  as the smoke planner. It also writes manual-only worksheets for Claude
  Desktop, Claude Code hosted OAuth, OpenAI/ChatGPT hosted rows, and MCP
  Inspector hosted OAuth. It does not replace manual matrix evidence; use it to
  keep those smoke sessions repeatable and to capture
  sanitized screenshot or transcript evidence before recording a row. PR
  Baseline Checks upload the same pack as `mcp-client-session-pack` so reviewers
  and operators do not have to regenerate it before client smoke sessions.
  Filled evidence templates can be recorded with
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
  client session. Use comma-separated selectors or repeated flags to narrow
  the run; for example, `--client vscode,cursor` and
  `--client vscode --client cursor` are equivalent.
- `pnpm ops:mcp-oauth-smoke-credentials` can mint temporary staging OAuth
  smoke credentials through the existing gated E2E auth helper path when
  `VRDEX_E2E_BROWSER_TOKEN` and the matching server-side helper configuration
  are present. It creates a verified E2E account, creates a confidential
  developer OAuth app with `client_credentials` and `mcp:read`, verifies the
  token endpoint, and writes ignored env files under `.tmp-gh-artifacts/` for
  the Claude Code and MCP Inspector hosted OAuth smokes. It prints no client
  secret and refuses production origins unless `--allow-production` is passed
  for an explicit emergency operator run.
- `pnpm ops:mcp-hosted-oauth-prereqs` reads GitHub Actions variable values and
  secret names through `gh` and reports whether hosted MCP OAuth evidence can use
  reviewed OAuth smoke secrets or the deployed-health temporary
  credential-generation path. It prints only variable/secret names plus boolean
  readiness, never secret values. Use `--require-ready` when the hosted OAuth
  path must be treated as a hard external-readiness gate.
- `pnpm check:api-mcp-rollout` summarizes the generated OpenAPI contract,
  required docs, verification scripts, hosted rate-limit Terraform owner, MCP
  client matrix, and hosted MCP production-like evidence state. The gate
  asserts every current checked-in `/api/v0` OpenAPI path, the
  `infra/terraform/rate-limit-redis` files, lockfile, README entry, and
  Terraform workflow wiring, plus both MCP evidence recorder commands. It
  reports required items that are not pass in normal mode, labels required
  failed evidence rows as `fail`, and becomes a failing external-readiness gate
  with `--require-ready`.
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
- OpenAI Responses API remote MCP hosted anonymous-read evidence can be
  smoke-tested with `pnpm smoke:mcp-openai` after setting `OPENAI_API_KEY`; the
  smoke also loads repo-root `.env.local` if present, without overriding
  already-set variables or printing secret values. Live Responses API requests
  time out after 90 seconds by default, with `--request-timeout-ms` available
  for slower provider runs. The smoke uses the OpenAI-required hosted `search`
  and `fetch` tool names. Run it with required `--hosted-data` against a
  same-branch or production-like backend before recording API integration
  evidence. Current 2026-07-09 evidence is pass against
  `https://staging.vrdex.net/mcp` after PR branch staging deploy run
  `29037734496`: the full hosted compatibility smoke passed data-backed
  `vrdex_search`, `search`, `fetch`, DCR, and CIMD, and
  `pnpm smoke:mcp-openai` reached the Responses API where `gpt-4.1-mini`
  called hosted MCP `search` and `fetch`. This does not replace ChatGPT
  Apps/Connectors UI or hosted OAuth evidence; those product-surface rows stay
  pending until the current UI proves no-auth public reads and `mcp:read` OAuth
  behavior.
- The general hosted MCP compatibility smoke now also checks the
  OpenAI-compatible `search` and `fetch` aliases whenever `--hosted-data` is
  set. Use `--hosted-query` or `VRDEX_MCP_SMOKE_QUERY` when the target's
  public seed data needs a known non-empty query.
- The `deployed-health.yml` `hosted-mcp-smoke` dispatch can also run the
  Inspector hosted OAuth smoke when `mcp_oauth=true`. It prefers repository
  secrets that provide either `VRDEX_MCP_OAUTH_CLIENT_ID` plus
  `VRDEX_MCP_OAUTH_CLIENT_SECRET` or `VRDEX_MCP_INSPECTOR_OAUTH_TOKEN`. If
  those are absent and `VRDEX_HOSTED_E2E_AUTH_HELPERS=true`,
  `VRDEX_HOSTED_E2E_DEVELOPER_CREDENTIALS=true`, and
  `VRDEX_HOSTED_E2E_BROWSER_TOKEN` are configured, the job mints temporary
  smoke credentials through `pnpm ops:mcp-oauth-smoke-credentials`, masks the
  generated secret, and feeds the credentials to the Inspector OAuth smoke. It
  skips that OAuth subcheck cleanly when neither credential source is available,
  so anonymous/data/DCR/CIMD health evidence is not blocked on reviewed OAuth
  credentials. Enabling `VRDEX_HOSTED_E2E_DEVELOPER_CREDENTIALS` is an operator
  decision, not a routine PR edit; keep it unset until the staging target has
  the developer credential routes and token endpoint under test.

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
  --evidence "<sanitized workflow link showing vrdex_search plus search and fetch>"
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
pnpm ops:mcp-client-smokes -- --hosted-url <preview-or-production-like-/mcp-url> --hosted-query <known-public-query>
pnpm ops:mcp-client-session-pack -- --hosted-url <preview-or-production-like-/mcp-url> --hosted-query <known-public-query>
pnpm ops:mcp-add-mcp-preflight -- --hosted-url <preview-or-production-like-/mcp-url>
VRDEX_E2E_BROWSER_TOKEN=<browser-token> pnpm ops:mcp-oauth-smoke-credentials -- --base-url <production-like-origin>
pnpm ops:mcp-hosted-oauth-prereqs
pnpm ops:api-platform-observability
pnpm check:api-mcp-rollout
pnpm smoke:mcp-compat -- --hosted-only --hosted-url <preview-or-production-like-/mcp-url>
pnpm smoke:mcp-compat -- --hosted-only --hosted-url <production-like-/mcp-url> --hosted-data --hosted-query <known-public-query> --dcr --cimd --continue-on-failure
VRDEX_MCP_OAUTH_CLIENT_ID=<reviewed-client-id> VRDEX_MCP_OAUTH_CLIENT_SECRET=<client-secret> pnpm smoke:mcp-claude-code -- --mode hosted-http --hosted-url <production-like-/mcp-url> --hosted-data --hosted-query <known-public-query>
pnpm smoke:mcp-inspector -- --hosted-url <preview-or-production-like-/mcp-url>
VRDEX_MCP_OAUTH_CLIENT_ID=<reviewed-client-id> VRDEX_MCP_OAUTH_CLIENT_SECRET=<client-secret> pnpm smoke:mcp-inspector -- --hosted-url <production-like-/mcp-url> --hosted-data --query <known-public-query>
pnpm smoke:mcp-openai -- --hosted-url <production-like-/mcp-url> --hosted-data --hosted-query <known-public-query>
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
