# Hosted MCP OAuth writes

## Status

The hosted write tools ship on. There is no deployment switch in front of them:
the tools are advertised, and the harness connecting decides which it exposes or
calls. What bounds a write is the scope the user granted at consent plus the
per-resource permission checks the browser path already enforces.

Four tools: `vrdex_event_create`, `vrdex_event_update`, `vrdex_profile_update`,
and `vrdex_profile_submit`. Anonymous hosted reads and the credentialed local
stdio bridge are unaffected.

## Scopes

`mcp:write` is the transport half and grants nothing alone -- it says a hosted
session may call write tools at all, not which ones. A client pairs it with the
resource it means to write:

| Tool | Required scopes |
| --- | --- |
| `vrdex_event_create`, `vrdex_event_update` | `mcp:write` + `events:write` |
| `vrdex_profile_update` | `mcp:write` + `profile:write` |
| `vrdex_profile_submit` | `mcp:write` + `profile:contribute` |

`profile:write` is bounded by what its consent screen says: "Edit your profiles".
Reaching a profile the user does not own, whether by correcting an unclaimed one
or by submitting a new one, additionally requires `profile:contribute`, whose
consent line names that wider authority. `vrdex_profile_update` advertises only
`profile:write` because whether the wider grant is needed depends on who owns the
target, which the write discovers; a session without it is refused there with a
message naming the missing scope.

A client that only sets DJ links on profiles its user owns asks for `mcp:read
mcp:write profile:write` and is never able to publish an event under someone's
name. Add `profile:contribute` if it also corrects profiles the user does not
own or submits new ones; without it that client can read every profile and write
only its own. Registration refuses `mcp:write` on its own, and refuses a resource
scope with no `mcp:write`.

## Profile write authority

`vrdex_profile_update` writes a profile the session's user owns, or an unclaimed
profile as a community correction -- the same rule the browser editor and the
API token path apply, resolved in one shared helper so the three cannot drift. A
profile claimed by somebody else is refused with a distinct message telling the
agent to stop rather than retry.

Every update sends `expectedUpdatedAt`, the `updatedAt` of the profile the agent
read, including an update to a profile its user owns. `outboundLinks` replaces
the whole list, so any two writers who each read before either wrote drop the
other's links without either noticing -- and owning a profile does not make you
its only writer, since the same person can have the edit form open in a browser
while the agent writes. A stale pin is refused; re-read and send again.

`vrdex_profile_submit` creates a profile that publishes immediately as unclaimed,
credited to the submitter, with `community_submitted` link provenance. Its
idempotency receipt is load-bearing in a way the edit path's is not: without it a
retried submission creates a second profile under a suffixed slug, and nothing
merges them.

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
- Native loopback callbacks honor RFC 8252 ephemeral-port behavior. For
  interoperability, VRDex treats `localhost`, IPv4 loopback, and IPv6 loopback
  as the same loopback target only when the HTTP scheme, path, and query match;
  PKCE remains mandatory.
- Bearer tokens are accepted only in the `Authorization` header. They are never
  forwarded to Convex or `/api/v0`, returned in tool output, or stored in audit
  records.

Every write tool is registered, and each advertises OAuth-only security metadata
naming `mcp:write` plus the one resource scope from the table above that it
writes. Calling a tool requires a user-delegated token for the MCP resource
carrying that exact pair, so a token holding `mcp:write profile:write` reaches
`vrdex_profile_update` and receives `403` from the event tools and from
`vrdex_profile_submit`, which is advertised against `profile:contribute`. A
missing token
receives `401` plus an authoritative scope challenge; an invalid token receives
`401`; insufficient scope or a client-credentials subject receives `403`.
Anonymous public reads remain available, and authenticated read calls require
`mcp:read`. Constrained DCR accepts `mcp:write` with at least one resource
scope; either half on its own is rejected.

The canonical `/mcp` URL therefore initializes anonymously. Native clients
whose explicit login command only starts OAuth after an initial `401` may use
`/mcp?auth=required`. That opt-in bootstrap URL requires `mcp:read` at
connection time while keeping the token audience and protected resource bound
to canonical `/mcp`; it does not create a second MCP resource or change
anonymous behavior at the canonical URL. Protected write calls still require
both write scopes per call.

The SDK receives `AuthInfo` only after VRDex verifies the token. The raw token
is present in process memory solely because the SDK contract requires it.
Callbacks use only sanitized `extra` fields: durable user ID, OAuth client ID,
token ID, and request ID. Each callback repeats the user/scopes check as
defense in depth.

## Ownership and write semantics

The MCP server does not use a shared API credential. It calls dedicated Convex
mutations with the authenticated VRDex user ID, sharing the same normalization
and authority helpers as `/api/v0`. Registration metadata, consent copy, or a
client-supplied slug never grants authority.

The two write kinds ask different authority questions, and the tools say so:

- event writes require the user to own the durable published community record;
- profile writes require the user to own the profile, or the profile to be
  unclaimed, in which case the write lands as a community correction with
  `community_submitted` link provenance. `slug` stays owner-only either way.

Create and update preserve the public API contract introduced with PR #190:

- omitted update properties preserve stored values;
- explicit `null` clears supported optional scalar values;
- empty arrays clear supported collections;
- deterministic validation, ownership, and idempotency conflicts return a
  sanitized rejection and may be corrected without implying a prior commit;
- a successful mutation is read back through the public event or profile query;
- a profile with no public surface is the one case where a readback is not
  expected. An owner may edit a draft or opted-out profile, so the write result
  carries `publiclyViewable` and the tool omits the read-back profile rather
  than reporting a failure against a write that landed;
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
  trusted-partner policy. A JSON-RPC batch may contain at most one hosted write
  of any kind, event or profile, so one accepted request cannot bypass the
  per-write throttle.
- `apiWriteAuditEvents` records the accepted mutation, owner, client ID, token
  ID, request ID, tool, idempotency hash, and target IDs.
- `mcpToolEvents` records accepted, denied, indeterminate, or readback-warning outcomes
  without request bodies, raw keys, tokens, event content, or network
  identities.
- Existing OAuth validation events cover invalid, expired, revoked,
  wrong-resource, and under-scoped tokens.
- Authorization-code exchange failures log only a bounded rejection category;
  client IDs, codes, verifiers, redirects, resources, and scopes are omitted.
- Rollback is per credential, not per deployment: revoke the OAuth application
  or the user's grant. There is deliberately no kill switch, because one that
  defaults off strands every write client on any environment that forgets to set
  it -- which is what the previous `VRDEX_HOSTED_MCP_EVENT_WRITES` flag did.

## Threat model

| Threat | Required control |
| --- | --- |
| Stolen or replayed bearer | Short access-token lifetime, resource audience, durable revocation, header-only transport, token/client/user rate buckets |
| Confused deputy or cross-community write | User-delegated subjects only and a durable owner lookup inside the transaction |
| Community edit used to hijack a claimed identity | Community writers are refused on claimed profiles and on `slug`; suppression is re-checked over the values actually being written |
| Scope downgrade or client overreach | Per-call check of `mcp:write` plus the specific resource scope that tool writes, so an over-broad grant still cannot reach a tool the client did not ask for |
| Duplicate mutation after timeout | Transactional user/client/tool/key receipt plus request fingerprint; no automatic retry |
| Shared-secret blast radius | No master MCP credential and no bearer forwarding |
| Secret/content disclosure | Sanitized errors and attribution-only logs; no token, raw idempotency key, or event body persistence |
| Metadata or redirect abuse | Exact HTTPS redirect matching; path/query-bound native loopback matching with PKCE; CIMD size/deadline/address restrictions; constrained DCR |

## Verification and client compatibility

Automated coverage must prove:

- every write tool listed with the exact scope pair it needs, and a client
  registration that refuses a half write-scope set;
- exact `401`/`403` scope challenges, wrong-resource/expired/revoked rejection,
  and client-credentials rejection;
- conditional DCR and CIMD scope policy, including the advertised write-only
  scope pair;
- per-request `AuthInfo` plumbing with no raw token/key reaching Convex;
- durable ownership rejection;
- create/update omission and null behavior;
- exact replay, fingerprint conflict, and client namespace isolation;
- accepted public readback, readback warning, and indeterminate/no-retry text;
- write rate policy, multi-write batch rejection, audit attribution,
  content-safe event records, and rollback to the anonymous-read-only surface.

Before production activation, run the same staged authorization-code flow and a
non-Faceless disposable event against current Codex, Claude, and OpenClaw
clients. Record protected-resource discovery, CIMD or DCR choice, PKCE login,
refresh/relogin behavior, tool listing, user approval, one create, same-key
replay, one update, and public readback. A client that does not perform lazy
`401`/`403` step-up may use its explicit MCP login command; it is a blocker only
if neither native discovery nor explicit login can establish the scoped
session. No matrix row may be marked pass from protocol simulation alone.

For explicit-login clients, configure the staged server URL as
`https://staging.vrdex.net/mcp?auth=required`, request
`mcp:read mcp:write events:write`, and confirm the resulting token
is still issued for `https://staging.vrdex.net/mcp`.

Staging carries the write tools like every other environment, so the client
matrix runs against a normal deployment with no dispatch input to set.

| Client | Current preflight | Staged scoped-session evidence |
| --- | --- | --- |
| Codex CLI 0.145.0 | Exact-branch local Streamable HTTP initialization listed `vrdex_event_create` and `vrdex_event_update` without invoking either tool. Supports `codex mcp login/logout`; use `--scopes mcp:read,mcp:write,events:write` because an unscoped login copies the issuer-wide scope catalog. | Pass at `c58f546e9` in Staging Deploy run `30174911138`. Native DCR, S256 PKCE consent, canonical `/mcp` token exchange, and persisted `Auth: OAuth` status succeeded. Native startup then completed authenticated initialize/notification/tool-list protocol POSTs (`200/202/200`) without a tool call. The isolated Codex home lacked a separate OpenAI model credential after MCP bootstrap; that does not affect the OAuth or tool-list result. |
| Claude Code 2.1.218 | Exact-branch local HTTP initialization listed `vrdex_event_create` and `vrdex_event_update` without invoking either tool. Supports `claude mcp login/logout`. | Pass at `c58f546e9`. Native CIMD discovery used `https://claude.ai/oauth/claude-code-client-metadata`; S256 PKCE consent and token exchange succeeded, and `claude mcp get/list` reported the staged server connected. Final exact-head health was repeated without invoking a tool. |
| OpenClaw 2026.7.1-2 | Exact-branch isolated-state capability probe listed all ten tools, including `vrdex_event_create` and `vrdex_event_update`, without invoking either tool. Supports OAuth scope/client-metadata configuration and login/logout. | Pass at `c58f546e9`. Native DCR, S256 PKCE consent, loopback callback/token exchange, refresh persistence, and exact-head capability probe succeeded; the probe listed all ten tools without invoking any tool. |

Primary standards:

- [MCP authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)
- [MCP tools](https://modelcontextprotocol.io/specification/2025-11-25/server/tools)
- [OAuth Protected Resource Metadata (RFC 9728)](https://www.rfc-editor.org/rfc/rfc9728)
- [OAuth Resource Indicators (RFC 8707)](https://www.rfc-editor.org/rfc/rfc8707)
- [OAuth for Native Apps (RFC 8252)](https://www.rfc-editor.org/rfc/rfc8252)
