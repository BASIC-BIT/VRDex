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

## Cutover: the Convex Auth rows are gone

Completed 2026-08-03. Both deployments hold zero legacy `users` rows and zero
rows in the eight tables the two-phase removal existed to drop, so
`users.clerkUserId` is now `v.string()` and those declarations are deleted.

The migrations that did it — `purgeConvexAuthLeftovers` and
`reassignLegacyUserReferences` — went with them. They queried tables the schema
no longer declares and searched for rows it can no longer represent, so keeping
them would have meant keeping the declarations they existed to remove.

### Upgrading a deployment that still holds Convex Auth rows

**This revision cannot be deployed onto one.** It undeclares those populated
tables and requires `clerkUserId` in the same change, so schema validation fails
before any function could run — and the functions that would fix it are the ones
this revision deletes. Deploy the staged revision first.

`b8cc4eeca` ("Reassign a legacy user's footprint to their Clerk row", #239) is
the last revision with both migrations and the permissive schema. From a checkout
of it:

**`pnpm cx` cannot reach a self-hosted deployment**, which is most of this
section's audience. `scripts/convex-target.ts` defines exactly three targets —
`local` (loopback-only), `dev`, and `prod` (both requiring a Convex Cloud
deployment name and deploy key) — and it deliberately clears
`CONVEX_SELF_HOSTED_URL` and `CONVEX_SELF_HOSTED_ADMIN_KEY` from the environment
and rejects `--url` / `--admin-key`. That wrapper exists to stop a command aimed
at one of VRDex's own three deployments landing on another; it is not a way to
address a fourth.

Substitute the Convex CLI directly, with the self-hosted pair exported:

```sh
export CONVEX_SELF_HOSTED_URL='https://convex.example.internal'
export CONVEX_SELF_HOSTED_ADMIN_KEY='...'
npx convex deploy          # installs the staged revision's functions
npx convex run migrations:purgeConvexAuthLeftovers '{"dryRun": true}'
```

Everything below is written as `pnpm cx -- <target> run …` because that is what
the first-party deployments use. For a self-hosted one, read each as
`npx convex run …` with those two variables set; the arguments and the reports
are identical.

```powershell
# 1. Inventory, one page of legacy users at a time. Carry nextLegacyCursor back
#    as legacyCursor until it returns null: a dry run deletes nothing, so
#    without the cursor this re-reads the first page forever and never sees the
#    blockers behind it.
pnpm cx -- <target> run migrations:purgeConvexAuthLeftovers '{"dryRun": true}'
pnpm cx -- <target> run migrations:purgeConvexAuthLeftovers `
  '{"dryRun": true, "legacyCursor": "<nextLegacyCursor>"}'

# 2. Only for legacy rows you have confirmed are the same person as a Clerk row
#    — see "Deciding whether a blocked row should be reassigned" below. Do not
#    run this against a row just because step 1 listed it.
#
#    Read the preview — see "Reading the reassignment preview" below, and resolve
#    the genuine targetAlreadyHas duplicates (not every entry: most are not
#    collisions) before the destructive run. Then run it
#    again with "dryRun": false, and keep rerunning with the same arguments while
#    moreRemaining is true (the row budget ran out; repointed rows stop matching,
#    so each pass resumes on its own). A dry run patches nothing, so blockedUsers
#    does not clear until this runs for real.
pnpm cx -- <target> run migrations:reassignLegacyUserReferences `
  '{"fromUserId": "<legacy users._id>", "toClerkUserId": "user_...", "dryRun": true}'
pnpm cx -- <target> run migrations:reassignLegacyUserReferences `
  '{"fromUserId": "<legacy users._id>", "toClerkUserId": "user_...", "dryRun": false}'

# 3. Export the legacy user ids and audit the subject-keyed authorities — see
#    "Audit the subject-keyed authorities first" below, and do not skip to
#    step 4. Step 4 deletes the rows this export is the only record of, and
#    events.submitter / communityAuthorities.subject are matched by that id.
#    Once it has run there is nothing left to match against and the mapping is
#    unrecoverable. Remediate what the audit finds before continuing.
pnpm cx -- <target> export --path ./legacy-audit.zip

# 4. Purge for real. Start with no cursor — resuming from one you paged to during
#    discovery would skip every legacy row before it, and a short enough
#    remainder would report itself finished with those rows still present. Then
#    carry nextLegacyCursor back as legacyCursor until moreRemaining is false.
#    Cursors are tagged with the mode that produced them, so passing a step-1
#    cursor here is rejected rather than silently skipping rows.
pnpm cx -- <target> run migrations:purgeConvexAuthLeftovers '{"dryRun": false}'
```

**`purgeComplete: true` is the gate**, not an empty `blockedUsers` — that reports
only the current page, so a walk whose blockers appeared earlier ends with an
empty one while those rows survive. When it is false, resolve what `blockedUsers`
named and start a **new** walk from no cursor; the affected rows are behind the
old one. Confirm it on every deployment.

**It is necessary and not sufficient.** It is computed from one thing — whether
any `users` row still lacks a `clerkUserId` — so it is silent about everything
keyed on auth *subject* rather than on `v.id("users")`. Do the audit below
before deploying.

#### Audit the subject-keyed authorities first — the purge cannot see them

`events.submitter` and `communityAuthorities.subject` hold an `authSubject`, not
a user id. Nothing in `USER_REFERENCES` covers them, so they never block a legacy
row and never move it out of `purgeComplete`'s way. A legacy user with no
`v.id("users")` reference at all is not blocked, is never a candidate for step 2,
and is deleted by step 4 — with their events left pointing at a subject that no
longer resolves to anyone.

For a **standalone** event that is unrecoverable through the app.
`canUpdateEvent` returns true on an exact submitter match and otherwise returns
`false` outright when `communityProfileId` is undefined, and `events.ts` exposes
no re-grant. Nobody can edit or cancel it again.

A delegated `communityAuthorities` row fails the same way, for the same reason:
an unblocked legacy user's active authority survives the purge keyed to a subject
nothing can present any more, and whoever was delegated that capability quietly
loses it.

**Run the audit before step 4, not after.** It matches on the legacy
`users._id`, and once the purge deletes those rows there is nothing left to match
against — you would be looking at an orphaned subject with no way to learn whose
it was.

**The purge report cannot give you the ids.** `blockedUsers` is keyed by
`users._id` but by definition omits the unblocked rows, which are the ones at
risk; `deletedUsers` is `user.email ?? user._id`, so it hands back an email
whenever one exists, and it is `[]` whenever `usersDeferred` is true. Get them
from the table instead — the same index the migration uses, since `undefined` is
a queryable index value in Convex:

```powershell
# Every legacy row, blocked or not. Through the same target selector as every
# other command here — a bare `npx convex export` reads whatever deployment the
# ambient environment names, and `.env.local` sets
# CONVEX_DEPLOYMENT=anonymous:anonymous-agent, so it would quietly export the
# local backend while the purge below runs against <target>. Auditing one
# database and purging another is the failure this wrapper exists to prevent.
pnpm cx -- <target> export --path ./legacy-audit.zip

# then, from the extracted users/documents.jsonl:
jq -r 'select(.clerkUserId == null) | ._id' users/documents.jsonl
```

Self-hosted: `npx convex export --path ./legacy-audit.zip` is correct there, but
only with `CONVEX_SELF_HOSTED_URL` and `CONVEX_SELF_HOSTED_ADMIN_KEY` exported as
above — those name the deployment explicitly, which is what the wrapper is
otherwise doing for you. Convex's dashboard data browser answers the same
question by hand: users → filter `clerkUserId` → unset.

Keep that list. For each id, check **both** tables for a subject starting with
it:

- `events`, on `submitter.subject`, **and only those with no
  `communityProfileId`**. `canUpdateEvent` returns `false` outright on a
  submitter mismatch when the event is standalone, but a community event falls
  through to the profile owner and `manage_events` authority, so it stays
  manageable and needs nothing. Repointing its submitter would rewrite valid
  historical attribution to fix a problem it does not have.
- `communityAuthorities`, on `subject.subject`, `state: "active"` only —
  re-granting a revoked one would restore a capability somebody deliberately
  removed

**Neither aggregate is a substitute, and they fail differently.**
`authorizationSubjectsLeft` is per-user and only for users you already chose to
reassign — which excludes the unblocked ones entirely, the exact set at risk.
`staleCommunityAuthorities` does run on every purge, but it is a *count*: it
tells you how many authorities stopped matching their owners, never which legacy
identity each belonged to, and it is `null` whenever the issuer is unset or the
table exceeded one bounded read. Neither can be acted on per row, which is what
remediation needs.

Remediation is a deliberate intervention on whatever the audit actually
returned, because no function does it.

For a standalone event: patch `submitter` onto the Clerk subject, or attach a
`communityProfileId` so community authorization applies instead.

For an authority: rewrite the row against the Clerk subject, and **write
`subjectTokenIdentifier` as well as the nested `subject`.** They are separate
columns, and the lookup uses the flat one —
`subjectHasAnyCommunityCapability` queries
`by_subjectTokenIdentifier_state_communityProfileId` on `subject.tokenIdentifier`
and never reads the nested object until a row has already matched. Updating only
`subject` leaves the row keyed to the Convex Auth identity, so the re-grant
returns no capability at all and does it silently, which is the worst way for a
remediation to fail. `convex/` has no `insert("communityAuthorities")` anywhere —
only reads through `subjectHasCommunityCapability` — so this is a direct row
write, not a mutation you can call, and nothing will validate that the two fields
agree.

Decide before the purge; afterwards you are choosing without knowing whose it
was.

Then deploy this revision.

#### Deciding whether a blocked row should be reassigned

**`blockedUsers` says what references a row, never who the row is.** It reports
any of the 31 fields in `USER_REFERENCES`, and several of those are records of
something that happened rather than something someone owns —
`apiTokens.revokedByUserId`, `oauthApplications.revokedByUserId`,
`apiTokenEvents`, `apiWriteAuditEvents`, `mcpToolEvents`. The reassignment
repoints every matching row in all 31, with no identity check of its own, so
running it on a guess either rewrites who did those things or hands one person's
footprint to an unrelated account. Reassign only what you can show is the same
person; there is no report that can show it for you.

The evidence that is actually available is the legacy row's `email` and
`emailVerificationTime` against the Clerk account's verified address, plus
whatever the reference itself tells you — a `profileOwners` row names a profile
whose owner you can ask. Treat a matching address as a prompt to confirm
out-of-band, not as proof: it is exactly what an attacker registering a known
address would produce.

For a blocker that should *not* be reassigned, there are two honest outcomes,
and the third is not a workaround:

- **The referencing row is disposable** — an E2E fixture, say. Delete it, then
  rerun step 1. Untried on either first-party deployment: both blocked rows
  turned out to be real people, so both cleared by reassignment.

  **A revoked grant is not disposable.** It authorizes nothing, which is a
  different claim from recording nothing: `accountFeatureGrants` keeps
  `grantedBy`, `grantedAt`, `reason`, `revokedBy`, `revokedAt` and
  `revokeReason`, so the row *is* the authorization audit record for a
  capability someone held and someone else took away. Deleting it erases who
  did both, irreversibly. Treat it as an explicit retention decision — export
  the row first if anything depends on that history — rather than as cleanup.

  There is no third option that both preserves it and unblocks the legacy row.
  Moving it with step 2 rewrites its holder; deleting it destroys it; leaving it
  keeps `purgeComplete` false. Pick deliberately.
- **It belongs to someone real with no Clerk row.** Then that legacy row cannot
  be purged, `purgeComplete` stays false, and this revision cannot be deployed
  until a human decides what happens to that person's data. That is a stop, not
  a step — the upgrade is genuinely blocked, and the decision is not one a
  runbook can make.
- **Never** reassign to "some Clerk account" to clear the blocker. A purge that
  completes by moving data onto the wrong person is worse than one that refuses.

`purgeConvexAuthLeftovers` also accepts `regrantGrantsFrom` and
`regrantGrantsToClerkUserId`, which move one legacy row's **live**
`accountFeatureGrants` — `isAccountFeatureGrantActive`, the same definition the
rest of the codebase authorizes against — onto a named Clerk row as part of the
purge. This runbook does not use them, because a row blocked only by grants is
blocked by `accountFeatureGrants.userId` like any other reference and step 2
handles it along with the other 30 fields. They predate the reassignment and
remain for a deployment where grants are the only thing in the way. Passing them
on every rerun is safe: a missing source is a no-op, not an error.

#### Reading the reassignment preview

Four fields, and only one of them is the good news:

- **`moved`** — what this pass will repoint, per `table.field`.
- **`targetAlreadyHas`** — what the destination *already* holds in those same
  places, counted across all 31 fields even when the move budget runs out. **This
  is the one to inspect**, though not every entry needs acting on; see below.
  Convex enforces no uniqueness, so nothing rejects two active `profileOwners`
  rows for one profile, and the app resolves whichever it reads first. `-1` means
  the count hit 100 — read it as "many, inspect by hand", not as a number.
- **`authorizationSubjectsLeft`** — `communityAuthorities` and `events` authorize
  by auth subject rather than by `v.id("users")`, so the purge cannot see them
  and this cannot move them. Non-zero is not a failure; it is the audit trail
  staying truthful. It does mean those capabilities have to be re-granted by
  hand, because nothing can derive which Clerk subject a Convex Auth one was.
  **`null` means the scan exceeded 1,000 rows and did not look** — that is the
  worst answer, not zero, so count it yourself.
- **`moreRemaining`** — the row budget ran out; rerun with the same arguments.

**`targetAlreadyHas` counts presence, not collisions.** It asks only "how many
rows in this table already point at the destination", and compares no business
key at all. Owning two profiles is perfectly legal, so a destination owning
profile A and a legacy row owning profile B reports `profileOwners.userId: 1`
while the reassignment produces no duplicate whatsoever. **Deleting on the count
alone destroys valid ownership.** Which entries are real depends on the table:

**Read the table's own indexes to find its key, and compare that.** They are
where the real cardinality is written down, and guessing from the table name
gets it wrong in both directions:

- `temporalParsingPreferences` is one row per user — `userId`, one setting, a
  single `by_userId` index. Any entry there is a genuine duplicate.
- `billingCustomerMappings` looks like it should be, and is not: it holds a
  separate row per `stripeEnvironment` and keeps archived ones alongside the
  active one, so `by_userId_state` having two entries is routine. The key to
  compare is the environment and the state, not the user.
- `profileOwners` is per profile, `discordVerificationWatermarks` per
  `discordUserId`, and `apiTokens`, `oauthApplications` and every event table are
  unbounded per user by design.

**Resolve the genuine duplicates before running destructively, not after**, and
leave the rest alone. Afterwards both rows point at the same user, so the field
that told them apart is gone and you are left inferring from `_creationTime`.
Where it matters it really matters: two *active* `billingCustomerMappings` in
one `stripeEnvironment` means a subscription lookup can resolve to either Stripe
customer.

A dry run moves nothing, so rerunning it reports the same tables forever. It is
there to be read once and acted on, not iterated.

Deliberately never moved, and so absent from both reports: the nineteen
`authSubject`-keyed audit tables — `profileAuditEvents` and its siblings. Those
record what a subject *did*. Repointing them would falsify history rather than
repair ownership.

**Grants are not among them, and the reassignment does not spare the revoked
ones.** `accountFeatureGrants.userId` is the first entry in `USER_REFERENCES`
and step 2 patches every row matching it without reading `state` or any expiry,
so a revoked or expired grant is repointed along with the live ones and its
recorded holder becomes the Clerk row. That is the audit cost of using the
reassignment, and it is the one place where it is less conservative than the
purge's `regrantGrantsFrom`, which moves live grants only. It is defensible for
the case this runbook is for — the two rows are the same person, so "who held
this" is still true — and it is wrong for any case where they are not, which is
one more reason step 2 requires confirmed identity rather than a blocked row.

To keep those rows exactly as they are, do not use step 2 for that user: pass
`regrantGrantsFrom` / `regrantGrantsToClerkUserId` to the purge instead, which
moves only what `isAccountFeatureGrantActive` accepts. Two trades, both real: it
handles grants alone, so any *other* reference still blocks the row — and the
revoked grants it so carefully left behind go on blocking it too, since they are
still `accountFeatureGrants.userId` references. Preserving them and completing
the purge are mutually exclusive; the only way to have both is to export the
rows before deleting them.

The purge's own report carries one more of these. **`staleCommunityAuthorities`**
counts active authorities whose `subject.issuer` differs from the deployment's
`CLERK_JWT_ISSUER_DOMAIN` — capabilities the issuer change already stopped
matching their owners. They key on token identifier rather than `users._id`, so
they never block the purge and are easy to finish an upgrade without noticing.
It is `null` rather than a number whenever the answer would be a guess: an unset
issuer, or a table longer than one bounded read. Read `null` as "count these
yourself".

It is a smoke alarm, not the audit. A count cannot tell you which legacy identity
each authority belonged to, and that is what re-granting one needs — so use it to
find out whether you have a problem, and the per-user pass above to fix it.

`clerkUsers` in the step 1 report is a *sample*, capped at 25, and
`clerkUsersTruncated` says when the account you need may not be in it. When it
is true, read the id from Clerk's dashboard instead — **Users → the account →
User ID**. The migration validates whatever id you pass, so the report is a
convenience, never the source of truth.

Both first-party deployments cleared in a single pass, and neither matched what
this page predicted beforehand; see below.

Two things from that work are worth carrying forward, because neither was
obvious and both cost real time:

**`ensureUser` binds a Clerk identity by inserting a new row, never by adopting
a legacy one** — there is no trustworthy way to decide which pre-cutover row a
Clerk subject corresponds to. So anyone who signed in both before and after the
cutover ended up with their footprint on a row nobody could authenticate as. On
production that meant the owner of `basicbit` neither owned their profile nor
held `super_admin` until the footprint was moved across explicitly.

**A doc that records counts goes stale silently.** This page recorded production
as "0 owned profiles, 0 claims" from 2026-07-30 and was wrong by the time it
mattered: a profile had been claimed since, so the legacy row was referenced by
five tables rather than the one expected. The purge refused to delete it, which
is the only reason that was discovered rather than executed. Prefer a check that
reads current state over a note about what it used to be.

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
