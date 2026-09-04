# Collector session re-auth research

## Status

Research note for the 2026-09-04 collector outage. It revisits BASIC's
2026-07-27 decision that unattended password re-auth is intentionally absent
and that passwords and TOTP seeds are never worker inputs
(`workers/group-telemetry/README.md`, `docs/planning/community-group-telemetry.md`
line 91, `docs/deployment/group-telemetry-collector.md` "Stops and recovery").
It recommends one path. It does not authorize implementation. Section 4a and
the amendment at the top of section 6 record what the 2026-09-04 recovery
attempts showed: the session is refused from the collector's network, so the
login has to happen from a fixed egress.

## 1. Question and current state

Question: how should the group-telemetry collector recover when its stored
VRChat session returns 401, without a human re-logging in?

Production on 2026-09-04 (operator read 2026-09-04,
`logs/2026-09-04-vrdex-collector-proof-outage.md` in basic-life):

- One collector account, alias Oak: `state: auth_required`,
  `lastHealthResult: provider_401`, credentialGeneration 2, zero telemetry
  integrations assigned.
- The session (`authCookie`, `twoFactorAuthCookie`, `vrchatUserId` in Secrets
  Manager secret `vrdex/group-telemetry/oak`) validated at transfer
  2026-09-02T23:08Z and returned 401 at 2026-09-04T01:00:46Z on the first proof
  batch that ever contained work. No `collector_proof_check` event exists since
  at least 2026-08-25.
- After the 401 the control plane answers heartbeats with 423
  `collector_disabled` (`convex/http.ts`, the `enabled` check before and after
  the body read), the worker fails six consecutive loops
  (`collectorShouldRestart` in `workers/group-telemetry/runtime.mjs`,
  `MAX_CONSECUTIVE_LOOP_FAILURES = 6`), exits 1, and ECS restarts it every
  ~5.5 minutes. The alarms fired but had no actions (fixed in PR #302). PR #300
  makes release readiness require the proof path.
- With zero integrations nothing exercises the session between proofs, so a
  dead session is only noticed by the first real claim.

How the code behaves today:

- `workers/group-telemetry/worker.mjs` reads the secret once at startup
  (`loadSecret`) and builds one `VrchatClient` with the cookies. It never calls
  `/auth/user`; the only provider calls are group reads, joins, leaves, and
  proof lookups.
- `checkProofs` in `worker.mjs`: a provider error with
  `category === "authentication"` reports `proof_outcome: auth_required`, logs
  `collector_auth_required`, releases the batch, sends `proof_auth_failure`,
  sets `stopping`, and the process exits. `collect` does the same through
  `failureDisposition` (`stopAccount` when the category is `authentication`).
- `recordProofAuthFailure` in `convex/communityTelemetry.ts` moves a `ready`
  account to `auth_required` with result `provider_401` via
  `applyCollectorAccountState`, which also flips every assigned integration.
  `collectorWorkerAuthorization` then reports `enabled: false`, which is the
  423.
- The only paths back to `ready` are `registerCollectorAccount` (re-register
  with a new `workerKeyHash`; sets `state: "ready"` and bumps
  `credentialGeneration`) and the operator state mutation. Nothing in the
  worker can return an account to `ready`.
- Recovery is manual: `scripts/prove-vrchat-group-telemetry.mjs --fresh-login`
  (tokenized loopback browser form; credentials and codes stay in that
  process; session saved to the OS credential vault via
  `workers/group-telemetry/vrchat-session-store.mjs`), then
  `scripts/transfer-vrchat-session-to-aws.mjs` (re-validates against
  `/auth/user`, writes only `workerApiKey`, `authCookie`,
  `twoFactorAuthCookie`, `vrchatUserId`, prints only a digest), then
  `registerCollectorAccount`, then an ECS task restart because ECS reads
  secrets at task start only.
- `VrchatOperatorLogin.authenticate` in `workers/group-telemetry/vrchat-login.mjs`
  already implements the full password login and `POST
  /auth/twofactorauth/totp/verify` step. It is only wired to the local browser
  form. Note that it calls `this.cookies.clear()` before the Basic-auth request,
  so it never presents a remembered `twoFactorAuth` cookie and always gets the
  2FA challenge.

## 2. What VRChat actually says

Terms of Service ([https://hello.vrchat.com/legal](https://hello.vrchat.com/legal), effective 2026-02-09),
section 13.2, prohibits: (i) "access or use the Platform in a manner
inconsistent with individual human usage"; (j) "use any engine, software tool,
agent, device, or mechanism (including any robot, spambot, spider, crawler,
scraper, or other automated means or interface) not provided by us to access,
search, or otherwise use any portion of the Platform or to extract data".

Community Guidelines ([https://hello.vrchat.com/community-guidelines](https://hello.vrchat.com/community-guidelines), updated
2025-09-24): "Only one person should use each account"; "creation or usage of
'bots' to abuse the VRChat platform or services" is prohibited; "Do not share
VRChat login credentials between people or build services that ask for VRChat
login credentials."

Creator Guidelines ([https://hello.vrchat.com/creator-guidelines](https://hello.vrchat.com/creator-guidelines), updated
2025-04-15), section "API Usage / Bots", is the current written stance on API
clients:

- "VRChat does not document its API for public usage"
- "You may interact with our API or write applications to interact with our
  API as long as you follow some general guidelines"
- "Don't be malicious"
- "Do not request log-in information from users in any situation. You should
  never ask for or store someone's VRChat credentials"
- "Do not submit repeated, unmetered requests"
- "Do not schedule regular API calls (polling, etc) based on fixed clock
  intervals"
- User-Agent must be `applicationName/Version contactInfo`
- "Do not act on behalf of another user. If a user account is interacting with
  our API, we assume that the interaction comes from the user's device and IP.
  Breaking that assumption will prompt moderation actions."

vrchat.community (the community docs; vrchatapi.github.io now redirects there):
"VRChat's API is not officially supported or documented by VRChat... Abuse of
the API may result in account termination. For their official stance, refer to
VRChat's Creator Guidelines."

Reading this against a VRDex-owned service account re-logging in from a
datacenter:

- "Do not act on behalf of another user" and "we assume that the interaction
  comes from the user's device and IP" are the real exposure. Oak is VRDex's
  own account, so there is no other user being acted for, but every collector
  request already comes from an ECS task, not a person's device. An automatic
  re-login does not change that fact; it makes it slightly more visible (a
  fresh login from an AWS IP instead of reuse of a session a human created).
- ToS 13.2(i) "individual human usage" and the Community Guidelines "Only one
  person should use each account" are strained by any service account. That
  strain exists today and was accepted on 2026-07-27. Storing the password so
  the worker can log in by itself does not add a new prohibited category; it
  removes the last human step from an already automated account.
- "Do not request log-in information from users" and "never ask for or store
  someone's VRChat credentials" are written about other people's credentials.
  They are the reason VRDex must never take a community's own account
  credentials. They are not the sentence that governs VRDex storing its own
  account's password.
- 13.2(j) covers every API client not provided by VRChat. It is the umbrella
  risk for the collector as a whole and is unchanged by any option below.

The often-cited "Tupper said bots are fine if..." Discord quote could not be
located in any primary or citable secondary source; treat it as folklore. No
verifiable documented ban case specifically for API automation was found.

The stop condition stands regardless of the option chosen: if VRChat objects,
stop proof traffic and clear the saved session
(`docs/planning/community-group-telemetry.md` line 31,
`docs/engineering/group-telemetry-provider-proof.md` last paragraph). An
automatic path needs one more clause: also clear the stored password.

## 3. What the API supports

From the community specification (vrchatapi/specification, branch main):

- Security schemes: `authCookie` (cookie `auth`), `authHeader` (HTTP basic),
  `twoFactorAuthCookie` (cookie `twoFactorAuth`, "2FA device remembrance via
  Cookie").
  [https://github.com/vrchatapi/specification/blob/main/openapi/components/securitySchemes.yaml](https://github.com/vrchatapi/specification/blob/main/openapi/components/securitySchemes.yaml)
- `GET /auth/user` (getCurrentUser) logs in with the Authorization header if
  there is no valid auth cookie, otherwise returns the current user. The
  response is `CurrentUser` or `RequiresTwoFactorAuth`. Spec warning: "Each
  authentication with login credentials counts as a separate session, out of
  which you have a limited amount. Make sure to save and reuse the auth cookie
  if you are often restarting the program... expect in production to very fast
  run into the rate-limit and be temporarily blocked from making new sessions
  until older ones expire. The exact number of simultaneous sessions is
  unknown/undisclosed."
  [https://github.com/vrchatapi/specification/blob/main/openapi/components/paths/authentication.yaml](https://github.com/vrchatapi/specification/blob/main/openapi/components/paths/authentication.yaml)
- `POST /auth/twofactorauth/totp/verify` with body `{ code }` finishes login
  and sets the `twoFactorAuth` cookie, which "can be used to bypasses the 2FA
  requirement for future logins on the same device".
  [https://github.com/vrchatapi/specification/blob/main/openapi/components/responses/authentication/Verify2FAResponse.yaml](https://github.com/vrchatapi/specification/blob/main/openapi/components/responses/authentication/Verify2FAResponse.yaml)
- `GET /auth` (verifyAuthToken) returns `{ ok, token }`. `PUT /logout`
  invalidates the login session. No "logout everywhere" endpoint is
  documented; password-change invalidation is not documented; multiple
  concurrent sessions are allowed up to an undisclosed limit.
- No cookie lifetime is documented. Both Set-Cookie examples use the
  placeholder `Expires=Tue, 01 Jan 2030`. The "2FA token expires after 30 days"
  figure appears only in a third-party README
  ([https://github.com/realPrix/vrchat-auth-cli](https://github.com/realPrix/vrchat-auth-cli)), not in the spec.
- Spec issue #248: VRChat added SameSite=Lax to auth cookies; leave Origin and
  Referer empty. [https://github.com/vrchatapi/specification/issues/248](https://github.com/vrchatapi/specification/issues/248)
- vrchatapi-python README: "Do not make queries to the API more than once per
  60 seconds"; User-Agent per usage policy.
  [https://github.com/vrchatapi/vrchatapi-python](https://github.com/vrchatapi/vrchatapi-python)

Locally, `workers/group-telemetry/vrchat-login.mjs` already exercises the
first three: Basic login on `/auth/user`, TOTP verify, and cookie capture
through `applySessionCookies`, including the case where VRChat rotates the
`auth` cookie during a validation (`currentSessionCookies` docstring).

Prior art, reported by the sweep (VRCX, vrcx-team/VRCX at
dc94cf9487fbd416075890abc37f59f31c56fe5d):

- Keep-alive is polling: `GET auth/user` every 300 s
  (`src/stores/updateLoop.js`, `nextCurrentUserRefresh = 300`).
- On 401 "Missing Credentials", `src/services/request.js` lines 168-186 call
  `authStore.handleAutoLogin()`, which reloads saved credentials and calls
  `relogin`, capped at 3 attempts per hour, else logs out.
- VRCX stores the password locally (plaintext by default, AES-256-GCM with an
  optional primary password) and the full cookie jar including
  `twoFactorAuth`; `relogin()` in `src/stores/auth.js` lines 590-654 restores
  cookies before login so the 2FA challenge is skipped. A widely used
  community tool already does unattended re-login with a remembered 2FA
  cookie.
- Maintainer on issue #1592: "VRCX will keep your auth token stored in
  cookies, once that expires you'll be logged out again" (no duration). Issue
  #1345 is a user anecdote of daily re-login. Issue #1576 "Created too many
  sessions for that user" is a 429 from `/auth/user`. No thread confirms that a
  game-client login invalidates API sessions.

Sibling project: `D:\bench\vrchat-mcp` (`src/auth/index.ts`, `performLogin`
and `handleSubmit`; `src/auth/cookieStore.ts`). Same shape as VRDex's
bootstrap: tokenized loopback form, Basic login on `/auth/user`, `POST
/auth/twofactorauth/totp/verify` with the code the human typed, then the whole
cookie jar persisted through keytar with a file fallback. It sends no cookie on
the password step either, so it does not do the VRCX skip. No TOTP seed, no
stored password. The `vrchat_auth_begin` tool name is not under `src/` (only
the implementation is), so the registration file is not cited here.

## 4. Why the Oak session may have died in 26 hours

Candidates, with what evidence exists:

1. ECS task IP change. `infra/terraform/group-telemetry-collector/main.tf`
   line 184 passes `var.assign_public_ip` into the service's
   `network_configuration`; a Fargate task with a public IP gets a new one on
   every task replacement. The production value lives in the gitignored
   `terraform.tfvars`, not in the repo (`docs/deployment/group-telemetry-collector.md`,
   "Automatic releases"). Evidence that IP changes kill sessions: a VRChat
   Canny bug report speculating auth cookies expire on IP change, unconfirmed
   by staff
   ([https://vrchat.canny.io/bug-reports/p/opening-socialavatarworlds-with-an-expired-authcookie-ie-due-to-changed-ip-addre](https://vrchat.canny.io/bug-reports/p/opening-socialavatarworlds-with-an-expired-authcookie-ie-due-to-changed-ip-addre)),
   and the Creator Guidelines' "device and IP" assumption. Not documented. The
   session was validated from the operator's workstation IP and then used from
   an AWS IP, so an IP-binding rule would have bitten on the first ECS request
   after transfer, not 26 hours later, unless the task was replaced in that
   window. Check: ECS task `startedAt` for the task that took the 401 versus
   2026-09-02T23:08Z. PR #295 (collector release changes) merged
   2026-09-03T07:35Z, inside that window, and an automatic release replaces
   the task; PR #300 merged 2026-09-04T05:07Z, after the 401.
2. A login elsewhere on the Oak account. Not documented either way; the sweep
   found no thread confirming that a client login invalidates API sessions.
   Check: ask BASIC whether anyone opened Oak in the game client or website
   between 09-02T23:08Z and 09-04T01:00Z.
3. VRChat-side invalidation with no local trigger (expiry, rotation, a
   server-side sweep). No lifetime is documented anywhere. The code itself
   expects rotation: `validateSession` in `vrchat-login.mjs` applies
   `Set-Cookie` before checking status precisely because VRChat sometimes
   rotates `auth` on `/auth/user`. If any local command validated the vault
   session after the transfer (a `pnpm proof:group-telemetry` run, or a second
   transfer dry run is safe but a real one is not), the vault may hold a
   rotated cookie while AWS holds the retired one. Check: the vault record's
   save time versus 2026-09-02T23:08Z, and the transfer's own log if one was
   kept.
4. Session-limit churn from repeated logins during the 09-02 transfer. The
   documented symptom of the limit is a 429 on new logins, not a 401 on an
   existing session, so this is a weak explanation for the 401 itself. It
   matters for the design of any automatic path: each re-login spends a slot
   from an undisclosed pool. The transfer validates with the cookie, not with
   credentials, so it does not create sessions; only `--fresh-login` does.

None of the four is documented as a cause. What is missing is the time of
death: the session validated at 23:08Z on 09-02 and was next used at 01:00Z on
09-04. Anywhere in those 26 hours is possible. The one cheap check that
separates the candidates is a keep-alive from the worker (option a): once the
worker validates the session every few minutes, the first 401 lands within
minutes of the cause, and that timestamp can be laid against ECS task
replacements, deploys, and whatever BASIC was doing at the time. Without it
the next outage will be just as unexplained.

### 4a. Evidence from the 2026-09-04 recovery attempt

The candidates above assume the session died at some point inside the 26
hours. The recovery attempt on 2026-09-04 says otherwise:

- 06:39Z: BASIC logged in fresh; `pnpm ops:vrchat-session:transfer` validated
  the session with `GET /auth/user` from BASIC's machine and wrote credential
  generation 3.
- 06:41:35Z: the restarted ECS task, holding that secret, heartbeated, claimed
  the one pending proof, sent `GET /users/<id>`, and got 401. The account went
  back to `auth_required`.
- 06:44Z: `pnpm proof:group-telemetry --duration-minutes=0` on BASIC's machine
  validated the same vault session and completed one group read, with the
  identical User-Agent the task uses.

The 01:00Z "death" on 09-04 was also the first authenticated request ever made
from ECS with the generation 2 session. No `collector_proof_check` event
exists in the log group, and the account has never had a telemetry
integration, so the collector has never completed an authenticated read from
AWS with any session. Both sessions kept working from the machine that created
them.

That rules out "the session expired" and points at the network: VRChat
refuses, per request, a session presented from an address other than the one
it was created from, or refuses AWS address space outright. The task runs with
`assign_public_ip = true` and no NAT gateway, so it also changes public IP on
every restart. The first boot of the option (a) image (PR #306, released as
task definition revision 7) with the account `ready` separated the last
variable:

- 14:56Z: the new task started, heartbeated, ran `GET /auth/user` as its first
  provider request, and logged `collector_session_check` with outcome
  `auth_required`. The account went back to `auth_required` and the worker
  shut down.
- 14:58:55Z: `pnpm proof:group-telemetry --duration-minutes=0` on BASIC's
  machine validated the same generation 3 session with one successful request.

So `/auth/user` is refused from ECS too. The endpoint does not matter; the
session is refused from the collector's network.

The two-stage experiment that followed (PR #309 for the infrastructure)
separated "AWS is refused" from "the session is pinned to its origin":

- Stage 1, 15:3xZ: the task moved into a private subnet behind a NAT gateway
  with an Elastic IP. The generation 3 session, still created on BASIC's
  machine, claimed a proof from that fixed address and got `provider_401`.
  A stable AWS address on its own changes nothing.
- Stage 2, 16:42Z: the login harness ran on BASIC's machine with its VRChat
  traffic tunnelled through a loopback CONNECT proxy on a throwaway host in
  that private subnet, so the session was created from the NAT address. It
  was transferred through the same tunnel as generation 4. The restarted
  collector's first request, `collector_proof_check`, completed with outcome
  `not_found` (an authenticated read that succeeded) and the account stayed
  `ready`.

VRChat pins a session to the network address that created it. Nothing about
the Oak session, the vault, or the transfer tooling was ever broken; every
earlier "death" was a session used from a different address than the one it
was born on. Options a to c all carried a session created elsewhere into ECS,
and that is why they could never have worked as written. Option a is still
worth having: it is what turns the next refusal into a five-minute alarm
with a timestamp.

## 5. Options, in increasing blast radius

Common ground for every option: the alarm from PR #302 is the notification
channel; `collector_auth_required` is already the filtered event
(`infra/terraform/group-telemetry-collector/main.tf` lines 249-271, period
300 s). Every option must honour "Do not schedule regular API calls based on
fixed clock intervals" with jitter, the way `randomPollDelayMs` in
`runtime.mjs` already does for telemetry.

### a. Keep-alive only

What changes:

- `workers/group-telemetry/worker.mjs`: in the main loop, when the last
  session check is older than a jittered interval (for example 8-12 minutes,
  drawn per check), spend one slot from `accountBudget` on
  `provider.request("/auth/user")` and log
  `{ event: "collector_session_check", outcome: "ok" | "auth_required" }`. On
  a 401 run the existing authentication path: log `collectorAuthRequiredEvent`,
  send `proof_auth_failure`, stop.
- `workers/group-telemetry/vrchat-client.mjs`: a `verifySession()` method, or
  just call `request` directly. Apply any `Set-Cookie` rotation to the live
  client the way `applySessionCookies` does in `vrchat-login.mjs`; the
  in-memory cookie must follow VRChat's rotation or the next check 401s on a
  retired value. The rotated value is lost on restart (the secret is
  read-only from the task), which is a limitation to record, not a blocker.
- `infra/terraform/group-telemetry-collector/main.tf`: nothing required; the
  existing `auth_required` alarm fires on the log event. Optionally a metric
  filter on `collector_session_check` with `outcome = "ok"` and a missing-data
  alarm, so a worker that silently stops checking is also visible.
- No Convex change.

What the secret represents: unchanged. A session the human created, plus the
worker key and identity.

Failure modes: `/auth/user` itself could be the request that trips an
undisclosed limit; at one call per ~10 minutes this is well under the account
budget (30/min) and under VRCX's 300 s cadence. A 401 on the check still ends
in a human re-login; the outage shrinks from "until the first claim" to "until
the human reads the email".

VRChat text touched: nothing new. The check is the same authenticated read
VRCX makes.

### b. Semi-automatic recovery

Option a, plus the human step collapsed to one command.

What changes:

- A wrapper script (or a `pnpm ops:vrchat-session:recover` entry) that runs
  `scripts/prove-vrchat-group-telemetry.mjs --fresh-login` with
  `--duration-minutes=0`, then `scripts/transfer-vrchat-session-to-aws.mjs
  --secret-id ... --expect-user-id ...`, then prints the exact
  `registerCollectorAccount` invocation with the digest filled in, then
  `aws ecs update-service --force-new-deployment` for the task restart
  ([https://docs.aws.amazon.com/cli/latest/reference/ecs/update-service.html](https://docs.aws.amazon.com/cli/latest/reference/ecs/update-service.html)).
  The only human input is the login form and the TOTP code.
- `docs/deployment/group-telemetry-collector.md` "Stops and recovery": replace
  the four-step prose with the one command.

What the secret represents: unchanged.

Failure modes: still requires a human with the authenticator within reach;
still one fresh login per outage, which spends a session slot.

VRChat text touched: nothing new.

### c. Automatic with the remembered 2FA cookie only

Store the password in the secret, not the TOTP seed. On 401, log in with the
password while presenting the stored `twoFactorAuth` cookie, so VRChat treats
the worker as a remembered device and skips the challenge. This is the VRCX
`relogin()` pattern.

What changes:

- `workers/group-telemetry/session-secret-payload.mjs`: `password` becomes a
  preserved (not session) field, so the transfer never overwrites or removes
  it. `loadSecret` in `worker.mjs` accepts an optional `password`.
- `workers/group-telemetry/vrchat-login.mjs`: `authenticate` must keep the
  `twoFactorAuth` cookie across `this.cookies.clear()` before the Basic-auth
  request (today it drops it, which is why the local flow always challenges).
  Without this one change option c cannot work at all. Test locally first:
  log in with `--fresh-login`, then log in again presenting only the saved
  `twoFactorAuth` cookie, and confirm the second response has no
  `requiresTwoFactorAuth`. If VRChat also binds the remembered device to IP,
  the cookie captured on the workstation will not be honoured from AWS, and
  the first re-login from the task will be challenged. In that case the
  worker's first successful login must itself be the one that mints the
  cookie the worker later reuses, which means one human-attended login from
  the task's IP, or accepting option d.
- `workers/group-telemetry/worker.mjs`: on an authentication error, before
  reporting `proof_auth_failure`, call `VrchatOperatorLogin.authenticate`
  (username, password, no code) with the stored cookies. On success, replace
  the cookies on the live `VrchatClient`, log
  `{ event: "collector_session_reauth", outcome: "ok" }`, retry the failed
  request once, continue. On a challenge or any failure, take the existing
  path (log `collector_auth_required`, send `proof_auth_failure`, stop).
  Circuit breaker: one re-login attempt per process lifetime and a
  control-plane-side count (below), so a dead password cannot loop through
  ECS restarts at one login per 5.5 minutes and hit the session limit.
- `convex/communityTelemetry.ts`: a `session_reauth` operation that records
  the event on the account (`lastReauthAt`, `reauthCount24h`) and refuses when
  the count exceeds 2 in 24 hours, in which case the worker treats it as a
  failure and stops. `recordProofAuthFailure` is unchanged: the account still
  goes to `auth_required` when re-login fails.
- Persisting the new session. ECS reads the secret at task start only
  ([https://docs.aws.amazon.com/AmazonECS/latest/developerguide/specifying-sensitive-data-secrets.html](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/specifying-sensitive-data-secrets.html)),
  so a worker that re-logs in and does not write back boots with the dead
  cookie on its next restart and logs in again, spending another session slot
  each time. Two ways: the worker writes `authCookie` and
  `twoFactorAuthCookie` back to its own secret (needs
  `secretsmanager:PutSecretValue` on that one ARN in the task role, which the
  deployment doc says today has "no AWS data permissions"), or a one-shot
  Lambda does the login and writes the secret and then forces a new
  deployment. Worker-writes is the smaller change: one IAM statement, one SDK
  call, no new compute. Secrets Manager rotation Lambdas are the AWS-shaped
  answer ([https://docs.aws.amazon.com/secretsmanager/latest/userguide/rotate-secrets_lambda-functions.html](https://docs.aws.amazon.com/secretsmanager/latest/userguide/rotate-secrets_lambda-functions.html))
  but their minimum schedule is `rate(4 hours)`
  ([https://docs.aws.amazon.com/secretsmanager/latest/userguide/rotate-secrets_schedule.html](https://docs.aws.amazon.com/secretsmanager/latest/userguide/rotate-secrets_schedule.html))
  and scheduled rotation is the wrong trigger here: the goal is to log in when
  a session dies, not on a clock, and every scheduled login is a session slot
  spent for nothing.
- `scripts/transfer-vrchat-session-to-aws.mjs`: nothing, if `password` is a
  preserved key. The password is set once by the operator with the AWS CLI
  or console, never by a repo script.
- Docs: `workers/group-telemetry/README.md` line 27 and
  `docs/planning/community-group-telemetry.md` line 91 both state "passwords
  and TOTP seeds are never stored"; the password half is reversed and the
  2026-07-27 decision record amended.

What the secret represents: the account password plus a session. Anyone
holding the secret can log in as Oak for as long as the `twoFactorAuth`
cookie is honoured; after it expires they hold a password behind a second
factor they do not have. The second factor still means something.

Failure modes: the `twoFactorAuth` cookie expires (undocumented lifetime;
30 days is a third-party figure) and the re-login is challenged, so recovery
falls back to the human path exactly as today, one extra `collector_session_reauth`
event with `outcome: "challenged"` in the log. A wrong or changed password
returns a 401 on the login itself; the breaker stops after one attempt. A
session-limit 429 on the login is handled by the existing `rate_limit`
category. If IP binding is real, see the test above.

VRChat text touched: "individual human usage" is more clearly strained, since
the account now authenticates itself. "Do not act on behalf of another user"
is unaffected; Oak is VRDex's account. "Never ask for or store someone's
VRChat credentials" is about other people's credentials and is not touched.

### d. Fully automatic: password plus TOTP seed

Option c plus the TOTP seed in the secret. On a challenge, compute the code
(RFC 6238 over HMAC-SHA1 with `node:crypto`, no dependency; roughly twenty
lines) and call `POST /auth/twofactorauth/totp/verify`, which
`VrchatOperatorLogin.authenticate` already does when given a code.

What changes beyond c:

- `loadSecret` accepts `totpSecret`; a `totpCode(secret, now)` helper in
  `vrchat-login.mjs`; the worker passes the computed code on a `totp`
  challenge. Clock skew matters: Fargate clocks are NTP-synced, and RFC 6238
  allows checking the adjacent 30-second window, which VRChat may or may not
  do; try the current window, then the previous one, and stop.
- Circuit breaker as in c: one attempt per process, at most 3 per hour
  account-wide (VRCX's figure), then `auth_required` and the alarm.
- Same persistence choice as c: worker writes the secret and keeps running on
  the in-memory session, or a Lambda writes it and forces a new deployment.

What the secret represents: full account takeover material. Password and
second factor in one JSON document, readable by the execution role and by
anyone with `secretsmanager:GetSecretValue` on that ARN. The account's 2FA
protects nothing against a holder of the secret. This is what the 2026-07-27
decision was written to avoid, and it is the correct thing to weigh: the
attack surface of the secret changes from "one session that can be revoked by
changing the password" to "the account".

Failure modes: none of the four candidate causes in section 4 is fixed by d
that c does not also fix, except a `twoFactorAuth` cookie expiry, which is
the rarest of them. A leaked secret is unrecoverable without changing both the
password and the TOTP seed, and the code that does that is not in the repo.

VRChat text touched: same as c, with the account now able to satisfy the
"human" second factor by itself. "Do not act on behalf of another user" is
still unaffected.

## 6. Recommendation

Amended 2026-09-04, final, after the section 4a experiment: the session must
be created from the collector's own egress address, and now it is. What is
in place:

- The `fixed_egress` block in the collector module (PR #309): private subnet,
  NAT gateway, Elastic IP 98.85.189.174. `GROUP_TELEMETRY_FIXED_EGRESS` is set
  so the release lane plans clean. This is permanent; removing it breaks the
  session again.
- A login path through that address: a stopped `t4g.nano` in the private
  subnet running a loopback CONNECT proxy, reached with SSM port forwarding.
  The operator runs the existing login harness and transfer on their own
  machine with `NODE_USE_ENV_PROXY=1 HTTPS_PROXY=http://127.0.0.1:8888
  NO_PROXY=127.0.0.1,localhost`. Nothing about the secret, the vault, or the
  2026-07-27 decision changes. The host is the
  `infra/terraform/group-telemetry-login-host` stack; its README is the runbook.
- Option a (keep-alive, PR #306) stays: it is what reports the next death
  within ten minutes instead of a day.

b and c are withdrawn as written, because they carry a session created on an
operator's machine into ECS, which is exactly what VRChat refuses. c could be
revived later as "the worker logs in from its own address with the remembered
2FA cookie", which is a stronger version of the same idea now that the
address constraint is known; it is not needed for recovery today. d is still
not recommended.

The original recommendation follows for the record.

Ship a, then c. Do not ship d.

Reasoning:

- The outage was a detection problem before it was a recovery problem. The
  session was dead for up to 26 hours and nobody knew because nothing touched
  it. Option a fixes that with one provider request every ~10 minutes and no
  new secret material, and it is also the only way to learn why sessions die
  here, which section 4 cannot answer today. Do a first, on its own PR, and
  leave it running for at least one session death before building c, so the
  re-login design is based on an observed cause instead of four guesses.
- The owner asked for an automatic path. c is that path with the smallest
  change to what the secret is. It reuses `VrchatOperatorLogin.authenticate`
  and the stored `twoFactorAuth` cookie, which the transfer already ships to
  AWS. The password in the secret is a real change to the 2026-07-27 decision
  and should be recorded as such, but the account's second factor stays out
  of the worker, so a leaked secret is still one password change away from
  useless. VRCX has run this exact pattern for years on ordinary user
  accounts without a documented enforcement case.
- d buys only the "2FA cookie expired" case over c, and pays for it with the
  whole account. If the keep-alive shows sessions dying more often than the
  2FA cookie (which is the likely shape: the sweep found daily-relogin
  anecdotes and no 2FA-cookie complaints), c covers nearly every outage and
  the residual human step is the 2FA cookie's own lifetime, monthly at worst
  by the third-party figure. That is an acceptable amount of human. If it
  turns out the `twoFactorAuth` cookie is not honoured from the task's IP at
  all, c degrades to a, and the decision on d can be made with that fact in
  hand rather than assumed now.

Guardrails for c, all named above and repeated here as the checklist:

1. One re-login attempt per process; control-plane count of at most 2 per 24
   hours; beyond that, `auth_required` and the existing alarm.
2. The worker never logs the password, the code, or any cookie. The existing
   log-field discipline in `worker.mjs` and the README already forbid this.
3. The password is a preserved key in the secret, written once by an operator
   outside any repo script, never printed by `transfer-vrchat-session-to-aws.mjs`.
4. Task-role write access is scoped to `secretsmanager:PutSecretValue` on the
   one secret ARN and nothing else. The execution role's read scope is
   unchanged.
5. The stop condition gains "and remove the password from the secret".
6. Amend `docs/planning/community-group-telemetry.md` line 91,
   `workers/group-telemetry/README.md` line 27, and the deployment doc's
   "Password-based unattended reauthentication is intentionally absent"
   sentence in the same PR as the code, so the decision record and the code
   never disagree.

What to do first, in order:

1. Answer the section 4 checks from the outage log and ECS: task `startedAt`
   versus 2026-09-02T23:08Z; whether anyone used Oak elsewhere; the vault
   record's save time.
2. Ship a. Recover Oak by hand once more via the current path (or b's wrapper
   if writing it is cheaper than the four manual steps; it probably is).
3. Run the local `twoFactorAuth`-cookie test described under c. Its answer
   decides whether c is worth building.
4. Build c with the guardrails, behind the existing account state machine, and
   record the amended risk decision.

## 7. Sources

Local (this repository unless noted):

- `workers/group-telemetry/worker.mjs`: `loadSecret`, `heartbeat`,
  `checkProofs`, `collect`, main loop.
- `workers/group-telemetry/runtime.mjs`: `failureDisposition`,
  `collectorLoopFailureEvent`, `collectorShouldRestart`,
  `collectorAuthRequiredEvent`, `randomPollDelayMs`.
- `workers/group-telemetry/vrchat-client.mjs`: `VrchatClient.request`
  (401 mapped to `authentication`).
- `workers/group-telemetry/vrchat-login.mjs`: `VrchatOperatorLogin`
  (`authenticate`, `validateSession`, `currentSessionCookies`,
  `applySessionCookies`).
- `workers/group-telemetry/session-secret-payload.mjs`:
  `buildSessionSecretPayload`, `preservedSecretKeys`.
- `workers/group-telemetry/vrchat-session-store.mjs`:
  `VrchatKeychainSessionStore`.
- `workers/group-telemetry/README.md`.
- `convex/communityTelemetry.ts`: `applyCollectorAccountState`,
  `registerCollectorAccount`, `recordProofAuthFailure`,
  `collectorProofAvailable`, `collectorWorkerAuthorization`.
- `convex/http.ts`: the `collector_disabled` 423 branch.
- `scripts/prove-vrchat-group-telemetry.mjs`,
  `scripts/transfer-vrchat-session-to-aws.mjs`.
- `infra/terraform/group-telemetry-collector/main.tf` (network configuration,
  `auth_required` metric filter and alarm), `variables.tf` (`assign_public_ip`).
- `docs/deployment/group-telemetry-collector.md`,
  `docs/deployment/claim-verification-enablement.md` (Path 3),
  `docs/planning/community-group-telemetry.md`,
  `docs/engineering/group-telemetry-provider-proof.md`.
- `D:\bench\vrchat-mcp\src\auth\index.ts`, `src/auth/cookieStore.ts`.
- Operator read 2026-09-04, `logs/2026-09-04-vrdex-collector-proof-outage.md`
  in basic-life.

VRChat:

- Terms of Service, [https://hello.vrchat.com/legal](https://hello.vrchat.com/legal) (effective 2026-02-09).
- Community Guidelines, [https://hello.vrchat.com/community-guidelines](https://hello.vrchat.com/community-guidelines)
  (updated 2025-09-24).
- Creator Guidelines, [https://hello.vrchat.com/creator-guidelines](https://hello.vrchat.com/creator-guidelines)
  (updated 2025-04-15), "API Usage / Bots".
- vrchat.community API docs (formerly vrchatapi.github.io).

API specification and community tooling (reported by the sweep):

- [https://github.com/vrchatapi/specification/blob/main/openapi/components/securitySchemes.yaml](https://github.com/vrchatapi/specification/blob/main/openapi/components/securitySchemes.yaml)
- [https://github.com/vrchatapi/specification/blob/main/openapi/components/paths/authentication.yaml](https://github.com/vrchatapi/specification/blob/main/openapi/components/paths/authentication.yaml)
- [https://github.com/vrchatapi/specification/blob/main/openapi/components/responses/authentication/Verify2FAResponse.yaml](https://github.com/vrchatapi/specification/blob/main/openapi/components/responses/authentication/Verify2FAResponse.yaml)
- [https://github.com/vrchatapi/specification/issues/248](https://github.com/vrchatapi/specification/issues/248)
- [https://github.com/vrchatapi/vrchatapi-python](https://github.com/vrchatapi/vrchatapi-python)
- [https://github.com/realPrix/vrchat-auth-cli](https://github.com/realPrix/vrchat-auth-cli) (third-party 30-day figure)
- [https://vrchat.canny.io/bug-reports/p/opening-socialavatarworlds-with-an-expired-authcookie-ie-due-to-changed-ip-addre](https://vrchat.canny.io/bug-reports/p/opening-socialavatarworlds-with-an-expired-authcookie-ie-due-to-changed-ip-addre)
- vrcx-team/VRCX at dc94cf9487fbd416075890abc37f59f31c56fe5d:
  `src/stores/updateLoop.js`, `src/services/request.js`,
  `src/coordinators/authAutoLoginCoordinator.js`, `src/stores/auth.js`;
  issues #1345, #1576, #1592.

AWS:

- [https://docs.aws.amazon.com/secretsmanager/latest/userguide/rotate-secrets_lambda-functions.html](https://docs.aws.amazon.com/secretsmanager/latest/userguide/rotate-secrets_lambda-functions.html)
- [https://docs.aws.amazon.com/secretsmanager/latest/userguide/rotate-secrets_schedule.html](https://docs.aws.amazon.com/secretsmanager/latest/userguide/rotate-secrets_schedule.html)
- [https://docs.aws.amazon.com/AmazonECS/latest/developerguide/specifying-sensitive-data-secrets.html](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/specifying-sensitive-data-secrets.html)
- [https://docs.aws.amazon.com/cli/latest/reference/ecs/update-service.html](https://docs.aws.amazon.com/cli/latest/reference/ecs/update-service.html)
