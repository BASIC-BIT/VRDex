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

The shared secret is also created outside this stack and passed in by ARN. A
secret Terraform creates has its value in the state file.

Both are assumed to use the AWS-managed Secrets Manager key, which needs no
explicit grant. If any of them is encrypted with a customer-managed key, list
that key in `kms_key_arns` — `GetSecretValue` then also requires `kms:Decrypt`,
and without it the stack deploys with valid ARNs and answers
`adapter_misconfigured` on every cold start, or reports every delegated
consultation as unavailable.

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
and its URL**, even though the ARN it needs is auto-loaded. Read every plan
before applying; `1 to add, 1 to change` is routine, any `to destroy` on this
stack is not.

The shared-secret ARN is the account-specific half and lives in the operator's
gitignored `terraform.tfvars`. `environments/production.tfvars`
carries only the enable state, which is not account-specific.

Then set the `function_url` output as `VRCLINKING_PROOF_ADAPTER_URL` in Convex,
alongside `VRCHAT_PROOF_ADAPTER_BEARER_TOKEN` and
`VRCLINKING_ADAPTER_CAPABILITY_KEY` holding the two values inside the shared
secret above. Convex is given the base URL — the adapter answers `GET /healthz` and
`POST` on any path.

Verify with an unauthenticated `GET /healthz` (expect `{"status":"ok"}`) and an
unauthenticated `POST /` (expect `401`). A `403` carrying an AWS-shaped error
body means the resource policy is incomplete and the handler never ran.

`/healthz` proves the function booted and resolved the shared secret to two
non-empty values that differ. It says nothing about whether those values match what Convex
holds — see the rotation section for the check that does.

## Secrets, and rotating them

| Secret | Owner | Read by |
| --- | --- | --- |
| `vrdex/vrclinking/shared` | VRDex operator | The adapter at cold start. JSON: `{ "bearerToken": …, "capabilityKey": … }`, mirrored in Convex as `VRCHAT_PROOF_ADAPTER_BEARER_TOKEN` and `VRCLINKING_ADAPTER_CAPABILITY_KEY` |
| `vrdex/vrclinking/<guildId>` | The delegating community | The adapter only, per request, through the execution role |

The two values inside the shared secret must differ — the capability signature
is only meaningful while its key is unknown to whoever holds the bearer token,
and the adapter refuses to start if they match.

**One secret, not two.** Two objects cannot be written atomically, and every
failure mode that follows from that is worse than it first looks: a cold start
landing between the writes caches a new bearer against an old capability key and
holds that pair for its container's life, a failed second write makes that the
resting state, and recycling the fleet to clear it only replaces every working
container with a broken one. A single `PutSecretValue` has no mid-write state to
observe, so none of that arises.

### Rotating the shared pair

```bash
#!/usr/bin/env bash
set -euo pipefail

# 1. One write, both values. There is no window in which the adapter can read a
#    half-rotated pair, so this either happens or it does not.
NEW=$(node -e 'const c=require("node:crypto");
  process.stdout.write(JSON.stringify({
    bearerToken: c.randomBytes(32).toString("hex"),
    capabilityKey: c.randomBytes(32).toString("hex"),
  }))')
aws secretsmanager put-secret-value --secret-id vrdex/vrclinking/shared --secret-string "$NEW"

# 2. Force every warm container to re-bootstrap. A configuration update replaces
#    them; the ARN is unchanged, so this is the no-op edit that does it.
aws lambda update-function-configuration \
  --function-name vrdex-vrclinking-adapter \
  --description "rotated $(date -u +%Y-%m-%dT%H:%M:%SZ)" >/dev/null
aws lambda wait function-updated --function-name vrdex-vrclinking-adapter

# 3. Only then point Convex at the new values. `--prod` is not optional: without
#    it these write the development deployment, and the script would recycle
#    production Lambda onto the new pair while production Convex kept the old
#    one — every command succeeding and every production claim unauthorized.
pnpm exec convex env set --prod VRCHAT_PROOF_ADAPTER_BEARER_TOKEN \
  "$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).bearerToken)' "$NEW")"
pnpm exec convex env set --prod VRCLINKING_ADAPTER_CAPABILITY_KEY \
  "$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).capabilityKey)' "$NEW")"

unset NEW
```

Between steps 2 and 3 every claim fails with `401`, which is the safe direction:
the adapter is strictly ahead of the control plane, so nothing is authorized
against a stale key. Reversing the order leaves old Lambda values paired with new
Convex ones for as long as any container stays warm.

**If it stops partway, re-run the whole script.** The order — secret, recycle,
Convex — makes it idempotent, so re-running from the top is correct from any
partial state and costs only a second pair of random values. Rolling back would
have to unwind whichever Convex variables were already written, which is
per-failure-point bookkeeping to get right while production is down.

`VRCHAT_PROOF_ADAPTER_BEARER_TOKEN` is shared with the generic VRChat proof
adapter seam. Production leaves `VRCHAT_PROOF_ADAPTER_URL` unset, so there is
one consumer today — but a deployment running both must rotate both, since this
script recycles only the VRCLinking Lambda and the other service would keep
expecting the old value.

### Confirming a rotation

Not with `/healthz`. Health is a bootstrap check: it says the adapter resolved a
secret containing two non-empty values that differ. A pair where the adapter
rotated and Convex did not satisfies all of that and still answers `401` to every
real request.

The check that distinguishes them reads the bearer from **Convex**, not from
Secrets Manager — Secrets Manager is the same source the adapter loads from, so a
request built from it tests the adapter against itself and passes either way:

```bash
BEARER=$(pnpm exec convex env get --prod VRCHAT_PROOF_ADAPTER_BEARER_TOKEN)
printf 'header = "authorization: Bearer %s"\n' "$BEARER" |
  curl -K - -s -o /dev/null -w '%{http_code}\n' -X POST "$FUNCTION_URL" \
    -H 'content-type: application/json' -d '{}'
# 400 unsupported_target_type = production Convex and the adapter agree on the
#     bearer; the body is deliberately junk and was rejected on its merits.
# 401 = they disagree, so the rotation is half-applied.
```

That covers the bearer. It says nothing about the capability key: the adapter's
two values now move in one write, but **Convex's do not** — step 3 is two
commands, and if the second fails the bearer matches while every delegation is
still signed with the old key and rejected under the new one. Compare both
halves directly rather than inferring one from the other:

```bash
SHARED=$(aws secretsmanager get-secret-value --secret-id vrdex/vrclinking/shared \
  --query SecretString --output text)
for pair in "bearerToken:VRCHAT_PROOF_ADAPTER_BEARER_TOKEN" \
            "capabilityKey:VRCLINKING_ADAPTER_CAPABILITY_KEY"; do
  node -e '
    const [field, name, shared, live] = process.argv.slice(1);
    process.stdout.write(`${name}: ${JSON.parse(shared)[field] === live ? "match" : "MISMATCH"}\n`);
  ' "${pair%%:*}" "${pair#*:}" "$SHARED" "$(pnpm exec convex env get --prod "${pair#*:}")"
done
unset SHARED
```

Both must say `match`. A plain comparison rather than a signed request, because
both sides are readable to whoever is running the rotation — minting a delegation
to prove the same thing would be more apparatus for less certainty.

### Rotating a community's delegated credential

Cheaper, but not instant: the resolver caches each delegated token for five
minutes per warm container, so `put-secret-value` alone leaves the first claim
routed to each stale environment sending the old token. That claim fails, burns
the attempt's adapter cooldown, and only then drops that container's cache entry.
Ask the community to keep the old provider key valid for those five minutes, or
run the same recycle from step 2 to make the change immediate.

A community *replacing* its delegation through `/account/connections` is a
different path and needs no coordination: the old credential row is revoked and a
new one inserted, so a verdict obtained with the superseded key fails the
recheck at the grant rather than being attributed to its replacement.

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
  outlives its caller: a cold start resolves the shared secret before the fan-out
  budget begins, unbounded, so a slow Secrets Manager read can push provider
  calls past the point Convex abandoned the request — spending a community's
  quota and the claimant's reserved cooldown on a verdict nobody can receive.
  The ceiling being under the caller's deadline is what makes that unreachable.
- The execution role can read every delegated credential. Attach nothing else to
  it.
