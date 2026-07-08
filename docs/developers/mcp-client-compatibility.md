# MCP Client Compatibility Matrix

## Status

Implementation-time compatibility matrix for the public API and MCP platform
foundation.

Last reviewed: 2026-07-08.

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
`vrdex_search` tool call and structured result. The default hosted command keeps
the lightweight empty-query transport check:

```sh
pnpm smoke:mcp-claude-code -- \
  --mode hosted-http \
  --hosted-url https://staging.vrdex.net/mcp
```

For external-readiness evidence, add `--hosted-data` so the real Claude Code
client must call a non-empty public search and receive structured content from
the target backend:

```sh
pnpm smoke:mcp-claude-code -- \
  --mode hosted-http \
  --hosted-url https://staging.vrdex.net/mcp \
  --hosted-data
```

Use `--hosted-query`, `--hosted-type`, and `--hosted-limit` when the staging
seed data needs a different public search fixture. The equivalent environment
variables are `VRDEX_CLAUDE_CODE_HOSTED_DATA`,
`VRDEX_CLAUDE_CODE_HOSTED_QUERY`, `VRDEX_CLAUDE_CODE_HOSTED_TYPE`, and
`VRDEX_CLAUDE_CODE_HOSTED_LIMIT`.

For Claude Code hosted OAuth evidence, prefer a reviewed OAuth app that allows
the Client Credentials grant and `mcp:read`. Set
`VRDEX_MCP_OAUTH_CLIENT_ID` and `VRDEX_MCP_OAUTH_CLIENT_SECRET`, or the
client-specific `VRDEX_CLAUDE_CODE_OAUTH_CLIENT_ID` and
`VRDEX_CLAUDE_CODE_OAUTH_CLIENT_SECRET`, before running the hosted smoke. The
script exchanges those credentials at `/oauth/token` for the hosted `/mcp`
resource, writes the resulting short-lived bearer token only to a temporary MCP
config, validates an authenticated `vrdex_search` call, suppresses MCP debug
logging for that authenticated run, and does not print the token or client
secret:

```sh
VRDEX_MCP_OAUTH_CLIENT_ID="<reviewed-client-id>" \
VRDEX_MCP_OAUTH_CLIENT_SECRET="<client-secret>" \
  pnpm smoke:mcp-claude-code -- \
    --mode hosted-http \
    --hosted-url https://staging.vrdex.net/mcp \
    --hosted-data
```

If an operator already has a short-lived MCP-resource token with `mcp:read`,
`VRDEX_CLAUDE_CODE_OAUTH_TOKEN` remains supported as a fallback.

Pair that Claude Code run with `pnpm smoke:mcp-compat -- --hosted-only
--hosted-url <target> --hosted-data --dcr --cimd` when recording the
`claude-code/hosted-oauth` matrix row, so the evidence covers both DCR/CIMD
protocol behavior and an authenticated client call.

Gemini CLI also has a real-client harness. In local stdio mode, it writes a
temporary `.gemini/settings.json`, starts the repo API fixture, runs Gemini CLI
headlessly with stream-json output, calls `vrdex_search`, and fails unless the
fixture receives the expected search request:

```sh
pnpm smoke:mcp-gemini-cli
```

If Gemini CLI is not installed globally, run the current package through
`npx` without making a permanent install:

```sh
pnpm smoke:mcp-gemini-cli -- --gemini-package @google/gemini-cli@latest
```

On Windows, the disposable package path is routed through `cmd.exe` so the
smoke does not trip Node's `spawn EINVAL` behavior for `.cmd` shims. A
2026-07-08 local preflight reached Gemini CLI `0.49.0` through
`--gemini-package @google/gemini-cli@0.49.0`; the remaining local prerequisite
was Gemini authentication through a CLI auth method, `GEMINI_API_KEY`, Vertex
AI, or Google Cloud Assist.

In hosted HTTP mode, the harness points Gemini CLI at a deployed Streamable
HTTP MCP endpoint and parses stream-json output for the `vrdex_search` call and
structured result:

```sh
pnpm smoke:mcp-gemini-cli -- \
  --mode hosted-http \
  --hosted-url https://staging.vrdex.net/mcp \
  --hosted-data
```

Use `--hosted-query`, `--hosted-type`, and `--hosted-limit` when the staging
seed data needs a different public search fixture. The equivalent environment
variables are `VRDEX_GEMINI_CLI_HOSTED_DATA`,
`VRDEX_GEMINI_CLI_HOSTED_QUERY`, `VRDEX_GEMINI_CLI_HOSTED_TYPE`, and
`VRDEX_GEMINI_CLI_HOSTED_LIMIT`.

For Gemini CLI hosted OAuth evidence, prefer the current client's native OAuth
discovery and `/mcp auth` behavior when collecting interactive evidence. For a
repeatable token-backed smoke, set `VRDEX_MCP_OAUTH_CLIENT_ID` and
`VRDEX_MCP_OAUTH_CLIENT_SECRET`, or the client-specific
`VRDEX_GEMINI_CLI_OAUTH_CLIENT_ID` and
`VRDEX_GEMINI_CLI_OAUTH_CLIENT_SECRET`, before running the hosted smoke. The
script exchanges those credentials for a short-lived MCP-resource token, writes
it only to a temporary Gemini settings file as an HTTP `Authorization` header,
validates an authenticated `vrdex_search` call, and does not print the token or
client secret. `VRDEX_GEMINI_CLI_OAUTH_TOKEN` is also supported as a fallback.

Pair the Gemini OAuth run with `pnpm smoke:mcp-compat -- --hosted-only
--hosted-url <target> --hosted-data --dcr --cimd` when recording the
`gemini-cli/hosted-oauth` matrix row, so the evidence covers both DCR/CIMD
protocol behavior and an authenticated client call.

MCP Inspector has a hosted CLI wrapper that runs `npx --yes
@modelcontextprotocol/inspector`, validates the hosted tool list, and confirms
each public read tool advertises `noauth` plus optional `oauth2` metadata:

```sh
pnpm smoke:mcp-inspector -- \
  --hosted-url https://staging.vrdex.net/mcp
```

For external-readiness evidence, add `--hosted-data` so Inspector must call a
non-empty public search against the target backend:

```sh
pnpm smoke:mcp-inspector -- \
  --hosted-url https://staging.vrdex.net/mcp \
  --hosted-data
```

Use `--query`, `--type`, and `--limit` when the staging seed data needs a
different public search fixture. The equivalent environment variables are
`VRDEX_MCP_INSPECTOR_HOSTED_DATA`, `VRDEX_MCP_INSPECTOR_QUERY`,
`VRDEX_MCP_INSPECTOR_TYPE`, and `VRDEX_MCP_INSPECTOR_LIMIT`.

For Inspector hosted OAuth evidence, prefer the same reviewed OAuth app client
credentials path. Set `VRDEX_MCP_OAUTH_CLIENT_ID` and
`VRDEX_MCP_OAUTH_CLIENT_SECRET`, or the client-specific
`VRDEX_MCP_INSPECTOR_OAUTH_CLIENT_ID` and
`VRDEX_MCP_INSPECTOR_OAUTH_CLIENT_SECRET`, before running the same smoke. The
script exchanges those credentials for a short-lived MCP-resource token,
passes that token as an HTTP `Authorization` header, validates an authenticated
`tools/list`, and does not print the token or client secret:

```sh
VRDEX_MCP_OAUTH_CLIENT_ID="<reviewed-client-id>" \
VRDEX_MCP_OAUTH_CLIENT_SECRET="<client-secret>" \
  pnpm smoke:mcp-inspector -- \
    --hosted-url https://staging.vrdex.net/mcp \
    --hosted-data
```

If an operator already has a short-lived MCP-resource token with `mcp:read`,
`VRDEX_MCP_INSPECTOR_OAUTH_TOKEN` remains supported as a fallback.

Pair that Inspector run with `pnpm smoke:mcp-compat -- --hosted-only
--hosted-url <target> --hosted-data --dcr --cimd` when recording the
`mcp-inspector/hosted-oauth` matrix row, so the evidence covers both
DCR/CIMD protocol behavior and an authenticated `mcp:read` client call.

OpenAI Responses API remote MCP has a hosted anonymous-read harness. It sends a
remote MCP tool definition with `server_url`, constrains `allowed_tools` to
`vrdex_search`, sets `require_approval` to `never`, and fails unless the
Responses payload includes both the MCP tool call and the expected final
answer:

```sh
OPENAI_API_KEY="<api-key>" \
  pnpm smoke:mcp-openai -- \
    --hosted-url https://staging.vrdex.net/mcp \
    --hosted-data
```

This is OpenAI API integration evidence, not ChatGPT Apps/Connectors UI
evidence. Keep the ChatGPT product-surface row pending until the current UI
surface proves whether public read tools stay anonymous/no-auth and how hosted
OAuth behaves.

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
profiles for Claude Desktop, Claude Code, Gemini CLI, VS Code, Cursor, Devin
Desktop / Windsurf Cascade, and MCP Inspector. It verifies the shared MCP
protocol path these clients use, not the clients' UI or account flows.

The manual smoke result artifact is
`docs/developers/mcp-client-smoke-results.json`. `pnpm verify:vrdex-mcp`
validates that the artifact still lists every required day-one client and
required smoke row. Run this explicit check when updating matrix evidence:

```sh
pnpm check:mcp-client-matrix
```

Generate the next smoke-run plan from the current matrix before coordinating
manual client sessions:

```sh
pnpm ops:mcp-client-smokes -- \
  --hosted-url https://staging.vrdex.net/mcp
```

The planner prints every pending required row, the repo preflight command to
run first, client-specific setup hints, the client-side evidence to capture,
the production-like hosted MCP evidence rows, and the exact recorder command
shapes for recording passes. It starts with a Pending Blocker Summary that
groups remaining rows by the operator prerequisite that unlocks them: installed
app tool-call sessions, installed app OAuth sessions, missing client install or
account setup, desktop/custom connector access, hosted product surface access,
hosted protocol target evidence, or OAuth smoke credentials. Setup hints are
not evidence by themselves; record a matrix row only after the real client
lists tools and calls `vrdex_search` or completes the required `mcp:read` OAuth
path. Add `--include-passed` when producing a full day-one evidence packet
instead of only the pending work.

Before coordinating desktop/client sessions on a local machine, run the
installed-client preflight:

```sh
pnpm ops:mcp-installed-clients
```

This read-only check records the detected Claude Code, Gemini CLI, VS Code,
Cursor, and Windsurf CLI versions, verifies that installed clients still expose
the MCP configuration surface their matrix rows depend on, reports Claude
Desktop process or common app-path availability on Windows, and reports whether
OpenAI Responses API, Gemini CLI auth, and hosted OAuth smoke credential
variables are present. It also reports whether the `deployed-health.yml`
hosted-mcp-smoke workflow has the temporary OAuth credential-generation gate
configured through `VRDEX_HOSTED_E2E_AUTH_HELPERS`,
`VRDEX_HOSTED_E2E_DEVELOPER_CREDENTIALS`, and
`VRDEX_HOSTED_E2E_BROWSER_TOKEN`. It prints variable names only, never secret
values. The credential tables read the current process environment only; use
`pnpm ops:mcp-hosted-oauth-prereqs` below for the repository variable/secret
audit. It does not write client configuration, launch GUI smoke sessions, call
provider APIs, or turn any manual row green by itself. Use it to catch local
client drift and OAuth/model-provider evidence blockers before the human smoke
pass.

The preflight also prints informational CLI automation notes for installed
VS Code-family clients. On the current Windows CLIs, VS Code `chat` and Cursor
`--chat`/`agent` can open or advertise agent surfaces, but their help output
does not expose a stdout transcript or tool-call export path suitable for
matrix evidence; VS Code `chat` also warns that `--user-data-dir` is not a
known chat option. Windsurf exposes `--add-mcp` but no chat or agent subcommand.
Those notes are useful for choosing the manual smoke path, not for recording
passes.

After the preflight, generate a disposable smoke-session pack for installed
VS Code-family clients and Gemini CLI, plus manual-only worksheets for hosted
product surfaces, missing desktop apps, and OAuth rows that need reviewed
credentials:

```sh
pnpm ops:mcp-client-session-pack -- \
  --hosted-url https://staging.vrdex.net/mcp
```

The pack is written to `.tmp-gh-artifacts/mcp-client-smoke-session/` by
default. PR Baseline Checks also upload this directory as the
`mcp-client-session-pack` artifact after `pnpm verify:vrdex-mcp`, using the
staging hosted MCP target. It contains compact `--add-mcp` JSON definitions for
VS Code, Cursor, and Windsurf plus Gemini CLI `settings.json` snippets for local
stdio, hosted anonymous HTTP, and hosted token-header fallback setups. It also
includes manual-only worksheets for Claude Desktop, Claude Code hosted OAuth,
OpenAI/ChatGPT hosted rows, and MCP Inspector hosted OAuth. The generated
VS Code, Cursor, and Windsurf PowerShell commands use an isolated
`--user-data-dir` and escape JSON quotes before passing `--add-mcp`; direct
fresh-profile `--add-mcp` and raw `(Get-Content -Raw ...)` JSON both fail on
the current Windows CLIs. The generated
README includes the same Pending Blocker Summary as the smoke planner so the
downloaded artifact can be used directly for smoke-session batching. The
generated `evidence/` templates are pending worksheets for each row; fill them
with sanitized real-client screenshot or transcript evidence before running the
recorder command. The pack is not evidence by itself; use it to run the real
client session and then record the matrix row only after the client lists tools
and calls `vrdex_search` or completes the required `mcp:read` OAuth path.
Completed worksheets can be recorded directly:

```sh
pnpm record:mcp-client-smoke -- \
  --evidence-file .tmp-gh-artifacts/mcp-client-smoke-session/evidence/vscode-hosted-anonymous-read.md
```

The worksheet recorder infers the matrix row, environment, target environment,
status, and evidence summary from the file. It rejects untouched `pending`
worksheets, generated placeholder text, placeholder target values, and evidence
summaries that appear to contain tokens, secrets, or authorization headers.
The session-pack generator reads
`docs/developers/mcp-client-smoke-results.json` by default and fails if any
required row that is not already `pass` lacks a generated worksheet. Use
`--matrix <path>` or `VRDEX_MCP_CLIENT_MATRIX_PATH=<path>` when rehearsing a
matrix change against a temporary copy.

Before opening the installed VS Code-family apps for manual evidence, run the
isolated add-MCP preflight against the generated JSON shapes:

```sh
pnpm ops:mcp-add-mcp-preflight -- \
  --hosted-url https://staging.vrdex.net/mcp
```

This writes disposable config and user-data directories under
`.tmp-gh-artifacts/mcp-client-add-mcp-preflight/`, then asks VS Code, Cursor,
and Windsurf to accept local stdio, hosted anonymous HTTP, and hosted
token-header fallback definitions. Missing clients are skipped unless
`--require-installed` is set. A passing preflight proves only that the current
CLI accepts the setup definitions; it is still not matrix evidence because it
does not list tools or call `vrdex_search` inside the app.

Latest local preflight: on 2026-07-08,
`pnpm ops:mcp-installed-clients` detected VS Code 1.127.0, Cursor 3.10.17,
and Windsurf 1.110.1. `pnpm ops:mcp-add-mcp-preflight -- --hosted-url
https://staging.vrdex.net/mcp --require-installed` passed all generated
local-stdio, hosted-anonymous-read, and hosted-token-fallback definitions for
those installed clients. Those rows remain pending until the real app session
lists tools and calls `vrdex_search`.

The same installed-client preflight reports that those CLIs remain manual-only
for evidence capture: setup and chat launch success are not enough unless the
client session itself shows the VRDex tool list and a `vrdex_search` result.

Record manual pass or fail results with the recorder command instead of
hand-editing the JSON:

```sh
pnpm record:mcp-client-smoke -- \
  --client mcp-inspector \
  --check hosted-anonymous-read \
  --status pass \
  --environment "Windows 11 / MCP Inspector <version> / https://vrdex.net/mcp" \
  --target-environment "production-like staging https://vrdex.net/mcp" \
  --evidence "sanitized screenshot or PR evidence link"
```

Use `--matrix <path>` or `VRDEX_MCP_CLIENT_MATRIX_PATH=<path>` to rehearse an
update against a temporary copy before writing the canonical matrix. A `pass`
or `fail` entry requires an environment and evidence pointer; `pending` clears
run evidence; `not_applicable` requires notes and is allowed only for rows that
are not required for external readiness. Generated recorder commands are
templates: replace every `<placeholder>` value before running them. The
recorder and verifier reject placeholder evidence, environment, or target text
for pass/fail rows.

For required hosted rows, a `pass` also requires `--target-environment` naming
a same-branch Convex preview, staging, production-like, or production target.
The recorder and matrix verifier reject hosted pass rows that still describe
pending, skipped, unavailable, or non-data-backed evidence. This keeps
lightweight PR preview transport smokes separate from external-readiness
evidence, even if the JSON artifact is hand-edited.

Record the top-level hosted MCP production-like evidence rows with
`pnpm record:mcp-hosted-evidence` after the corresponding hosted smoke passes:

```sh
pnpm record:mcp-hosted-evidence -- \
  --check hosted-data-backed-anonymous-read \
  --status pass \
  --target-environment "production-like staging https://vrdex.net/mcp" \
  --environment "GitHub Actions / hosted-mcp-smoke" \
  --evidence "sanitized workflow link or command output"
```

The required hosted evidence rows are:

- `hosted-data-backed-anonymous-read`
- `hosted-dynamic-client-registration`
- `hosted-client-id-metadata-document`

Current PR #159 status: all three hosted evidence rows are recorded as `pass`
against `https://staging.vrdex.net/mcp`. Hosted MCP health run `28949509629`
job `85892143714` refreshed data-backed public reads, DCR, and CIMD from PR
head `ebf4e8d` on 2026-07-08. That run also exercised the `mcp_oauth=true`
workflow path and skipped Inspector OAuth because repository smoke secrets were
absent and `VRDEX_HOSTED_E2E_DEVELOPER_CREDENTIALS` was not enabled.

The `deployed-health.yml` `hosted-mcp-smoke` workflow can additionally run the
Inspector hosted OAuth smoke when dispatched with `mcp_oauth=true`. It prefers
repository secrets that provide either `VRDEX_MCP_OAUTH_CLIENT_ID` plus
`VRDEX_MCP_OAUTH_CLIENT_SECRET` or `VRDEX_MCP_INSPECTOR_OAUTH_TOKEN`. If those
secrets are absent on a staging or same-branch target, the workflow can mint a
temporary reviewed smoke client through the same helper below when
`VRDEX_HOSTED_E2E_AUTH_HELPERS=true`,
`VRDEX_HOSTED_E2E_DEVELOPER_CREDENTIALS=true`, and
`VRDEX_HOSTED_E2E_BROWSER_TOKEN` is configured. The workflow leaves
anonymous/data/DCR/CIMD evidence runnable even when reviewed OAuth smoke
credentials and helper prerequisites are absent.

When staging E2E auth helpers are enabled but those repository secrets have not
yet been installed, an operator can mint a temporary reviewed smoke client
through the normal hosted developer app flow:

```sh
VRDEX_E2E_BROWSER_TOKEN="<browser-token>" \
  pnpm ops:mcp-oauth-smoke-credentials -- \
    --base-url https://staging.vrdex.net
```

The helper creates a verified E2E account through the existing gated auth
helpers, creates a confidential OAuth app with `client_credentials` and
`mcp:read`, verifies the token endpoint, and writes ignored PowerShell/Bash env
files under `.tmp-gh-artifacts/mcp-oauth-smoke-credentials/`. It prints the
client id and file paths only; the one-time client secret is written only to the
ignored env files. Source the generated env file, then run the Claude Code and
Inspector hosted OAuth smokes before recording the two matrix rows. The helper
fails closed unless the hosted target has `VRDEX_ENABLE_E2E_HELPERS`,
`VRDEX_ENABLE_E2E_AUTH_HELPERS`, the matching browser token, and the server-side
E2E Convex secret configured. It refuses production origins unless
`--allow-production` is passed for an explicit emergency operator run.

Before dispatching the workflow for hosted OAuth evidence, audit the repository
prerequisites:

```sh
pnpm ops:mcp-hosted-oauth-prereqs
```

That read-only check uses `gh variable list` and `gh secret list` for the
selected repository, then reports whether the hosted OAuth path can use
reviewed `VRDEX_MCP_OAUTH_CLIENT_ID` / `VRDEX_MCP_OAUTH_CLIENT_SECRET`
secrets or the temporary credential-generation gate
(`VRDEX_HOSTED_E2E_AUTH_HELPERS=true`,
`VRDEX_HOSTED_E2E_DEVELOPER_CREDENTIALS=true`, and
`VRDEX_HOSTED_E2E_BROWSER_TOKEN`). It prints only variable/secret names plus
boolean readiness, never secret values. Add `--require-ready` when the audit
should fail until one of those complete paths is configured.

Current PR #159 audit result from 2026-07-08: hosted OAuth evidence is
`partial`. Reviewed OAuth client secrets are missing, the Inspector token
fallback is missing, and temporary credential generation is one gate short:
`VRDEX_HOSTED_E2E_AUTH_HELPERS=true` and
`VRDEX_HOSTED_E2E_BROWSER_TOKEN` is present, but
`VRDEX_HOSTED_E2E_DEVELOPER_CREDENTIALS` is not enabled. Keep that variable
unset until staging has the developer token routes, OAuth app registration
routes, and OAuth token endpoint under test; after enabling it, rerun the audit
and dispatch `deployed-health.yml` with `target=hosted-mcp-smoke` and
`mcp_oauth=true` before recording hosted-OAuth client rows.

These rows are checked separately from manual client UI rows so a lightweight
PR preview transport smoke cannot accidentally satisfy the production-like
data-backed, DCR, and CIMD readiness gate.

By default, the check accepts `pending` manual rows because repository protocol
checks can run before the desktop/web client smokes are available. For external
readiness, require every required manual row to pass:

```sh
pnpm check:mcp-client-matrix -- --require-ready
```

For the broader public API/MCP launch audit, run:

```sh
pnpm check:api-mcp-rollout
```

That command summarizes the generated OpenAPI artifact, required docs,
verification scripts, manual MCP matrix, and hosted production-like evidence
state. Use `--require-ready` only when the PR is being declared externally
ready; it fails while required client rows or hosted data/DCR/CIMD/OAuth
evidence are still pending.

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
of a tool error. When a data-backed tool call fails, the smoke prints a
sanitized summary of the MCP error content to make backend, fixture, and tool
contract failures easier to distinguish. Add `--hosted-only` when you are
rechecking a remote target and do not need the local stdio profile sweep. Add
`--continue-on-failure` for production-like readiness diagnostics when you want
the data-backed read, DCR, and CIMD probes to keep running after one selected
subcheck fails; the command still exits non-zero if any selected probe fails.
Add `--dcr` when you want the smoke to register a
constrained public MCP client through Dynamic Client Registration. Add `--cimd`
when you want the smoke to exercise a URL-form public client id against
`GET /oauth/authorize`; the smoke uses
`/.well-known/oauth-client/vrdex-mcp-public-client` and expects the
unauthenticated sign-in redirect after metadata validation succeeds.

The equivalent environment variables remain supported for CI:
`VRDEX_MCP_SMOKE_URL`, `VRDEX_MCP_SMOKE_DATA`, `VRDEX_MCP_SMOKE_DCR`,
`VRDEX_MCP_SMOKE_CIMD`, and `VRDEX_MCP_SMOKE_CONTINUE_ON_FAILURE`. Set
`VRDEX_MCP_SMOKE_TOKEN` only for a local terminal run when you want to test an
authenticated hosted tool list. Do not commit real tokens or smoke output
containing credentials.

GitHub also has a manual `Deployed Health Checks` workflow target named
`hosted-mcp-smoke` for production-like or same-branch Convex preview targets.
Use it when `Hosted MCP Preview Smoke` cannot enable data-backed reads, DCR, or
CIMD because the PR preview lacks `CONVEX_DEPLOY_KEY_PREVIEW`, or when
validating a staging target before external readiness. That manual workflow
keeps selected hosted diagnostics running after a subcheck failure so the run
log can distinguish backend data, DCR, and CIMD blockers in one attempt.

## Day-One Client Matrix

| Client | Local stdio config | Hosted HTTP config | OAuth expectation | Current status |
| --- | --- | --- | --- | --- |
| Claude Desktop | Uses `mcpServers` JSON with `command`, `args`, and optional `env`. | Remote setup should use Claude's current Custom Connector path. | Hosted `/mcp` should complete OAuth through protected-resource metadata. | Local stdio protocol smoke covered by `pnpm smoke:mcp-compat`; hosted manual smoke pending. |
| Claude Code | Supports stdio with `claude mcp add --transport stdio`. | Supports HTTP with `claude mcp add --transport http`. | Supports OAuth from `/mcp` or `claude mcp login`; reviewed-app client-credentials token acquisition and token-backed header auth are available as evidence paths. DCR and public-client CIMD are implemented. | Local stdio and staging data-backed hosted anonymous reads pass through `pnpm smoke:mcp-claude-code`; hosted OAuth has a client-credentials smoke harness and remains pending until evidence is recorded. |
| Gemini CLI | Uses `settings.json` `mcpServers` entries with `command` for stdio. | Supports Streamable HTTP through `httpUrl` and SSE through `url`. | Supports OAuth 2.0 for remote MCP, automatic discovery, Dynamic Client Registration, `/mcp auth`, and secure token storage; token-backed fallback evidence is available through the Gemini smoke harness. | Local stdio protocol smoke covered by `pnpm smoke:mcp-compat`; exact Gemini CLI rows now have `pnpm smoke:mcp-gemini-cli` as the repeatable real-client path and remain pending until Google-authenticated evidence is recorded. |
| VS Code | Uses `.vscode/mcp.json` or user MCP config with `servers` entries. | Supports `type: "http"` and `url`. | Avoid hardcoded secrets; use inputs or environment files. OAuth manual smoke pending. | Local stdio protocol smoke covered by `pnpm smoke:mcp-compat`; VS Code 1.127.0 accepted all generated `--add-mcp` definitions on 2026-07-08; manual tool-call smoke pending. |
| Cursor | Treat local stdio as a required smoke target if the current release still supports command-based MCP config. | Treat hosted HTTP as a required smoke target if the current release supports remote MCP URLs. | Confirm current OAuth behavior during manual smoke. | Local stdio protocol smoke covered by `pnpm smoke:mcp-compat`; Cursor 3.10.17 accepted all generated `--add-mcp` definitions on 2026-07-08; manual tool-call smoke pending. |
| OpenAI and ChatGPT MCP-capable surfaces | Treat local stdio as unsupported until the current product surface says otherwise. | Use hosted remote MCP when ChatGPT Apps, deep research, or API integration setup supports custom MCP servers. | Current OpenAI docs recommend CIMD when the authorization server supports it and keep DCR as a supported path when configured; VRDex implements both DCR and public-client CIMD. Public read tools advertise `_meta["securitySchemes"]` with `noauth` plus optional `oauth2`. | `pnpm smoke:mcp-openai` can prove Responses API hosted anonymous-read integration when `OPENAI_API_KEY` is available; ChatGPT Apps/Connectors UI and hosted OAuth behavior remain pending until product-surface evidence is recorded. |
| Devin Desktop / Windsurf Cascade | Uses `mcp_config.json` with `mcpServers`. | Supports `serverUrl` or `url` for remote HTTP MCPs. | Docs state OAuth support for stdio, Streamable HTTP, and SSE. | Local stdio protocol smoke covered by `pnpm smoke:mcp-compat`; Windsurf 1.110.1 accepted all generated `--add-mcp` definitions on 2026-07-08; manual tool-call smoke pending. |
| MCP Inspector | Use as a protocol-level stdio debugger; local stdio `vrdex_search` is manually verified in the smoke matrix. | Connect directly to hosted `/mcp` for remote debugging; `pnpm smoke:mcp-inspector` validates hosted tool listing and auth metadata. | Use reviewed-app client credentials or `VRDEX_MCP_INSPECTOR_OAUTH_TOKEN` fallback to validate authenticated hosted `tools/list`; pair with the DCR/CIMD protocol smoke. | Local stdio and staging data-backed hosted anonymous read smokes pass through `pnpm smoke:mcp-inspector`; hosted OAuth remains pending until authenticated evidence is recorded. |

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

Start by generating the current plan:

```sh
pnpm ops:mcp-client-smokes -- \
  --hosted-url <preview-or-production-like-/mcp-url>
```

0. Run `pnpm smoke:mcp-compat`; for hosted protocol coverage, add
   `--hosted-url <preview-or-production-like-/mcp-url>`. Use `--hosted-only`
   for focused remote-target retries. Add `--hosted-data` when the deployed
   target has same-branch or production-like Convex functions and indexes. Add
   `--dcr` when the smoke should create a temporary dynamic public MCP client,
   and `--cimd` when the smoke should materialize the public client metadata
   document flow through `/oauth/authorize`. For GitHub-hosted evidence against
   a deployed target, run the manual `Deployed Health Checks` workflow with
   target `hosted-mcp-smoke`, `base_url=<target-/mcp-url>`, and the matching
   `mcp_data`/`mcp_dcr`/`mcp_cimd` toggles. Add `mcp_oauth=true` when the run
   should use configured repository OAuth smoke secrets or mint temporary
   staging smoke credentials from the hosted E2E auth/developer helper path.
   PR #159's 2026-07-08 repository audit shows that OAuth subcheck remains
   gated until reviewed OAuth smoke secrets are installed or
   `VRDEX_HOSTED_E2E_DEVELOPER_CREDENTIALS=true` is enabled alongside the
   already-present hosted auth-helper inputs.
1. Claude Desktop local stdio starts, lists six tools, and calls
   `vrdex_search`.
2. Claude Desktop hosted Custom Connector lists anonymous tools and completes
   OAuth for `mcp:read` when protected tools are enabled.
3. Claude Code local stdio and hosted HTTP anonymous reads pass through
   `pnpm smoke:mcp-claude-code`; hosted anonymous readiness uses
   `--hosted-data` for a data-backed non-empty search against the target
   backend. Hosted OAuth either completes interactively through `claude mcp
   login`, uses reviewed OAuth app client credentials, or uses
   `VRDEX_CLAUDE_CODE_OAUTH_TOKEN` fallback for an authenticated smoke, paired
   with DCR and public-client CIMD protocol evidence.
4. Gemini CLI local stdio lists six tools through `/mcp`, hosted anonymous
   reads work through `httpUrl`, and hosted OAuth succeeds through automatic
   discovery or a documented static OAuth fallback.
5. VS Code local stdio lists six tools and hosted HTTP anonymous reads work.
6. Cursor local stdio and hosted HTTP read tools work in the current release.
7. OpenAI or ChatGPT MCP-capable surfaces connect to hosted `/mcp` if the
   current product supports custom remote MCP connectors. Responses API hosted
   anonymous-read evidence uses `pnpm smoke:mcp-openai` with `OPENAI_API_KEY`;
   `OPENAI_API_KEY` was absent in the 2026-07-08 local process, so no live
   OpenAI pass is recorded yet. Record whether ChatGPT Apps/Connectors accepts
   DCR, requires Client ID Metadata Documents, or follows a reviewed app
   submission path. Also record whether public read tools appear as
   anonymous/no-auth tools instead of forcing OAuth before a safe search.
8. Devin Desktop or Windsurf Cascade local stdio and hosted HTTP read tools
   work; OAuth is tested when team MCP access allows it.
9. MCP Inspector local stdio and hosted anonymous read paths return expected
   tool lists, auth metadata, and data-backed search results. Use
   `pnpm smoke:mcp-inspector -- --hosted-data` for the hosted data-backed row;
   set reviewed OAuth app client credentials or
   `VRDEX_MCP_INSPECTOR_OAUTH_TOKEN` fallback for the hosted OAuth row and pair
   it with the DCR/CIMD hosted protocol smoke.

For rows 4, 5, 6, and 8, start from `pnpm ops:mcp-client-session-pack` so
Gemini CLI, VS Code, Cursor, and Windsurf use the same generated local stdio
and hosted HTTP definitions, prompt, target URL, and recorder-command shape.

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
- [Gemini CLI MCP servers](https://raw.githubusercontent.com/google-gemini/gemini-cli/main/docs/tools/mcp-server.md)
- [VS Code MCP servers](https://code.visualstudio.com/docs/agent-customization/mcp-servers)
- [Devin Desktop / Windsurf Cascade MCP](https://docs.devin.ai/desktop/cascade/mcp)
- [OpenAI MCP and Connectors](https://developers.openai.com/api/docs/mcp)
- [OpenAI Apps SDK authentication](https://developers.openai.com/apps-sdk/build/auth)
- [OpenAI Apps SDK reference](https://developers.openai.com/apps-sdk/reference)
