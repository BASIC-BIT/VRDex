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

```bash
#!/usr/bin/env bash
set -euo pipefail

# 1. Generate once and hold both values: step 3 needs the same bytes, and
#    Secrets Manager is not the place to read them back from mid-rotation.
NEW_BEARER=$(openssl rand -hex 32)
NEW_CAPABILITY=$(openssl rand -hex 32)
[ "$NEW_BEARER" != "$NEW_CAPABILITY" ] || { echo "regenerate: values must differ"; exit 1; }

# Both writes land before anything else moves. Secrets Manager keeps the
# previous version as AWSPREVIOUS, so if the second write fails the first is
# revertable with `update-secret-version-stage`.
aws secretsmanager put-secret-value --secret-id vrdex/vrclinking/bearer-token \
  --secret-string "$NEW_BEARER"
aws secretsmanager put-secret-value --secret-id vrdex/vrclinking/capability-key \
  --secret-string "$NEW_CAPABILITY"

# 2. Force every warm container to re-bootstrap. A configuration update replaces
#    them; the ARNs are unchanged, so this is the no-op edit that does it.
aws lambda update-function-configuration \
  --function-name vrdex-vrclinking-adapter \
  --description "rotated $(date -u +%Y-%m-%d)"
aws lambda wait function-updated --function-name vrdex-vrclinking-adapter

# 3. Only then point Convex at the new values.
pnpm exec convex env set VRCHAT_PROOF_ADAPTER_BEARER_TOKEN "$NEW_BEARER"
pnpm exec convex env set VRCLINKING_ADAPTER_CAPABILITY_KEY "$NEW_CAPABILITY"
```

Between steps 2 and 3 every claim fails with `401`, which is the safe direction:
the adapter is strictly ahead of the control plane, so nothing is authorized
against a stale key. Reversing the order leaves old Lambda values paired with new
Convex ones for as long as any container stays warm.

If it stops partway, roll the secrets back rather than pressing on — the pair
has to match across the boundary, and Secrets Manager still holds the previous
version of each:

```bash
aws secretsmanager update-secret-version-stage \
  --secret-id vrdex/vrclinking/bearer-token --version-stage AWSCURRENT \
  --move-to-version-id "$(aws secretsmanager list-secret-version-ids \
      --secret-id vrdex/vrclinking/bearer-token \
      --query 'Versions[?contains(VersionStages, `AWSPREVIOUS`)].VersionId' --output text)"
```

Then re-run the recycle in step 2 so no container is left on the abandoned
value, and confirm with `GET /healthz` before retrying.

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
- `timeout_seconds` (15) sits above the adapter's own 8s fan-out budget and
  above Convex's 10s request deadline, so the function is never the thing that
  cuts a request short — the adapter stops itself first, and Convex gives up
  before the function does.
- The execution role can read every delegated credential. Attach nothing else to
  it.
