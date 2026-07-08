# API And MCP Rate Limits

## Status

Current implementation checkpoint for the public API and MCP platform.

VRDex uses route classes instead of one global bucket. Anonymous public reads,
authenticated public reads, hosted MCP reads, OAuth token requests, and
developer credential management each have separate default quotas.

These defaults are conservative launch values, not a stable billing or partner
contract. Trusted partner access remains manually reviewed. Once an operator
promotes a personal token or OAuth application to `trusted_partner`, the
runtime limiter applies much higher effective quotas to authenticated API and
MCP traffic while keeping credential-management and OAuth handshake endpoints
on their standard limits.

In this guide, the rate-limit backend is only the storage path for hot expiring
request counters. It is separate from durable quota policy, credential
ownership, partner review state, usage summaries, and audit events, which stay
in Convex.

For example, an anonymous hosted MCP search increments a short-lived key for
the anonymous MCP route class plus request identity. The counter expires with
the rate-limit window and is used only to decide whether the next request gets a
`429`. Convex still owns the API token, OAuth app, trust tier, partner review,
and credential event records.

The backend choice is an infrastructure question about where per-request
`INCR`/TTL counters live, not a product question about whether Convex remains
the source of truth for API clients and partner policy.

## Store Modes

Set `VRDEX_RATE_LIMIT_STORE` on the web deployment:

| Value | Use |
| --- | --- |
| `memory` | Local development and low-volume single-process deployments. |
| `redis-rest` | Hosted production with a Redis-compatible REST pipeline. |
| `upstash` | Alias for the Redis-compatible REST pipeline mode. |
| `disabled` | Local diagnostics only. Do not use for hosted production. |

Redis REST mode requires:

- `VRDEX_RATE_LIMIT_REDIS_REST_URL`
- `VRDEX_RATE_LIMIT_REDIS_REST_TOKEN`
- `VRDEX_RATE_LIMIT_REDIS_PREFIX`, optional key prefix for shared stores

The Redis adapter uses a fixed-window counter with `INCR`, `PEXPIRE NX`, and
`PTTL` in one pipeline request.

Use a Redis-compatible store for hosted production anonymous API and hosted MCP
traffic. Convex-only counters are acceptable only for low-volume self-hosted
deployments that knowingly accept the extra write load and cost tradeoff.
For BASIC BIT hosted production, prefer the `redis-rest`/`upstash` adapter for
the first hosted deployment, backed by Upstash Redis unless provider pricing or
latency says otherwise. Vercel KV is not a new-project option; if provisioning
through Vercel, use a Marketplace Redis integration and still wire VRDex through
the Redis REST adapter variables. The important contract is Redis-compatible
expiring counters behind the adapter, not the specific vendor brand.

BASIC BIT hosted production and staging provisioning is owned by
`infra/terraform/rate-limit-redis`. That stack creates the Upstash Redis
database, derives `VRDEX_RATE_LIMIT_REDIS_REST_URL` from the database endpoint,
writes the standard REST token to
`VRDEX_RATE_LIMIT_REDIS_REST_TOKEN` in Vercel, and sets the shared
`VRDEX_RATE_LIMIT_REDIS_PREFIX`. Default PR previews intentionally stay off
that shared store unless operators set `manage_preview_environment=true`.

## Default Route Classes

Run this command to print the standard and trusted-partner policy table from
code:

```sh
pnpm ops:api-rate-limits
```

Current defaults:

| Route class | Standard limit | Trusted partner limit | Window |
| --- | ---: | ---: | ---: |
| `anonymous_public_read` | 120 | 120 | 60s |
| `authenticated_public_read` | 600 | 60,000 | 60s |
| `developer_credential_management` | 30 | 30 | 60s |
| `oauth_authorize` | 60 | 60 | 60s |
| `oauth_token` | 30 | 30 | 60s |
| `oauth_dynamic_client_registration` | 10 | 10 | 60s |
| `asset_upload_intent` | 30 | 3,000 | 60s |
| `public_write` | 30 | 3,000 | 60s |
| `anonymous_mcp_public_read` | 60 | 60 | 60s |
| `authenticated_mcp` | 300 | 30,000 | 60s |

`POST /api/v0/profiles/:slug/assets/upload-intent` uses
`asset_upload_intent` so one-time upload target creation can be throttled
separately from ordinary authenticated writes. The file/import upload transport
uses the returned one-time upload token and does not accept bearer credentials.

The public API also exposes:

- `GET /api/v0/usage/rate-limit`, returning the default route-class policy
  table plus the caller's current public API window and effective `quotaTier`.
  Without a bearer credential, the response is classified as anonymous
  public-read traffic. With a valid personal API token or API-resource OAuth
  access token, the response is classified as authenticated public-read traffic.

Identity keys include the route class and one of:

- IP address for anonymous public API and MCP reads
- personal API token id for API-token-authenticated traffic
- OAuth client id for OAuth-authenticated API and MCP traffic

## Response Headers

Rate-limited API and MCP responses include:

- `Retry-After`
- `RateLimit-Limit`
- `RateLimit-Remaining`
- `RateLimit-Reset`

`RateLimit-Reset` is a Unix timestamp in seconds. `Retry-After` is the minimum
number of seconds the caller should wait before retrying.

## Credential Events

Convex remains the durable policy and audit layer.

Current durable event tables:

- `apiRateLimitEvents`: blocked rate-limit attempts by route class, identity
  kind, quota tier, limit metadata, and timestamp. Rows store identity kind
  only, not IP addresses, token ids, OAuth client ids, Redis keys, or bearer
  values.
- `apiTokenEvents`: personal token creation, revocation, accepted validation,
  and rejected validation attempts.
- `oauthClientEvents`: OAuth application lifecycle, dynamic MCP registration,
  token issuance, revocation, accepted access-token validation, rejected
  access-token validation, and rejected client-credential attempts.
- `mcpToolEvents`: accepted hosted MCP `tools/call` invocations by curated
  tool name and accepted MCP route class, so operators can count anonymous and
  authenticated tool usage without storing bearer tokens or raw IP addresses.

Do not log bearer token values, OAuth client secrets, full Authorization
headers, or raw refresh tokens. Event rows should store ids, prefixes, route
classes, result codes, owner references, and timestamps only.

## Trusted Partner Escalation

Trusted partner access is not self-serve in this checkpoint.

Manual review should confirm:

- accountable contact and organization ownership
- intended use, traffic shape, and data surfaces
- operational owner for incident response
- revocation path for the token or OAuth app
- expected quota class and monitoring plan

The implementation has `trustTier` fields for personal tokens and OAuth
applications. Raising partner quotas should be a deliberate operator action.
When a credential is marked `trusted_partner`, authenticated public reads,
public writes, asset upload-intent creation, and authenticated MCP traffic use a
100x policy multiplier. Anonymous access, OAuth authorization, OAuth token
exchange, dynamic MCP client registration, and developer credential management
stay on the standard launch limits. Partner limits are still metered,
monitored, cost-aware, and quickly revocable rather than an automatic or
literally unlimited upgrade path.
