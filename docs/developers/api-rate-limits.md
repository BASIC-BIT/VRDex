# API And MCP Rate Limits

## Status

Current implementation checkpoint for the public API and MCP platform.

VRDex uses route classes instead of one global bucket. Anonymous public reads,
authenticated public reads, hosted MCP reads, OAuth token requests, and
developer credential management each have separate default quotas.

These defaults are conservative launch values, not a stable billing or partner
contract. Trusted partner access remains manually reviewed and should use much
higher practical quotas only after contact ownership, monitoring, cost controls,
and revocation paths are in place.

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

## Default Route Classes

Run this command to print the default policy table from code:

```sh
pnpm ops:api-rate-limits
```

Current defaults:

| Route class | Default limit | Window |
| --- | ---: | ---: |
| `anonymous_public_read` | 120 | 60s |
| `authenticated_public_read` | 600 | 60s |
| `developer_credential_management` | 30 | 60s |
| `oauth_authorize` | 60 | 60s |
| `oauth_token` | 30 | 60s |
| `oauth_dynamic_client_registration` | 10 | 60s |
| `asset_upload_intent` | 30 | 60s |
| `public_write` | 30 | 60s |
| `anonymous_mcp_public_read` | 60 | 60s |
| `authenticated_mcp` | 300 | 60s |

The public API also exposes:

- `GET /api/v0/usage/rate-limit`, returning the same default route-class
  policy table plus the caller's current public API window. Without a bearer
  credential, the response is classified as anonymous public-read traffic. With
  a valid personal API token or API-resource OAuth access token, the response is
  classified as authenticated public-read traffic.

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

- `apiTokenEvents`: personal token creation, revocation, accepted validation,
  and rejected validation attempts.
- `oauthClientEvents`: OAuth application lifecycle, dynamic MCP registration,
  token issuance, revocation, and rejected client-credential attempts.

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

The implementation already has `trustTier` fields for personal tokens and OAuth
applications. Raising partner quotas should be a deliberate operator action
with documentation, monitoring, and fast revocation rather than an automatic
upgrade path.
