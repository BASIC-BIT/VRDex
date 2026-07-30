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

The two shared-secret ARNs come from the operator's gitignored
`terraform.tfvars`; `environments/production.tfvars` carries only the enable
state, so a clean checkout cannot tear the function down by applying defaults.

Then set the `function_url` output as `VRCLINKING_PROOF_ADAPTER_URL` in Convex,
alongside `VRCHAT_PROOF_ADAPTER_BEARER_TOKEN` and
`VRCLINKING_ADAPTER_CAPABILITY_KEY` holding the same values as the two secrets
above. Convex is given the base URL — the adapter answers `GET /healthz` and
`POST` on any path.

Verify with an unauthenticated `GET /healthz` (expect `{"status":"ok"}`) and an
unauthenticated `POST /` (expect `401`). A `403` carrying an AWS-shaped error
body means the resource policy is incomplete and the handler never ran.

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
