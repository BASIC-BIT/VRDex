# VRCLinking proof adapter (Lambda)

Runs [`workers/vrclinking-adapter`](../../../workers/vrclinking-adapter) behind a
Function URL. Defaults disabled; `enable_service = true` creates the function.

## Why Lambda and not ECS

The adapter answers a handful of request/response calls, holds no state, and
needs two things: an execution role that can read Secrets Manager, and an HTTPS
endpoint. A Function URL supplies both and scales to zero. Fargate plus a load
balancer would bill continuously for a service that is idle almost all the time,
and this repository's other two worker stacks are outbound-only, so nothing here
already pays for an ALB.

`server.mjs` and its Dockerfile stay for local runs; both transports share the
protocol in `handler.mjs`.

## Function URL auth is `NONE`, deliberately

Convex cannot sign SigV4. Requests are authorized by the shared bearer token
plus a per-delegation capability that a direct caller cannot forge — IAM auth
here would demand a credential the control plane has no way to present, and the
endpoint would be unreachable by its only client.

## What this stack does not create

The delegated credentials. One secret per participating community, named
`vrdex/vrclinking/<guildId>`, provisioned by an operator when that community
delegates. The IAM policy grants the name prefix rather than an enumerated list,
so onboarding a community is not a Terraform change — the guild binding is
enforced in code, where it can see which guild a given request is for.

The two shared secrets are also created outside this stack and passed in by ARN.
A secret Terraform creates has its value in the state file.

## Deploy

```bash
pnpm ops:package-vrclinking-adapter
cd infra/terraform/vrclinking-adapter
terraform init
terraform apply -var-file=environments/production.tfvars
```

**`-var-file=environments/production.tfvars` is mandatory on every production
plan and apply.** Terraform auto-loads `terraform.tfvars` but not files under
`environments/`, and `enable_service` defaults to `false` — so a plain
`terraform apply` against production state plans **deletion of the live function
and its URL**, even though the ARNs it needs are auto-loaded. Read every plan
before applying; `1 to add, 1 to change` is routine, any `to destroy` on this
stack is not.

The two shared-secret ARNs are the account-specific half and live in the
operator's gitignored `terraform.tfvars`. `environments/production.tfvars`
carries only the enable state, which is not account-specific.

Then set the `function_url` output as `VRCLINKING_PROOF_ADAPTER_URL` in Convex,
alongside `VRCHAT_PROOF_ADAPTER_BEARER_TOKEN` and
`VRCLINKING_ADAPTER_CAPABILITY_KEY` holding the same values as the two secrets
above. Convex is given the base URL — the adapter answers `GET /healthz` and
`POST` on any path.

Verify with an unauthenticated `GET /healthz` (expect `{"status":"ok"}`) and an
unauthenticated `POST /` (expect `401`). A `403` carrying an AWS-shaped error
body means the resource policy is incomplete and the handler never ran.

`/healthz` proves the function booted and resolved both secrets to non-empty
values that differ. It says nothing about whether those values match what Convex
holds — see the rotation section for the check that does.

## Secrets, and rotating them

| Secret | Owner | Read by |
| --- | --- | --- |
| `vrdex/vrclinking/bearer-token` | VRDex operator | The adapter at cold start; Convex holds the same value as `VRCHAT_PROOF_ADAPTER_BEARER_TOKEN` |
| `vrdex/vrclinking/capability-key` | VRDex operator | The adapter at cold start; Convex holds the same value as `VRCLINKING_ADAPTER_CAPABILITY_KEY` |
| `vrdex/vrclinking/<guildId>` | The delegating community | The adapter only, per request, through the execution role |

The two shared secrets must hold **different values** — the capability signature
is only meaningful while its key is unknown to whoever holds the bearer token,
and the adapter refuses to start if they match.

Rotation has an ordering hazard: `resolveAdapterDeps` reads both shared secrets
once per container and caches them for that container's life, so a warm
environment keeps serving the old pair after Secrets Manager and Convex have
moved on. Recycle the fleet explicitly rather than waiting it out:

Run it as a script, not line by line. `set -e` is what stops a half-rotation:
without it a failed `put-secret-value` still recycles the fleet and still writes
both Convex variables, leaving the adapter on one new secret and one old while
Convex holds two new ones — every claim `unavailable` until someone works out
which of the four values is the odd one.

The two secrets are separate objects, so the pair is not written atomically.
`bootstrap.mjs` reads them independently at cold start, which means a container
starting between the two writes caches the new bearer with the old capability
key and keeps that pair for its lifetime. The `trap` below is what bounds it:
on any failure it recycles the fleet before exiting, so no container is left
holding a mix. It is also why the recycle in step 2 is not optional even when
both writes clearly succeeded.

Holding both values in a single secret would remove the window rather than
bound it, at the cost of a migration and a change to what the stack reads. That
is worth doing if rotation ever becomes routine; at one operator running this by
hand, the trap is the proportionate answer.

```bash
#!/usr/bin/env bash
set -euo pipefail

recycle() {
  aws lambda update-function-configuration \
    --function-name vrdex-vrclinking-adapter \
    --description "rotated $(date -u +%Y-%m-%dT%H:%M:%SZ)" >/dev/null
  aws lambda wait function-updated --function-name vrdex-vrclinking-adapter
}

# Any exit before the end recycles the fleet, so no container survives holding
# a bearer and capability key from different rotations. Cheap, and the only
# thing standing between a failed second write and an adapter that rejects
# every request until someone notices.
trap 'echo "rotation failed - recycling so no container keeps a mixed pair"; recycle' ERR

# 1. Generate once and hold both values: step 3 needs the same bytes, and
#    Secrets Manager is not the place to read them back from mid-rotation.
NEW_BEARER=$(openssl rand -hex 32)
NEW_CAPABILITY=$(openssl rand -hex 32)
[ "$NEW_BEARER" != "$NEW_CAPABILITY" ] || { echo "regenerate: values must differ"; exit 1; }

# Not atomic across the two secrets — a cold start landing between these writes
# caches the new bearer against the old capability key. The trap above is what
# keeps that from outliving the script.
aws secretsmanager put-secret-value --secret-id vrdex/vrclinking/bearer-token \
  --secret-string "$NEW_BEARER"
aws secretsmanager put-secret-value --secret-id vrdex/vrclinking/capability-key \
  --secret-string "$NEW_CAPABILITY"

# 2. Force every warm container to re-bootstrap. A configuration update replaces
#    them; the ARNs are unchanged, so this is the no-op edit that does it.
recycle

# 3. Only then point Convex at the new values.
#    `--prod` is not optional here. Without it these write the *development*
#    deployment, and the script would recycle production Lambda onto the new
#    pair while production Convex kept the old one — every command succeeding
#    and every production claim unauthorized.
pnpm exec convex env set --prod VRCHAT_PROOF_ADAPTER_BEARER_TOKEN "$NEW_BEARER"
pnpm exec convex env set --prod VRCLINKING_ADAPTER_CAPABILITY_KEY "$NEW_CAPABILITY"
```

Between steps 2 and 3 every claim fails with `401`, which is the safe direction:
the adapter is strictly ahead of the control plane, so nothing is authorized
against a stale key. Reversing the order leaves old Lambda values paired with new
Convex ones for as long as any container stays warm.

**If it stops partway, re-run the whole script.** Do not try to roll back. The
script is idempotent by construction — it writes both secrets, recycles, then
writes both Convex values, in that order — so re-running it from the top is
correct from *any* partial state, and the only cost is a second pair of random
values. There is no failure point where a fresh run leaves you worse off.

Rolling back is the harder path and the one that goes wrong: it has to restore
both `AWSCURRENT` stages together (reverting one leaves the same mismatched pair
the failure created) and unwind whichever Convex variables were already written,
which is per-failure-point bookkeeping that has to be right under pressure.
Rolling forward has one instruction.

Confirming a rotation takes an authenticated request, not `/healthz`. Health is
a bootstrap check only: it says the adapter resolved two non-empty values that
differ from each other. A pair where one side rotated and the other did not
satisfies all of that and still answers `401` to every real request, so a
green `/healthz` after a partial rotation is exactly as green as after a clean
one.

The check has to read the bearer from **Convex**, not from Secrets Manager.
Secrets Manager is the same source the adapter loads from, so a request built
from it tests the adapter against itself and passes whether or not Convex ever
caught up — which is precisely the state a half-finished rotation leaves:

```bash
BEARER=$(pnpm exec convex env get --prod VRCHAT_PROOF_ADAPTER_BEARER_TOKEN)
printf 'header = "authorization: Bearer %s"\n' "$BEARER" |
  curl -K - -s -o /dev/null -w '%{http_code}\n' -X POST "$FUNCTION_URL" \
    -H 'content-type: application/json' -d '{}'
# 400 unsupported_target_type = production Convex and the adapter agree on the
#     bearer; the body is deliberately junk and was rejected on its merits.
# 401 = they disagree, so the rotation is half-applied.
```

This covers the bearer only. The capability key cannot be checked without
minting a signed delegation, which is more apparatus than a rotation check
warrants — so if the *second* `convex env set` is the one that failed, this
check passes and claims still fail. The script writes both or neither, and the
`trap` recycles on failure, which is what keeps that case to a window rather
than a resting state; re-running the script from the top is the fix either way.

A delegated community credential is cheaper to rotate but not instant: the
resolver caches each token for five minutes per warm container, so `put-secret-
value` alone leaves the first claim routed to each stale environment sending the
old token. That claim fails, burns the attempt's adapter cooldown, and only then
drops that one container's cache entry. Ask the community to keep the old
provider key valid for those five minutes, or run the same
`update-function-configuration` recycle from step 2 to make the change immediate.

Clear `NEW_BEARER` and `NEW_CAPABILITY` when you are done; they hold the live
secrets.

## Why the URL needs two permissions

AWS began requiring both `lambda:InvokeFunctionUrl` and `lambda:InvokeFunction`
on function URLs in October 2025. `aws_lambda_function_url` creates only the
first, so a stack with just that answers every request `403
AccessDeniedException`. The second is granted with `invoked_via_function_url`,
which is what stops `Principal = "*"` from also handing every AWS principal a
direct `Invoke` that would bypass the bearer token and capability check
entirely. That argument needs provider 6.28.0 or newer, which is why this stack
pins `~> 6.28` where the others pin `~> 5.0`.

## Bounds worth knowing

- `reserved_concurrency` caps how much of a community's VRCLinking quota a burst
  of concurrent claims can spend.
- `timeout_seconds` (9) sits above the adapter's own 8s fan-out budget and
  *below* Convex's 10s request deadline. Do not raise it. Above 10 the function
  outlives its caller: a cold start resolves two secrets before the fan-out
  budget begins, unbounded, so a slow Secrets Manager read can push provider
  calls past the point Convex abandoned the request — spending a community's
  quota and the claimant's reserved cooldown on a verdict nobody can receive.
  The ceiling being under the caller's deadline is what makes that unreachable.
- The execution role can read every delegated credential. Attach nothing else to
  it.
