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

Server code has no session row to consult: an unauthenticated request — no
token, or an expired one — is a single case, and the middleware redirects it to
`/sign-in`.

### Revocation is eventually consistent

This is a deliberate regression from the previous design, and it should be
understood before relying on revocation.

Convex validates a JWT's signature and expiry locally. It cannot introspect
Clerk from a query or mutation, so revoking a Clerk session stops that session
minting *new* tokens but does not invalidate one already issued. A stolen token
therefore keeps working until it expires, where deleting a VRDex `authSessions`
row used to end access immediately.

**The `convex` JWT template's lifetime is the revocation window.** It is
currently one hour, which is a long time to hold a stolen token. Shorten it on
each Clerk instance to tighten the window — the cost is more frequent token
refreshes, which `ConvexProviderWithClerk` handles transparently. Treat any
change here as a security decision, not a performance one.

Sensitive operations do not currently re-check revocation. Adding that would
require an action calling Clerk's Backend API, which queries and mutations
cannot do; the confirmations described below are about accidental clicks and are
explicitly not a defence against a live attacker.

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
— a failure that looks like a claim bug rather than a template gap.

**The template must also emit `"aud": "convex"`.** `auth.config.ts` sets
`applicationID: "convex"`, which Convex checks against the token's audience, so
a template without it has every otherwise-valid token rejected — provisioning
included, meaning nobody can sign in at all. The Convex preset supplies it;
the risk is editing the claims afterwards and dropping it.

Take the preset as-is rather than pasting a subset. These are the claims on the
development instance, read back from Clerk's API — the audience and
`email_verified` are the two VRDex depends on, and the rest are preset defaults
worth keeping so a later need does not require a template change:

```json
{
  "aud": "convex",
  "name": "{{user.full_name}}",
  "email": "{{user.primary_email_address}}",
  "picture": "{{user.image_url}}",
  "nickname": "{{user.username}}",
  "given_name": "{{user.first_name}}",
  "updated_at": "{{user.updated_at}}",
  "family_name": "{{user.last_name}}",
  "phone_number": "{{user.primary_phone_number}}",
  "email_verified": "{{user.email_verified}}",
  "phone_number_verified": "{{user.phone_number_verified}}"
}
```

That template's lifetime is 3600 seconds, so the revocation window described
above is up to an hour on this instance.

### Required instance setting: disable self-service account deletion

The account page opens Clerk's full profile surface, which exposes account
deletion when the instance permits it. VRDex cannot yet reconcile a deleted
Clerk identity (#227): the `users` and `profileOwners` rows survive under a
`clerkUserId` nobody can authenticate as, previously issued developer tokens
keep working, and re-registering produces a different Clerk subject that cannot
manage the original profiles.

**Turn off "Allow users to delete their accounts" on every Clerk instance**
— development, staging, and production — until #227 lands.

This *is* assertable, contrary to what this doc said before. Clerk's Backend API
`/v1/instance` does not expose it, which is what the earlier claim was based on,
but the public Frontend API does — `user_settings.actions.delete_self`. No
credentials needed, because the Frontend API is what the browser already reads:

```sh
curl -s https://clerk.vrdex.net/v1/environment | jq '.user_settings.actions.delete_self'
```

`false` is the required state. Both instances read `true` as of 2026-07-31, so
this is still outstanding. Substitute the instance's own Frontend API host for
development or staging.

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

That ordering was not achieved. Both deployments were signed into through Clerk
before anything was deleted, so the purge runs against a `users` table holding
legacy rows *and* Clerk rows, with the production `super_admin` grant left on a
legacy one. Recoverable, and the reason the purge takes regrant arguments.

`migrations:purgeConvexAuthLeftovers` does the whole thing. Run it per
deployment, staging first, naming the target with `pnpm cx` — `convex --prod`
cannot resolve a project in this repository at all, and would run against the
local backend:

```powershell
# staging (scrupulous-corgi-247)
pnpm cx -- dev run migrations:purgeConvexAuthLeftovers '{"dryRun": true}'

# production (superb-pig-954)
pnpm cx -- prod run migrations:purgeConvexAuthLeftovers `
  '{"regrantGrantsFrom": "<legacy users._id>", "regrantGrantsToClerkUserId": "user_...", "dryRun": true}'
```

It moves the named legacy row's active `accountFeatureGrants` onto the `users`
row carrying `regrantGrantsToClerkUserId`, deletes the legacy rows, and clears
all eight tables in the phase-one block of `convex/schema.ts`.

Both ids in the production invocation come out of the dry run, so run it bare
first. `blockedUsers` is keyed by full `users._id` and names what each legacy row
is still referenced by; `clerkUsers` lists the Clerk identities with their
emails. Take `regrantGrantsFrom` from the first and
`regrantGrantsToClerkUserId` from the second.

Staging needs no regrant arguments today — its legacy rows are E2E fixtures with
no grants — but check `blockedUsers` rather than assuming that.

**Rerun until `moreRemaining` is false.** The eight tables are cleared up to a
fixed batch per invocation, because a deployment that ran Convex Auth for a year
holds a session and refresh-token row per sign-in and reading all of them in one
transaction exceeds Convex's limits — which would strand the tables permanently,
since every retry would fail the same way. Legacy `users` rows are deleted only
on the pass that finishes the tables, so a row is never removed while
`authAccounts` still references it. Both current deployments clear in one pass.

Four things about it are deliberate:

- **`dryRun` defaults to true.** The first run reports; pass `false` to act.
- **Both ends of the regrant are named, and only that row's active grants move.**
  Matching a legacy row to a Clerk one by email would hand privileges to whoever
  holds a matching address. Moving *every* legacy row's grants would be worse:
  `view_private_seed_lookup` and `use_temporal_parsing_beta` are issued per beta
  user, so a deployment holding several would collapse them onto one account.
  Grants on any other legacy row block that row instead — someone else's
  privileges are a reason to stop, not to reassign.
- **It refuses to delete a legacy row anything still references.** Convex does
  not enforce referential integrity, so removing a referenced row leaves an id
  that still reads as a valid `v.id("users")` and resolves to nothing. Every
  such field is listed in `USER_REFERENCES`, and
  `tests/backend/convex-auth-purge.test.ts` fails if the schema grows one the
  list does not name. A non-empty `blockedUsers` in the report means those rows
  survived on purpose — resolve each reference and rerun.

Then sign in through Clerk if you have not, confirm `blockedUsers` is empty on
every deployment, and tighten `clerkUserId` to `v.string()` in the same change
that drops the eight declarations.

`staleCommunityAuthorities` in the report is informational: those rows key on
token identifier rather than `users._id`, so they never block the purge, but the
issuer change already stopped them matching their owners and they have to be
re-granted by hand.

It counts only **active** authorities whose `subject.issuer` differs from the
deployment's `CLERK_JWT_ISSUER_DOMAIN`, which is the set that actually needs
re-granting. Revoked authorities are excluded — re-granting one would restore a
capability somebody deliberately removed — and so are authorities granted since
the cutover, which already match their owners and would be duplicated.

It is `null` rather than a number whenever the answer would be a guess: when the
issuer is unset, and when the table is longer than one bounded read. Read `null`
as "count these yourself", never as zero. The scan is bounded because the purge
is not informational and this is: an unbounded read fails the whole mutation, so
a deployment with enough authority history would never delete a row on account
of a diagnostic.

### Run the Discord watermark backfill after deploying

`discordVerificationWatermarks.appliedAt` is new. Rows written before it carry
no success timestamp, and selecting the current Discord identity falls back to
`updatedAt` for them — a field `reserveGuildVerificationGeneration` bumps before
it reads guilds, so a later failed attempt could make an older account rank as
current.

Run `migrations:runBackfillDiscordWatermarkAppliedAt` (or `migrations:runAll`)
once per deployment after the functions land, which freezes the best available
timestamp into the immutable field.

### Stored auth subjects do not survive the issuer change

`toAuthSubject` persists `tokenIdentifier`, `issuer`, and `subject`, and two
places compare them exactly: `communityAuthorities` is indexed by
`subjectTokenIdentifier` (`_communityAuthority.ts`), and a standalone event
authorizes its original submitter through `isSameAuthSubject`
(`events.ts`). Changing the trusted issuer changes every one of those values,
so those records stop matching their owners — delegated community staff lose
their capabilities, and the submitter of an event with no community owner can
no longer edit it.

Setting `clerkUserId` does not help: these rows key on the token identifier,
not on `users._id`, and nothing can derive which Clerk subject corresponds to a
Convex Auth one. They have to be re-granted after the first Clerk sign-in.

Production held 0 `events` and 0 `communityAuthorities` rows on 2026-07-30, so
there is nothing to migrate there. The cutover has since happened, so **check
both counts per deployment before purging** — staging in particular may hold
rows — and re-grant rather than attempt a rewrite:

```bash
pnpm cx -- dev data communityAuthorities --limit 5
pnpm cx -- dev data events --limit 5
pnpm cx -- prod data communityAuthorities --limit 5
pnpm cx -- prod data events --limit 5
```

Signing in through Clerk before purging is not fatal — it leaves a duplicate
legacy row and an orphaned grant — but it is what happened on both deployments,
and it is why the purge takes `regrantGrantsFrom` at all. `ensureUser` binds a
Clerk identity by inserting a *new* row rather than adopting a legacy one, so the
grant stays behind on a row nobody can authenticate as. Purging first would have
avoided the reconciliation entirely.

Verify every secret after writing it, per
[`convex-environments.md`](../deployment/convex-environments.md). A trailing
`\r` in a Convex environment variable is invisible in both the dashboard and
`convex env get`, and one in `AUTH_GOOGLE_SECRET` broke production Google
sign-in while consent, Discord, and staging all kept working.
