# MCP Client Compatibility Matrix

## Status

Implementation-time compatibility matrix for the public API and MCP platform
foundation.

Last reviewed: 2026-07-06.

This matrix separates repo-verified protocol behavior from manual client
smokes. Do not declare the public MCP surface externally ready until the manual
smoke rows are run against a deployed preview or production-like environment.

Source-backed client requirements from the current docs pass:

- hosted MCP must keep Streamable HTTP working for remote clients
- local MCP must keep stdio working for clients that run command-based servers
- hosted OAuth must support protected-resource metadata discovery, scope-aware
  bearer challenges, and constrained Dynamic Client Registration for clients
  that register automatically
- Client ID Metadata Documents are supported for hosted MCP public clients that
  prefer URL-form client IDs
- hosted public read tools should be callable without OAuth in clients that
  understand no-auth tool metadata, while OAuth remains available for
  authenticated MCP reads and future privileged tools
- OpenAI/ChatGPT-style clients need per-tool auth metadata to distinguish
  anonymous public-read tools from OAuth-required tools. The current MCP SDK
  emits this through `_meta["securitySchemes"]`.
- static bearer-token headers remain a diagnostic fallback, not the preferred
  hosted OAuth setup
- do not publish client-specific setup snippets unless that client's current
  docs or a manual smoke confirms the config shape

## Repo-Verified Protocol Checks

| Surface | Evidence |
| --- | --- |
| Hosted Streamable HTTP MCP | `node --import tsx --test tests/web/**/*.test.ts` covers initialization and curated tool listing. |
| Hosted anonymous public reads | Hosted `/mcp` allows no-bearer public read tools through the `anonymous_mcp_public_read` route class. Manual client smokes must also confirm the client UI does not force OAuth before public read calls. |
| Hosted data-backed public reads | `pnpm smoke:mcp-compat -- --hosted-data` requires non-empty anonymous `vrdex_search` to reach a production-like Convex backend and return structured content without a tool error. |
| Hosted public-read auth metadata | Hosted `/mcp` `tools/list` exposes `_meta["securitySchemes"]` with `noauth` plus optional `oauth2`/`mcp:read` on every curated public read tool. |
| Hosted OAuth bearer handling | Web MCP and OAuth JWT tests cover MCP-resource audience validation, `mcp:read` scope validation, and protected-resource bearer challenges. |
| Hosted Client ID Metadata Documents | Web OAuth helper tests cover URL-form client IDs, exact `client_id` matching, redirect rejection, response-size limits, and special-use address rejection. |
| Local stdio MCP | `pnpm --filter @basicbit/vrdex-mcp test` runs JSON-RPC stdio calls for every curated read tool against a local API fixture. |
| Local API token config | `packages/vrdex-mcp` tests cover bearer forwarding to `/api/v0`. |
| Self-hosted base URL config | `packages/vrdex-mcp` tests cover origin and explicit `/api/v0` normalization. |

## Repo Smoke Command

Run this before manual client smokes:

```sh
pnpm smoke:mcp-compat
```

Claude Code has an additional real-client harness. In local stdio mode, it
starts the repo API fixture, runs the installed Claude Code CLI with a strict
temporary `--mcp-config`, calls `vrdex_search`, and fails unless the fixture
receives the expected search request:

```sh
pnpm smoke:mcp-claude-code
```

In hosted HTTP mode, it points Claude Code at a deployed Streamable HTTP MCP
endpoint and parses Claude Code's stream JSON to prove the exact hosted
`vrdex_search` tool call and structured result:

```sh
pnpm smoke:mcp-claude-code -- \
  --mode hosted-http \
  --hosted-url https://staging.vrdex.net/mcp
```

PR Baseline Checks run the same local stdio protocol smoke through
`pnpm verify:vrdex-mcp`.

PR Baseline Checks also run `Hosted MCP Preview Smoke` after the Vercel preview
deployment. When the preview URL exists, that lane runs this smoke against the
preview `/mcp` endpoint for anonymous Streamable HTTP, an anonymous
empty-query `vrdex_search` tool call, OAuth metadata, and bearer challenge
coverage. Data-backed non-empty public reads, Dynamic Client Registration, and
Client ID Metadata Document authorization are enabled only when
`CONVEX_DEPLOY_KEY_PREVIEW` provisions a same-branch Convex preview backend; if
that backend is unavailable, the lane records the preview-backend prerequisite
and still runs the non-mutating hosted smoke.

The command starts the local stdio MCP package against a local API fixture and
replays initialize, tool-list, and every curated read-tool call with protocol
profiles for Claude Desktop, Claude Code, VS Code, Cursor, Devin Desktop /
Windsurf Cascade, and MCP Inspector. It verifies the shared MCP protocol path
these clients use, not the clients' UI or account flows.

The manual smoke result artifact is
`docs/developers/mcp-client-smoke-results.json`. `pnpm verify:vrdex-mcp`
validates that the artifact still lists every required day-one client and
required smoke row. Run this explicit check when updating matrix evidence:

```sh
pnpm check:mcp-client-matrix
```

Record manual pass or fail results with the recorder command instead of
hand-editing the JSON:

```sh
pnpm record:mcp-client-smoke -- \
  --client mcp-inspector \
  --check hosted-anonymous-read \
  --status pass \
  --environment "Windows 11 / MCP Inspector <version> / https://vrdex.net/mcp" \
  --evidence "sanitized screenshot or PR evidence link"
```

Use `--matrix <path>` or `VRDEX_MCP_CLIENT_MATRIX_PATH=<path>` to rehearse an
update against a temporary copy before writing the canonical matrix. A `pass`
or `fail` entry requires an environment and evidence pointer; `pending` clears
run evidence; `not_applicable` requires notes and is allowed only for rows that
are not required for external readiness.

By default, the check accepts `pending` manual rows because repository protocol
checks can run before the desktop/web client smokes are available. For external
readiness, require every required manual row to pass:

```sh
pnpm check:mcp-client-matrix -- --require-ready
```

To include a deployed hosted MCP endpoint, pass:

```sh
pnpm smoke:mcp-compat -- --hosted-url https://staging.vrdex.net/mcp
```

The hosted smoke covers anonymous Streamable HTTP initialization/tool listing, an
anonymous empty-query `vrdex_search` tool call, OAuth protected-resource
metadata, authorization-server metadata, and the OAuth protected-resource
challenge for invalid bearer tokens. Add `--hosted-data` when the target is
backed by same-branch or production-like Convex functions and indexes; that path
requires non-empty anonymous `vrdex_search` to return structured content instead
of a tool error. Add `--dcr` when you want the smoke to register a
constrained public MCP client through Dynamic Client Registration. Add `--cimd`
when you want the smoke to exercise a URL-form public client id against
`GET /oauth/authorize`; the smoke uses
`/.well-known/oauth-client/vrdex-mcp-public-client` and expects the
unauthenticated sign-in redirect after metadata validation succeeds.

The equivalent environment variables remain supported for CI:
`VRDEX_MCP_SMOKE_URL`, `VRDEX_MCP_SMOKE_DATA`, `VRDEX_MCP_SMOKE_DCR`, and
`VRDEX_MCP_SMOKE_CIMD`. Set `VRDEX_MCP_SMOKE_TOKEN` only for a local terminal
run when you want to test an authenticated hosted tool list. Do not commit real
tokens or smoke output containing credentials.

GitHub also has a manual `Deployed Health Checks` workflow target named
`hosted-mcp-smoke` for production-like or same-branch Convex preview targets.
Use it when `Hosted MCP Preview Smoke` cannot enable data-backed reads, DCR, or
CIMD because the PR preview lacks `CONVEX_DEPLOY_KEY_PREVIEW`, or when
validating a staging target before external readiness.

## Day-One Client Matrix

| Client | Local stdio config | Hosted HTTP config | OAuth expectation | Current status |
| --- | --- | --- | --- | --- |
| Claude Desktop | Uses `mcpServers` JSON with `command`, `args`, and optional `env`. | Remote setup should use Claude's current Custom Connector path. | Hosted `/mcp` should complete OAuth through protected-resource metadata. | Local stdio protocol smoke covered by `pnpm smoke:mcp-compat`; hosted manual smoke pending. |
| Claude Code | Supports stdio with `claude mcp add --transport stdio`. | Supports HTTP with `claude mcp add --transport http`. | Supports OAuth from `/mcp` or `claude mcp login`; DCR and public-client CIMD are implemented. | Local stdio real-client smoke passes through `pnpm smoke:mcp-claude-code`; hosted no-auth transport passes with empty-query search, while data-backed hosted anonymous reads and hosted OAuth remain pending. |
| VS Code | Uses `.vscode/mcp.json` or user MCP config with `servers` entries. | Supports `type: "http"` and `url`. | Avoid hardcoded secrets; use inputs or environment files. OAuth manual smoke pending. | Local stdio protocol smoke covered by `pnpm smoke:mcp-compat`; config snippets ready; manual smoke pending. |
| Cursor | Treat local stdio as a required smoke target if the current release still supports command-based MCP config. | Treat hosted HTTP as a required smoke target if the current release supports remote MCP URLs. | Confirm current OAuth behavior during manual smoke. | Local stdio protocol smoke covered by `pnpm smoke:mcp-compat`; do not publish Cursor-specific snippets until the current docs or smoke run confirm them. |
| OpenAI and ChatGPT MCP-capable surfaces | Treat local stdio as unsupported until the current product surface says otherwise. | Use hosted remote MCP when ChatGPT Apps, deep research, or API integration setup supports custom MCP servers. | Current OpenAI docs recommend CIMD when the authorization server supports it and keep DCR as a supported path when configured; VRDex implements both DCR and public-client CIMD. Public read tools advertise `_meta["securitySchemes"]` with `noauth` plus optional `oauth2`. | Hosted remote MCP target identified; exact setup and per-tool auth metadata behavior must be verified in the relevant OpenAI surface before launch docs publish snippets. |
| Devin Desktop / Windsurf Cascade | Uses `mcp_config.json` with `mcpServers`. | Supports `serverUrl` or `url` for remote HTTP MCPs. | Docs state OAuth support for stdio, Streamable HTTP, and SSE. | Local stdio protocol smoke covered by `pnpm smoke:mcp-compat`; hosted config shape ready; manual smoke pending. |
| MCP Inspector | Use as a protocol-level stdio debugger; local stdio `vrdex_search` is manually verified in the smoke matrix. | Connect directly to hosted `/mcp` for remote debugging; anonymous hosted tool listing is manually verified in the smoke matrix. | Exercise OAuth separately. | Local stdio diagnostic smoke passes; hosted tool listing and auth metadata pass on the PR preview, while data-backed hosted anonymous reads and hosted OAuth remain pending. |

## Shared Local Stdio Config

Most clients that accept the common MCP server JSON shape can use this local
stdio configuration.

```json
{
  "mcpServers": {
    "vrdex": {
      "command": "pnpm",
      "args": [
        "--silent",
        "--dir",
        "<path-to-vrdex-checkout>",
        "exec",
        "tsx",
        "packages/vrdex-mcp/src/stdio.ts"
      ],
      "env": {
        "VRDEX_API_BASE_URL": "https://vrdex.net",
        "VRDEX_API_TOKEN": "<personal-api-token>"
      }
    }
  }
}
```

For anonymous public reads, omit `VRDEX_API_TOKEN`. For self-hosted or staging
deployments, set `VRDEX_API_BASE_URL` to the deployment origin or explicit
`/api/v0` path.

VS Code uses `servers` rather than `mcpServers`:

```json
{
  "servers": {
    "vrdex": {
      "type": "stdio",
      "command": "pnpm",
      "args": [
        "--silent",
        "--dir",
        "<path-to-vrdex-checkout>",
        "exec",
        "tsx",
        "packages/vrdex-mcp/src/stdio.ts"
      ],
      "env": {
        "VRDEX_API_BASE_URL": "https://vrdex.net"
      }
    }
  }
}
```

## Shared Hosted HTTP Config

Hosted endpoint:

```txt
https://vrdex.net/mcp
```

Anonymous public reads require no credential. OAuth-authenticated hosted reads
need an MCP-resource token with `mcp:read`. If a client is testing OAuth
discovery, remove static `Authorization` headers so it can follow protected
resource metadata.

Claude Code hosted anonymous command:

```sh
claude mcp add --transport http vrdex https://vrdex.net/mcp
```

Claude Code hosted header-token fallback:

```sh
claude mcp add --transport http vrdex https://vrdex.net/mcp \
  --header "Authorization: Bearer <mcp-resource-token>"
```

Windsurf or Devin Desktop hosted config:

```json
{
  "mcpServers": {
    "vrdex": {
      "serverUrl": "https://vrdex.net/mcp"
    }
  }
}
```

VS Code hosted config:

```json
{
  "servers": {
    "vrdex": {
      "type": "http",
      "url": "https://vrdex.net/mcp"
    }
  }
}
```

## Manual Smoke Checklist

0. Run `pnpm smoke:mcp-compat`; for hosted protocol coverage, add
   `--hosted-url <preview-or-production-like-/mcp-url>`. Add `--hosted-data`
   when the deployed target has same-branch or production-like Convex functions
   and indexes. Add `--dcr` when the smoke should create a temporary dynamic
   public MCP client, and `--cimd` when the smoke should materialize the public
   client metadata document flow through `/oauth/authorize`. For GitHub-hosted
   evidence against a deployed target, run the manual `Deployed Health Checks`
   workflow with target `hosted-mcp-smoke`, `base_url=<target-/mcp-url>`, and
   the matching `mcp_data`/`mcp_dcr`/`mcp_cimd` toggles.
1. Claude Desktop local stdio starts, lists six tools, and calls
   `vrdex_search`.
2. Claude Desktop hosted Custom Connector lists anonymous tools and completes
   OAuth for `mcp:read` when protected tools are enabled.
3. Claude Code local stdio and hosted HTTP anonymous reads pass through
   `pnpm smoke:mcp-claude-code`; hosted anonymous readiness includes a
   data-backed non-empty search against the target backend, and hosted OAuth
   completes with `mcp:read` through DCR and public-client CIMD.
4. VS Code local stdio lists six tools and hosted HTTP anonymous reads work.
5. Cursor local stdio and hosted HTTP read tools work in the current release.
6. OpenAI or ChatGPT MCP-capable surfaces connect to hosted `/mcp` if the
   current product supports custom remote MCP connectors. Record whether the
   connector accepts DCR, requires Client ID Metadata Documents, or follows a
   reviewed app submission path. Also record whether public read tools appear
   as anonymous/no-auth tools instead of forcing OAuth before a safe search.
7. Devin Desktop or Windsurf Cascade local stdio and hosted HTTP read tools
   work; OAuth is tested when team MCP access allows it.
8. MCP Inspector local stdio and hosted anonymous read paths return expected
   tool lists, auth metadata, and data-backed search results; OAuth-protected
   read behavior still needs a separate hosted smoke.

For each smoke, record client version, OS, transport, auth mode, result, exact
config shape, whether the client distinguishes anonymous/no-auth tools from
OAuth-required tools, and issue link if it fails. Keep real tokens out of docs,
logs, and screenshots.

Record those results with `pnpm record:mcp-client-smoke`. The command updates
`docs/developers/mcp-client-smoke-results.json` and preserves the matrix shape
expected by `pnpm check:mcp-client-matrix`. Leave a row as `pending` only while
the PR is not being declared externally ready.

## Source Trail

- [MCP local server guide](https://modelcontextprotocol.io/docs/develop/connect-local-servers)
- [MCP remote server guide](https://modelcontextprotocol.io/docs/develop/connect-remote-servers)
- [MCP overview](https://modelcontextprotocol.io/docs/getting-started/intro)
- [MCP Inspector](https://modelcontextprotocol.io/docs/tools/inspector)
- [Claude Code MCP docs](https://docs.anthropic.com/en/docs/claude-code/mcp)
- [VS Code MCP servers](https://code.visualstudio.com/docs/agent-customization/mcp-servers)
- [Devin Desktop / Windsurf Cascade MCP](https://docs.devin.ai/desktop/cascade/mcp)
- [OpenAI MCP and Connectors](https://platform.openai.com/docs/mcp)
- [OpenAI Apps SDK authentication](https://developers.openai.com/apps-sdk/build/auth)
- [OpenAI Apps SDK reference](https://developers.openai.com/apps-sdk/reference)
