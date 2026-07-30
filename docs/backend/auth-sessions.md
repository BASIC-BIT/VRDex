# App authentication sessions

Status: `Current recommendation` implemented.

Clerk is VRDex's authentication and session authority. It owns sign-in, sign-up,
connected accounts, session lifetime, and session revocation. VRDex owns
authorization: what a signed-in user may do with profiles, claims, media,
developer credentials, and the public API.

Convex trusts Clerk through one setting — `convex/auth.config.ts` names the
Clerk issuer as `domain` and `convex` as `applicationID`, matching the `convex`
JWT template on the Clerk instance.

## Identity model

`users` remains the VRDex identity spine. Every other table's `v.id("users")`
foreign key points at it, and `clerkUserId` is its only link to the auth
provider.

Rows are provisioned on demand: the first authenticated page load calls
`users:ensureCurrentUser`, which inserts or refreshes the row from the Clerk
identity. There is no Clerk webhook — no endpoint to expose, no signature to
verify, and no replay or retry semantics to get wrong. The mutation is
idempotent, so repeat calls refresh rather than duplicate.

Convex code resolves identity through `convex/_identity.ts`:

| Helper | Use |
| --- | --- |
| `requireUser(ctx)` | Returns `{ user, userId }`, throws `UNAUTHENTICATED` |
| `currentUserOrNull(ctx)` | Returns the row or `null` |
| `ensureUser(ctx)` | Idempotent provisioning from the Clerk identity |
| `isUnauthenticatedError(error)` | Recognises the thrown code |

Claim-level and account-level code uses `convex/_browserSessionAuthority.ts`,
which sits on those helpers and adds the `authSubject` shape.

`tests/backend/auth-session-authorization-boundary.test.ts` enforces the
boundary: only `_identity.ts` and `_browserSessionAuthority.ts` may read
`ctx.auth.getUserIdentity()` directly, the Convex HTTP router must stay free of
browser-session authority, and every Next route forwarding a browser JWT to
Convex must be inventoried.

## Session contract

Session lifetime is Clerk's, configured on the Clerk instance rather than in
this repository. VRDex does not reproduce the previous hand-rolled contract —
there is no VRDex session record, no refresh-token tree, and no silent-refresh
middleware, because Clerk performs all of it.

| Boundary | Owner |
| --- | --- |
| Session lifetime and inactivity timeout | Clerk instance settings |
| Token refresh and rotation | Clerk, via `ConvexProviderWithClerk` |
| Session inventory and device list | Clerk, surfaced by `<UserProfile />` |
| Session revocation | Clerk; a revoked session mints no further tokens |
| Sign-out | Clerk `signOut()`, which clears its own cookies |
| JWT lifetime reaching Convex | The `convex` JWT template, currently 1 hour |
| Preview/staging isolation | Separate Clerk instance, keys, and Convex deployment |

A token Convex accepts is by definition unexpired and unrevoked, so server code
has no session row to consult. An unauthenticated request — no token, an expired
one, or one for a revoked session — is a single case, and the middleware
redirects it to `/sign-in`.

## Connected accounts

A user may sign in with email, Google, or Discord, and link additional providers
from Clerk's account UI even when the provider email addresses differ. That is
the capability the previous verified-email matching could not express.

Provider linkage is Clerk state and is not readable from a Convex query or
mutation without a network call. Claiming therefore does not consult sign-in
provenance: `getLinkedProviderAccount` in `convex/accounts.ts` reads VRDex's own
`discordVerificationWatermarks`, written by the purpose-scoped Discord OAuth
round-trip in `convex/discordVerification.ts`.

The practical effect: claiming a profile with Discord requires completing that
verification round-trip, not merely having signed in with Discord. That is the
evidence a claim actually depends on, and it decouples claiming from whichever
provider a user happened to sign in with.

## Sensitive actions

Consequential browser actions — API token creation, OAuth application creation,
and OAuth application revocation — show a confirmation immediately before the
write. Cancelling performs no write.

Confirmations prevent accidental clicks. They are not a security boundary: an
attacker controlling an active session can dismiss them. Authorization checks on
each mutation, plus Clerk-side session revocation, remain the boundary. This
trade-off is deliberate and replaces the previous recent-authentication step-up,
which Discord- and Google-only accounts could not complete at all.

## Configuration

Clerk instances are separate per environment. Required values:

| Variable | Where | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | web | Public; encodes the Frontend API host |
| `CLERK_SECRET_KEY` | web, server-side only | |
| `CLERK_JWT_ISSUER_DOMAIN` | Convex deployment | Read by `convex/auth.config.ts` |

The Clerk instance needs a JWT template named exactly `convex`, from Clerk's
Convex preset. Templates do not carry across instances, so development,
staging, and production each need their own.

**The template must emit an `email_verified` claim.** Convex maps it to
`identity.emailVerified`, and the claim guards read it directly through
`identityEmailVerified` — the token Convex just validated is the authority, not
the `emailVerificationTime` column, which is only a mirrored copy and can lag a
profile change. Without the claim, every request looks unverified and
`requireVerifiedEmailUser` rejects claim-level actions with `EMAIL_NOT_VERIFIED`
— a failure that looks like a claim bug rather than a template gap. The
development template in use emits:

```json
{
  "email": "{{user.primary_email_address}}",
  "email_verified": "{{user.email_verified}}",
  "name": "{{user.full_name}}",
  "picture": "{{user.image_url}}"
}
```

## Cutover: retire the Convex Auth rows before the first sign-in

`clerkUserId` is optional so the first deploy does not reject rows created under
Convex Auth. Those rows are inert — nothing can authenticate as them, because a
row without a `clerkUserId` matches the index for nobody.

**Order matters.** `ensureUser` binds a Clerk identity by inserting a *new* row;
it never adopts a legacy one, because there is no trustworthy way to decide which
legacy row a Clerk subject corresponds to. So anything still pointing at a legacy
row becomes unreachable the moment its owner signs in with Clerk.

Production on 2026-07-30 held two `users` rows and exactly one row referencing
either of them — a single `accountFeatureGrants` row. Nothing else: 0 owned
profiles, 0 claims, 0 events, 0 API tokens, 0 OAuth applications.

Per deployment, before anyone signs in:

1. Re-check the counts. If a profile has been claimed since, this section is out
   of date and the orphaning is no longer trivial.
2. Delete the Convex Auth tables and the legacy `users` rows.
3. Sign in through Clerk, which provisions a fresh row.
4. Recreate the `accountFeatureGrants` row against the new user id.
5. Once no legacy rows remain anywhere, tighten `clerkUserId` to `v.string()`.

Doing step 3 before step 2 is not fatal — it leaves a duplicate legacy row and an
orphaned grant, both fixable by hand — but it costs a manual reconciliation that
the ordering above avoids.

Verify every secret after writing it, per
[`convex-environments.md`](../deployment/convex-environments.md). A trailing
`\r` in a Convex environment variable is invisible in both the dashboard and
`convex env get`, and one in `AUTH_GOOGLE_SECRET` broke production Google
sign-in while consent, Discord, and staging all kept working.
