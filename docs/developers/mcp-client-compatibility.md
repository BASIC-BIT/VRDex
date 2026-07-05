# MCP Client Compatibility Matrix

## Status

Implementation-time compatibility matrix for the public API and MCP platform
foundation.

Last reviewed: 2026-07-05.

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
- static bearer-token headers remain a diagnostic fallback, not the preferred
  hosted OAuth setup
- do not publish client-specific setup snippets unless that client's current
  docs or a manual smoke confirms the config shape

## Repo-Verified Protocol Checks

| Surface | Evidence |
| --- | --- |
| Hosted Streamable HTTP MCP | `node --import tsx --test tests/web/**/*.test.ts` covers initialization and curated tool listing. |
| Hosted anonymous public reads | Hosted `/mcp` allows no-bearer public read tools through the `anonymous_mcp_public_read` route class. |
| Hosted OAuth bearer handling | Web MCP and OAuth JWT tests cover MCP-resource audience validation, `mcp:read` scope validation, and protected-resource bearer challenges. |
| Hosted Client ID Metadata Documents | Web OAuth helper tests cover URL-form client IDs, exact `client_id` matching, redirect rejection, response-size limits, and special-use address rejection. |
| Local stdio MCP | `pnpm --filter @basicbit/vrdex-mcp test` runs a JSON-RPC stdio `vrdex_search` call against a local API fixture. |
| Local API token config | `packages/vrdex-mcp` tests cover bearer forwarding to `/api/v0`. |
| Self-hosted base URL config | `packages/vrdex-mcp` tests cover origin and explicit `/api/v0` normalization. |

## Repo Smoke Command

Run this before manual client smokes:

```sh
pnpm smoke:mcp-compat
```

PR Baseline Checks run the same local stdio protocol smoke through
`pnpm verify:vrdex-mcp`.

PR Baseline Checks also run `Hosted MCP Preview Smoke` after the Vercel preview
deployment. When the preview URL exists, that lane runs this smoke against the
preview `/mcp` endpoint for anonymous Streamable HTTP, OAuth metadata, and bearer
challenge coverage. Dynamic Client Registration is enabled only when
`CONVEX_DEPLOY_KEY_PREVIEW` provisions a same-branch Convex preview backend; if
that backend is unavailable, the lane records the DCR prerequisite and still runs
the non-DCR hosted smoke.

The command starts the local stdio MCP package against a local API fixture and
replays initialize, tool-list, and `vrdex_search` calls with protocol profiles
for Claude Desktop, Claude Code, VS Code, Cursor, Devin Desktop / Windsurf
Cascade, and MCP Inspector. It verifies the shared MCP protocol path these
clients use, not the clients' UI or account flows.

To include a deployed hosted MCP endpoint, set:

```sh
VRDEX_MCP_SMOKE_URL=https://staging.vrdex.net/mcp pnpm smoke:mcp-compat
```

The hosted smoke covers anonymous Streamable HTTP initialization/tool listing,
OAuth protected-resource metadata, authorization-server metadata, and the OAuth
protected-resource challenge for invalid bearer tokens. Add
`VRDEX_MCP_SMOKE_DCR=1` when you want the smoke to register a constrained public
MCP client through Dynamic Client Registration. Add
`VRDEX_MCP_SMOKE_TOKEN=<mcp-resource-token>` only for a local terminal run when
you want to test an authenticated hosted tool list. Do not commit real tokens
or smoke output containing credentials.

## Day-One Client Matrix

| Client | Local stdio config | Hosted HTTP config | OAuth expectation | Current status |
| --- | --- | --- | --- | --- |
| Claude Desktop | Uses `mcpServers` JSON with `command`, `args`, and optional `env`. | Remote setup should use Claude's current Custom Connector path. | Hosted `/mcp` should complete OAuth through protected-resource metadata. | Local stdio protocol smoke covered by `pnpm smoke:mcp-compat`; hosted manual smoke pending. |
| Claude Code | Supports stdio with `claude mcp add --transport stdio`. | Supports HTTP with `claude mcp add --transport http`. | Supports OAuth from `/mcp` or `claude mcp login`; DCR and public-client CIMD are implemented. | Local stdio protocol smoke covered by `pnpm smoke:mcp-compat`; hosted command shape ready; manual smoke pending. |
| VS Code | Uses `.vscode/mcp.json` or user MCP config with `servers` entries. | Supports `type: "http"` and `url`. | Avoid hardcoded secrets; use inputs or environment files. OAuth manual smoke pending. | Local stdio protocol smoke covered by `pnpm smoke:mcp-compat`; config snippets ready; manual smoke pending. |
| Cursor | Treat local stdio as a required smoke target if the current release still supports command-based MCP config. | Treat hosted HTTP as a required smoke target if the current release supports remote MCP URLs. | Confirm current OAuth behavior during manual smoke. | Local stdio protocol smoke covered by `pnpm smoke:mcp-compat`; do not publish Cursor-specific snippets until the current docs or smoke run confirm them. |
| OpenAI and ChatGPT MCP-capable surfaces | Treat local stdio as unsupported until the current product surface says otherwise. | Use hosted remote MCP when ChatGPT Apps, deep research, or API integration setup supports custom MCP servers. | Current OpenAI docs recommend CIMD when the authorization server supports it and keep DCR as a supported path when configured; VRDex implements both DCR and public-client CIMD. | Hosted remote MCP target identified; exact setup must be verified in the relevant OpenAI surface before launch docs publish snippets. |
| Devin Desktop / Windsurf Cascade | Uses `mcp_config.json` with `mcpServers`. | Supports `serverUrl` or `url` for remote HTTP MCPs. | Docs state OAuth support for stdio, Streamable HTTP, and SSE. | Local stdio protocol smoke covered by `pnpm smoke:mcp-compat`; hosted config shape ready; manual smoke pending. |
| MCP Inspector | Use as a protocol-level stdio debugger. | Connect directly to hosted `/mcp` for remote debugging. | Exercise anonymous and OAuth paths separately. | Local stdio protocol smoke covered by `pnpm smoke:mcp-compat`; manual hosted diagnostic smoke pending. |

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

0. Run `pnpm smoke:mcp-compat`; for hosted protocol coverage, include
   `VRDEX_MCP_SMOKE_URL` pointed at the deployed preview or production-like
   `/mcp` endpoint. Add `VRDEX_MCP_SMOKE_DCR=1` when the smoke should create a
   temporary dynamic public MCP client.
1. Claude Desktop local stdio starts, lists six tools, and calls
   `vrdex_search`.
2. Claude Desktop hosted Custom Connector lists anonymous tools and completes
   OAuth for `mcp:read` when protected tools are enabled.
3. Claude Code local stdio starts, hosted HTTP anonymous tool listing works,
   and hosted OAuth completes with `mcp:read` through DCR and public-client
   CIMD.
4. VS Code local stdio lists six tools and hosted HTTP anonymous reads work.
5. Cursor local stdio and hosted HTTP read tools work in the current release.
6. OpenAI or ChatGPT MCP-capable surfaces connect to hosted `/mcp` if the
   current product supports custom remote MCP connectors. Record whether the
   connector accepts DCR, requires Client ID Metadata Documents, or follows a
   reviewed app submission path.
7. Devin Desktop or Windsurf Cascade local stdio and hosted HTTP read tools
   work; OAuth is tested when team MCP access allows it.
8. MCP Inspector hosted anonymous read and OAuth-protected read paths return
   expected tool lists and errors.

For each smoke, record client version, OS, transport, auth mode, result, exact
config shape, and issue link if it fails. Keep real tokens out of docs, logs,
and screenshots.

## Source Trail

- [MCP local server guide](https://modelcontextprotocol.io/docs/develop/connect-local-servers)
- [MCP remote server guide](https://modelcontextprotocol.io/docs/develop/connect-remote-servers)
- [MCP overview](https://modelcontextprotocol.io/docs/getting-started/intro)
- [MCP Inspector](https://modelcontextprotocol.io/docs/tools/inspector)
- [Claude Code MCP docs](https://docs.anthropic.com/en/docs/claude-code/mcp)
- [VS Code MCP servers](https://code.visualstudio.com/docs/agent-customization/mcp-servers)
- [Devin Desktop / Windsurf Cascade MCP](https://docs.devin.ai/desktop/cascade/mcp)
- [OpenAI MCP and Connectors](https://platform.openai.com/docs/mcp)
