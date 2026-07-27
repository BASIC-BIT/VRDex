# App authentication sessions

Status: `Current recommendation` implemented for new sessions.

This contract covers first-party VRDex web sessions created through Discord,
Google, or email/password. Provider access-token expiry is not the VRDex app
session lifetime. The browser stores VRDex's refresh credential in an
HTTP-only cookie; bearer tokens must not be moved to `localStorage` by
application code.

## Session contract

| Boundary | Contract |
| --- | --- |
| JWT access token | 1 hour |
| Inactivity timeout | 30 days since the latest successful refresh |
| Remembered browser cookie | 30 days, renewed when tokens rotate |
| Absolute lifetime | 90 days from sign-in |
| Silent refresh | Middleware refreshes near JWT expiry and rotates the one-time refresh token |
| Explicit sign-out | Deletes the current backend session and its refresh-token tree, then clears browser state |
| Refresh-token reuse | Reuse outside the library's concurrency window invalidates the affected refresh-token subtree |
| Sensitive actions | Require recent authentication when step-up support is added; do not shorten every routine session |
| Preview/staging | Separate Convex deployment, issuer, signing keys, callback host, cookies, and accounts from production |

The cookie remains host-only with `Secure`, `HttpOnly`, `SameSite=Lax`, and
`Path=/` on hosted HTTPS origins. No `Domain` attribute is set, so a session
for `vrdex.net` is not sent to generated Vercel previews, `staging.vrdex.net`,
or `db.vrdex.net`. OAuth callbacks use the Convex HTTP Actions host, then return
an application code to the web origin; provider tokens do not become web
session cookies.

## Why this is explicit

`@convex-dev/auth` 0.0.92 defaults backend sessions to 30 days total, refresh
tokens to 30 days of inactivity, and JWTs to 1 hour. Its Next.js middleware
defaults auth cookies to browser-session cookies unless `cookieConfig.maxAge`
is supplied. A browser restart could therefore discard the server-readable
refresh token while the backend session was still active.

VRDex sets both sides explicitly:

- `convex/_authSession.ts` owns backend JWT, inactivity, and absolute limits.
- `apps/web/src/lib/auth-session.ts` owns the matching browser cookie limit and
  sanitized lifecycle classification.
- `apps/web/src/middleware.ts` supplies the remembered-cookie configuration.

Changing one duration requires changing the matching constants and tests
together. Existing backend session records keep the expiration time written
when they were created; the 90-day cap applies to sessions created after the
backend change deploys.

## Revocation and account lifecycle

Current explicit sign-out revokes only the current session. A future
multi-device session-management surface should list devices without exposing
tokens and support revoking one session or all sessions. Global revocation,
account deletion, and security-sensitive linked-account changes must delete
all `authSessions` and `authRefreshTokens` for the account.

Removing or revoking a Discord or Google grant does not silently extend third-
party access. It also must not sign a user out merely because an optional
provider API token expired. Require provider reauthorization only for a feature
that actually needs fresh provider access. Account access continues through
another linked method when policy allows it.

Step-up authentication remains separate work. Billing, credential issuance,
account deletion, ownership transfer, and sign-in-method changes should
eventually require a recent authentication timestamp even when the ordinary
session is valid.

## Deployment and key rotation

Keep `SITE_URL`, `CONVEX_SITE_URL`, `JWT_PRIVATE_KEY`, and `JWKS` deployment-
scoped. Preview callbacks must never mint production sessions. Vercel
deployment URLs should not be used as the production smoke base URL.

Rotating the Convex Auth signing key can invalidate JWTs that have at most one
hour remaining. Treat rotation as an owner action: stage the new key pair,
deploy consistently, monitor refresh failures, and expect silent refresh to
mint a new JWT when the existing refresh session remains valid. Do not rotate
provider credentials or Convex keys as part of an application PR.

## Observability

The client emits only:

- `auth_session_restore_completed` with `authenticated` or `anonymous`;
- `auth_session_state_changed` with the previous and next coarse state.

These events contain no token, provider payload, email, user ID, redirect URL,
or account secret. Token refresh failures remain server errors until the auth
library exposes a sanitized reason hook; never log raw JWTs or refresh tokens.

## Verification

Clock-controlled tests cover active, inactivity-expired, absolute-expired, and
revoked classifications. Browser coverage must retain:

- persistent cookie attributes and browser restart;
- silent refresh and rotation;
- cold client state after a deployment/reload;
- concurrent tabs and explicit sign-out;
- inactivity and absolute expiry;
- invalid or revoked refresh sessions;
- transient failure without destructive client-state clearing.

Production inspection is read-only and sanitized. Compare aggregate session
durations, active/expired counts, and environment variable names; never export
user records or token identifiers into issue or PR evidence.

## Upstream references

- [Convex Auth configuration](https://github.com/get-convex/convex-auth/blob/7fcda87ead1918f5b537e1e423698209f1d48747/src/server/types.ts)
- [Convex Auth session implementation](https://github.com/get-convex/convex-auth/blob/7fcda87ead1918f5b537e1e423698209f1d48747/src/server/implementation/sessions.ts)
- [Convex Auth refresh-token implementation](https://github.com/get-convex/convex-auth/blob/7fcda87ead1918f5b537e1e423698209f1d48747/src/server/implementation/refreshTokens.ts)
- [Convex Auth Next.js cookie options](https://github.com/get-convex/convex-auth/blob/7fcda87ead1918f5b537e1e423698209f1d48747/src/nextjs/server/cookies.ts)
