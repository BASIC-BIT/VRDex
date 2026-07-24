# VRDex MCP Event Writes

## Status

Implementation checkpoint for
[#184](https://github.com/BASIC-BIT/VRDex/issues/184).

The local/private `@basicbit/vrdex-mcp` stdio server can expose authenticated
event-create and event-update tools over the existing `/api/v0` routes. The
hosted `/mcp` implementation remains anonymous-capable and read-only; it does
not register these tools.

The real Faceless production proof is still operator gated. Do not create a
fake production event or execute a real write until the operator has selected
the event data and approved that exact tool call.

## Tools

### `vrdex_event_create`

Creates and publishes an event attached to a community owned by the
authenticated user. Its input is the shared `ApiEventCreateRequest` contract.

### `vrdex_event_update`

Updates an owned community event. Its input contains:

- `slug`: the event's current public slug
- `update`: the shared `ApiEventUpdateRequest` contract

Omitted update fields are preserved. Documented nullable fields use `null` to
clear, collection fields use an empty array to clear, and lineup replacements
must supply `participantLinks` and `slotLinks` together.

Both tools:

- are registered only when local stdio has a non-empty bearer credential
- call the public API rather than a private Convex mutation path
- require an API-resource credential with `events:write`, user authority, and
  ownership of the target community
- keep the six public read tools anonymous even when the local server has a
  write credential configured
- are annotated as mutating and open-world so an MCP host can require
  explicit user approval
- read the saved public event back anonymously after an accepted write, so the
  write credential does not also need `public:read`
- return the write identifiers, canonical URL, and normalized public event

Tool annotations are advisory protocol metadata. Operators must use an MCP host
that presents an approval step for mutating tools and inspect the exact
arguments before accepting the call.

## Local Configuration

Create a personal API token at `/developers/tokens` with `events:write`. Add
`community:read` when following the full operator runbook, which verifies the
target community through `/api/v0/me/communities`. Configure the local stdio
server without placing the raw token in repository files:

```json
{
  "mcpServers": {
    "vrdex-private": {
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

An API-resource OAuth access token can be supplied through
`VRDEX_OAUTH_ACCESS_TOKEN` or `VRDEX_OAUTH_TOKEN_FILE`. Hosted `/mcp` tokens are
bound to the MCP resource and cannot be reused for these API-backed local
tools.

If no bearer credential is configured, local stdio lists only the six public
read tools. A present but revoked, expired, under-scoped, wrong-resource, or
wrong-owner credential still lists the tools, but the API rejects every write
before mutation.

## Write And Readback Safety

An accepted mutation is followed by `GET /api/v0/events/:slug`. If that
readback fails, the tool reports that the write already succeeded and tells the
caller not to retry automatically. Inspect the event by its returned slug
before taking another action; blind retries can create a duplicate event or
repeat an audit entry.

Thrown mutation requests and HTTP 5xx mutation responses are also reported as
indeterminate outcomes because the server may have committed before the
response failed. Inspect existing state before retrying either operation.

API problem responses remain structured tool errors. They may include safe
status, title, detail, and retry timing, but never the bearer credential.

## Operator Runbook

Before a real community event write:

1. Use `GET /api/v0/me` to confirm the credential is user-authorized and has
   `events:write` plus `community:read`.
2. Use `GET /api/v0/me/communities` to confirm the target community is claimed
   and owned by that user.
3. Prepare the complete create payload or the minimal update payload.
4. Show the exact tool name and arguments to the operator.
5. Execute only after explicit action-time approval.
6. Confirm the tool's normalized readback and canonical public URL.
7. Open the event in the normal signed-in web UI and verify edit and media
   authority.
8. Record only sanitized evidence. Never paste tokens into issues, logs, docs,
   or screenshots.

For the first Faceless proof, use a real operator-selected event. The proof must
cover MCP write, API/public readback, the public event page, and normal web
edit/media authority. It must not enable VRChat telemetry collection or weaken
the separate provider-approval and non-empty-instance gates.

## Rotation And Revocation

- Revoke a personal token immediately from `/developers/tokens` when it is no
  longer needed or may have been exposed.
- Create a replacement token before updating local MCP configuration.
- Restart the MCP client after rotating the configured credential.
- OAuth access tokens remain short-lived and resource-bound; rotate them
  through the normal authorization and refresh-token flow.
