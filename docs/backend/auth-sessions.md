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
| Sensitive actions | Credential issuance, OAuth app creation/revocation, and remote session revocation require authentication within the last 15 minutes |
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

## Recent authentication

Recent authentication is a non-sliding 15-minute window measured from
successful completion of a server-side challenge and bound to the replacement
VRDex session. An ordinary active session remains valid for routine use after
that window. Sensitive browser operations fail closed with the typed
`RECENT_AUTH_REQUIRED` code. The original secret-producing request is never
stored or replayed automatically.

The current step-up method is email/password only. Discord and Google remain
ordinary sign-in methods, but ordinary OAuth sign-in cannot satisfy the
recent-auth guard because the installed auth stack does not bind provider
freshness to the resulting VRDex session. Password step-up verifies the exact
original session, consumes a one-time proof, atomically creates and binds one
replacement session, and deletes the original session and refresh-token tree.
Concurrent tabs converge on that replacement. Because this is a full
reauthentication, the replacement begins a new 90-day absolute lifetime.

Developer forms may keep a bounded non-secret draft in `sessionStorage` across
that redirect; token values, client secrets, passwords, and bearer credentials
are never included.

Missing, deleted, expired, malformed, or wrong-user sessions return the
ordinary invalid-session result rather than masquerading as a step-up
challenge. Machine-authenticated API and OAuth token endpoints keep their own
bearer-token authorization contract.

## Revocation and account lifecycle

`/account/security` lists active sessions without tokens, provider payloads,
IP addresses, or fingerprint-derived device names. It shows session creation,
latest refresh activity, absolute expiry, and which session is current.

Normal sign-out revokes only the current session. Revoking another session,
all other sessions, or every session requires recent authentication. A
revoked browser may keep an already-minted JWT for up to one hour, so every
browser-session-authenticated backend entry point must use the centralized
active-session guard before protected work. The static guard-coverage test
prevents an unguarded query, mutation, action, or browser API route from being
added silently. A global active-session subscription clears browser state when
remote revocation is detected, including while the user is away from the
security page.

Single-session revocation deletes the session record in the request
transaction, making its refresh tokens unusable immediately. Refresh-token
history is then deleted in bounded batches so a long rotation history cannot
make revocation exceed Convex transaction limits.

Global revocation, account deletion, and security-sensitive linked-account
changes must delete all `authSessions` and `authRefreshTokens` for the account.

Removing or revoking a Discord or Google grant does not silently extend third-
party access. It also must not sign a user out merely because an optional
provider API token expired. Require provider reauthorization only for a feature
that actually needs fresh provider access. Account access continues through
another linked method when policy allows it.

Broader step-up coverage remains separate work. Billing, account deletion,
ownership transfer, and sign-in-method changes should require a recent
authentication timestamp when those product actions are introduced, even when
the ordinary session is valid.

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

The client emits a fixed authentication lifecycle taxonomy:

- restore completion and a once-per-tab slow-restore signal;
- coarse authenticated/anonymous state changes and explicit current-tab
  sign-out intent;
- recent-auth challenge presentation and completion;
- sensitive-action denial;
- session-revocation request, completion, and remote-revocation detection.

Application-supplied properties are typed coarse enums only. They contain no
token, provider payload, email, user ID, session ID, redirect URL, route slug,
IP address, or account secret. PostHog may still add its standard SDK envelope
and person/session metadata; the application URL sanitizer removes queries and
fragments and normalizes token-bearing paths. Session replay records every
route, and the account, claim, and developer surfaces are blocked from capture
by route-level layouts rather than by not recording at all — see
`docs/agentic/product-analytics-and-feature-flags.md`.

Token refresh failures remain server errors until the auth library exposes a
sanitized reason hook; never log raw JWTs or refresh tokens.

## Verification

Clock-controlled tests cover active, inactivity-expired, absolute-expired,
revoked, recent-auth boundary, ownership mismatch, and deletion
classifications. Browser coverage retains:

- persistent cookie attributes and browser restart;
- silent refresh and rotation;
- cold client state after a deployment/reload;
- concurrent tabs and explicit sign-out;
- inactivity and absolute expiry;
- invalid or revoked refresh sessions;
- transient failure without destructive client-state clearing.

The required auth matrix positively selects only the auth-session contract and
runs it in Playwright Chromium, Firefox, and WebKit. WebKit is useful engine
coverage but is not a claim about testing desktop or mobile Safari itself.

Recurring hosted auth coverage runs only against the disposable staging
account helpers. Production authenticated checks are manual one-shot,
no-business-mutation reads with a freshly exported disposable account state.
Their dedicated Playwright configuration disables traces, screenshots, video,
HTML reports, and uploaded test artifacts; workflow output is limited to a
fixed result classification.

Production inspection is read-only and sanitized. Compare aggregate session
durations, active/expired counts, and environment variable names; never export
user records or token identifiers into issue or PR evidence.

## Upstream references

- [Convex Auth configuration](https://github.com/get-convex/convex-auth/blob/7fcda87ead1918f5b537e1e423698209f1d48747/src/server/types.ts)
- [Convex Auth session implementation](https://github.com/get-convex/convex-auth/blob/7fcda87ead1918f5b537e1e423698209f1d48747/src/server/implementation/sessions.ts)
- [Convex Auth refresh-token implementation](https://github.com/get-convex/convex-auth/blob/7fcda87ead1918f5b537e1e423698209f1d48747/src/server/implementation/refreshTokens.ts)
- [Convex Auth Next.js cookie options](https://github.com/get-convex/convex-auth/blob/7fcda87ead1918f5b537e1e423698209f1d48747/src/nextjs/server/cookies.ts)
