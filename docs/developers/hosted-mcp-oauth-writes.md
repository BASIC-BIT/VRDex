# Hosted MCP OAuth event writes

## Status

`Locked decision`: the implementation is one default-off feature behind
`VRDEX_HOSTED_MCP_EVENT_WRITES=false`. Production activation and the first
authorized Faceless create/update/readback proof remain a separate operational
rollout. Anonymous hosted reads and the credentialed local stdio bridge remain
available regardless of this flag.

## Authorization contract

VRDex follows the MCP authorization specification for Streamable HTTP:

- `/.well-known/oauth-protected-resource/mcp` identifies the exact MCP resource
  and its authorization server.
- OAuth authorization-code grants use PKCE `S256` and bind authorization and
  token requests to the MCP resource.
- Client ID Metadata Documents are preferred when a client supports them.
  Constrained Dynamic Client Registration remains the compatibility fallback.
- Access tokens include issuer, expiry, resource audience, client ID, token ID,
  and scopes. Every request also checks the durable token/application record so
  revocation takes effect before dispatch.
- Public clients use rotating refresh tokens. Revocation is available at
  `/oauth/revoke`.
- Bearer tokens are accepted only in the `Authorization` header. They are never
  forwarded to Convex or `/api/v0`, returned in tool output, or stored in audit
  records.

When the flag is off, write tools are not registered, protected-resource/CIMD
metadata omits their scopes, DCR rejects them, and authorization rejects an
attempt to request them. When it is on, `vrdex_event_create` and
`vrdex_event_update` advertise OAuth-only security metadata. Calling either
tool requires a user-delegated token for the MCP resource with both
`mcp:write` and `events:write`. A missing token receives `401` plus an
authoritative scope challenge; an invalid token receives `401`; insufficient
scope or a client-credentials subject receives `403`. Anonymous public reads
remain available, and authenticated read calls require `mcp:read`.

The SDK receives `AuthInfo` only after VRDex verifies the token. The raw token
is present in process memory solely because the SDK contract requires it.
Callbacks use only sanitized `extra` fields: durable user ID, OAuth client ID,
token ID, and request ID. Each callback repeats the user/scopes check as
defense in depth.

## Ownership and write semantics

The MCP server does not use a shared API credential. It calls dedicated Convex
mutations with the authenticated VRDex user ID. Those mutations share the same
event normalization and ownership helpers as `/api/v0` and require the user to
own the durable published community record. Registration metadata, consent
copy, or a client-supplied community slug never grants ownership.

Create and update preserve the public API contract introduced with PR #190:

- omitted update properties preserve stored values;
- explicit `null` clears supported optional scalar values;
- empty arrays clear supported collections;
- deterministic validation, ownership, and idempotency conflicts return a
  sanitized rejection and may be corrected without implying a prior commit;
- a successful mutation is read back through the public event query;
- an accepted write whose public readback fails returns a warning and says not
  to retry automatically;
- a transport/commit outcome that cannot be proven returns an indeterminate
  result and says not to retry automatically.

Each call requires an operator-chosen `idempotencyKey`. VRDex stores only its
SHA-256 hash and a canonical request fingerprint. The receipt key is scoped by
user, OAuth client, and tool. An exact replay returns the original accepted
result without another event or audit; reusing the key for different input
fails. Tool annotations deliberately keep `idempotentHint: false`: receipts
make an intentional same-key recovery safe but do not authorize an agent to
retry automatically.

## Controls and observability

- Write traffic uses `authenticated_mcp_write`, limited to 30 requests per
  minute before the normal token/client/user aggregate limits and
  trusted-partner policy.
- `apiWriteAuditEvents` records the accepted mutation, owner, client ID, token
  ID, request ID, tool, idempotency hash, and target IDs.
- `mcpToolEvents` records accepted, denied, indeterminate, or readback-warning outcomes
  without request bodies, raw keys, tokens, event content, or network
  identities.
- Existing OAuth validation events cover invalid, expired, revoked,
  wrong-resource, and under-scoped tokens.
- Rollback is one setting: restore `VRDEX_HOSTED_MCP_EVENT_WRITES=false` and
  redeploy. Reads and the local bridge are unaffected. Existing tokens remain
  revocable but cannot reach a registered write tool.

## Threat model

| Threat | Required control |
| --- | --- |
| Stolen or replayed bearer | Short access-token lifetime, resource audience, durable revocation, header-only transport, token/client/user rate buckets |
| Confused deputy or cross-community write | User-delegated subjects only and a durable owner lookup inside the transaction |
| Scope downgrade or client overreach | Exact `mcp:write events:write` per-call check; DCR/CIMD write scopes unavailable while default-off |
| Duplicate mutation after timeout | Transactional user/client/tool/key receipt plus request fingerprint; no automatic retry |
| Shared-secret blast radius | No master MCP credential and no bearer forwarding |
| Secret/content disclosure | Sanitized errors and attribution-only logs; no token, raw idempotency key, or event body persistence |
| Metadata or redirect abuse | Exact redirect matching, PKCE, CIMD size/deadline/address restrictions, and constrained DCR |

## Verification and client compatibility

Automated coverage must prove:

- default-off tool and metadata omission;
- exact `401`/`403` scope challenges, wrong-resource/expired/revoked rejection,
  and client-credentials rejection;
- conditional DCR and CIMD scope policy;
- per-request `AuthInfo` plumbing with no raw token/key reaching Convex;
- durable ownership rejection;
- create/update omission and null behavior;
- exact replay, fingerprint conflict, and client namespace isolation;
- accepted public readback, readback warning, and indeterminate/no-retry text;
- write rate policy, audit attribution, content-safe event records, and rollback
  to the anonymous-read-only surface.

Before production activation, run the same staged authorization-code flow and a
non-Faceless disposable event against current Codex, Claude, and OpenClaw
clients. Record protected-resource discovery, CIMD or DCR choice, PKCE login,
refresh/relogin behavior, tool listing, user approval, one create, same-key
replay, one update, and public readback. A client that does not perform lazy
`401`/`403` step-up may use its explicit MCP login command; it is a blocker only
if neither native discovery nor explicit login can establish the scoped
session. No matrix row may be marked pass from protocol simulation alone.

The `Staging Deploy` workflow keeps the feature off unless a manual dispatch
explicitly selects `hosted_mcp_event_writes`. Use that staging-only switch for
the client matrix, then dispatch the current `main` revision with the switch
cleared to restore the default-off staging state. The switch is not read by
production deployment workflows and does not authorize any tool call.

| Client | Current preflight | Staged scoped-session evidence |
| --- | --- | --- |
| Codex CLI 0.145.0 | Exact-branch local Streamable HTTP initialization listed `vrdex_event_create` and `vrdex_event_update` without invoking either tool. Supports `codex mcp login/logout`. | Pending same-branch staged scoped login and tool listing. |
| Claude Code 2.1.218 | Exact-branch local HTTP initialization listed `vrdex_event_create` and `vrdex_event_update` without invoking either tool. Supports `claude mcp login/logout`. | Pending same-branch staged scoped login and tool listing. |
| OpenClaw 2026.7.1-2 | Exact-branch isolated-state capability probe listed all ten tools, including `vrdex_event_create` and `vrdex_event_update`, without invoking either tool. Supports OAuth scope/client-metadata configuration and login/logout. | Pending same-branch staged scoped login and tool listing. |

Primary standards:

- [MCP authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)
- [MCP tools](https://modelcontextprotocol.io/specification/2025-11-25/server/tools)
- [OAuth Protected Resource Metadata (RFC 9728)](https://www.rfc-editor.org/rfc/rfc9728)
- [OAuth Resource Indicators (RFC 8707)](https://www.rfc-editor.org/rfc/rfc8707)
