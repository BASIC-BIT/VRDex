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

Production is fail-closed: `VRDEX_RATE_LIMIT_STORE` must be explicitly set to
`redis-rest` or `upstash`. VRDex rejects `memory`, `disabled`, and an omitted
store when `VERCEL_ENV=production`, `VRDEX_DEPLOYMENT_ENV=production`, or a
self-hosted process runs with `NODE_ENV=production`. Vercel previews and local
development may continue using the process-local memory store.

Redis REST mode requires:

- `VRDEX_RATE_LIMIT_REDIS_REST_URL`
- `VRDEX_RATE_LIMIT_REDIS_REST_TOKEN`
- `VRDEX_RATE_LIMIT_REDIS_PREFIX`, optional key prefix for shared stores

The Redis adapter uses a fixed-window counter with `INCR`, `PEXPIRE NX`, and
`PTTL` in one pipeline request. It increments two expiring counters per
request:

- an identity bucket keyed by route class plus IP, API-token id, or OAuth
  access-token id, used for enforcement
- a route-class request bucket keyed only by route class, used for aggregate
  request-count observability without storing caller identities

OAuth access tokens also increment a secondary client-wide bucket with a limit
ten times the per-token quota. Client-subject tokens issued through Client
Credentials additionally increment a hashed application-owner bucket with a
limit twenty-five times the per-token quota. This preserves per-installation
isolation while retaining aggregate abuse ceilings for noisy OAuth clients and
owners with multiple applications. Trusted-partner multiplication applies to
all three authenticated buckets.

Dynamic Client Registration checks the requesting network before parsing the
request, then checks normalized software identity and each unique redirect
hostname after metadata validation. Software and redirect values are hashed
before becoming counter keys. Their aggregate limits are respectively ten and
twenty-five times the per-network registration quota so a popular client or
redirect host cannot trivially exhaust the shared bucket.

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

When Redis REST env vars are available, run this command to print current
route-class request counts and TTLs from the aggregate counter keys:

```sh
pnpm ops:api-rate-limit-counts
```

When Convex admin credentials are available, run this command to print a
sanitized API/MCP platform observability summary from durable Convex event
rows:

```sh
pnpm ops:api-platform-observability
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
- OAuth access-token id for OAuth-authenticated API and MCP traffic, plus a
  secondary client-wide abuse bucket and a hashed aggregate bucket for the
  delegated user or Client Credentials application owner
- requesting IP, hashed software identity, and hashed redirect hostname for
  Dynamic Client Registration

Before validating a supplied API or hosted MCP bearer token, VRDex inspects the
corresponding anonymous IP bucket without consuming it and rejects an attempt
that would exceed the limit. An actual authentication failure then consumes the
bucket before the authentication error is returned. This bounds repeated token
verification and durable validation work without charging valid credentials to
the anonymous quota.

OAuth authorization GETs and consent POSTs use `oauth_authorize`. Token and
revocation POSTs use `oauth_token`. These checks run before authorization
request parsing, token hashing, or Convex token mutations. A blocked OAuth
request returns an OAuth `temporarily_unavailable` error with HTTP `429` and
the standard rate-limit headers below.

## Trusted Client IP

Anonymous and OAuth handshake buckets do not trust caller-supplied
`X-Forwarded-For` or `X-Real-IP` by default.

On Vercel, VRDex detects the platform through `VERCEL` and uses
`X-Vercel-Forwarded-For`. Vercel documents that this header mirrors its
edge-derived client address and remains distinct when an upstream proxy can
overwrite `X-Forwarded-For`.

Self-hosted deployments behind a reverse proxy must set
`VRDEX_TRUSTED_PROXY_CLIENT_IP_HEADER` to a single-value header owned by that
proxy, for example `X-VRDEX-Connecting-IP`. The proxy must remove any incoming
copy, set the verified client address itself, and prevent direct traffic from
reaching the application origin. VRDex rejects comma-separated lists and
non-IP values. Without this explicit configuration, self-hosted anonymous
traffic uses the shared `unknown` bucket so spoofed forwarding headers cannot
mint fresh buckets.

Official behavior references:

- [Vercel request headers](https://vercel.com/docs/headers/request-headers)
- [Vercel verified proxy guidance](https://vercel.com/kb/guide/how-to-setup-verified-proxy)

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
- `apiWriteAuditEvents`: public API write actions by route class, actor kind,
  resource type, result, owner reference when available, and target resource
  ids. Rows cover profile updates, event creates/updates, API upload-intent
  creation, and API upload completion without storing bearer tokens or upload
  token values.

API request counts by route class come from the hot aggregate route-class
counter keys in the active rate-limit backend. They intentionally stay outside
Convex per-request writes; durable Convex rows are reserved for policy, owner
state, credential validation events, rate-limit blocks, and coarser rollups.
`pnpm ops:api-platform-observability` summarizes the durable event rows for
rate-limit blocks, token validation, OAuth grant outcomes, MCP tool calls, and
write audit trails over a bounded time window.

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
