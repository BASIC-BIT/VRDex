# Temporal Inference Deployment

## Scope

This runbook prepares the private Plan-IR worker used by VRDex Time. It does not
authorize creating a billable GPU endpoint. Endpoint creation requires the
product owner's explicit approval.

## Artifact and image

1. Resolve the repository's missing root license-file issue before public model
   publication.
2. Download the promoted adapter release and verify SHA-256
   `d933bd524bbf95a4521f243a61cdf3e196fea08133d00fd4a72e0db30160e598`.
3. Move the adapter to an organization-owned Hugging Face repository.
4. Record immutable base and adapter commit revisions.
5. Regenerate the hashed dependency lock only from `requirements.in`:

   ```powershell
   uv pip compile workers/temporal-inference/requirements.in --python-version 3.12 --generate-hashes --index-strategy unsafe-best-match --extra-index-url https://download.pytorch.org/whl/cu128 --output-file workers/temporal-inference/requirements.lock.txt
   ```

6. Build `workers/temporal-inference/Dockerfile`. Its CUDA base image is pinned
   to an amd64 digest and pip installs only the hashed lock.
7. Push an immutable image digest to the organization registry. Do not deploy
   `:latest`.

## Local checks

```powershell
docker build -t vrdex-temporal:local workers/temporal-inference
docker run --rm --gpus all --env-file .private/temporal-inference.env -p 8000:8000 vrdex-temporal:local
```

Expected health behavior:

- `GET /ping` returns `204` while loading
- `GET /ping` returns `200` after model load and prewarm, or `503` if startup failed
- authenticated `GET /ready` returns the same readiness state and verifies the
  application bearer credential
- authenticated `POST /infer` accepts only `text`, `referenceInstant`, and
  `timeZone`

Run the migrated executor-backed eval before provider deployment.

## RunPod bootstrap

Use `runpodctl` and the REST API for templates, inspection, and post-bootstrap
updates. The current public `runpodctl serverless create` flags and REST create
schema do not expose the Load Balancer endpoint-type selector, while RunPod's
load-balancing guide requires that selection during creation. Selecting the
endpoint type in the console is therefore an explicit one-time bootstrap step,
along with any first-time terms or payment setup. RunPod's public MCP is
read-only documentation access and cannot create or update provider resources.

1. Install and configure `runpodctl` with a restricted RunPod API key.
2. Create a Serverless template from the immutable image digest with
   `8000/http` exposed and `PORT=8000`, `PORT_HEALTH=8000`.
3. Add server-only model revisions, model read token, and a random inference
   bearer token to the template secret environment.
4. Confirm the template is Serverless-specific.
5. Review the endpoint plan:

```powershell
& .\scripts\runpod-temporal-endpoint.ps1 -TemplateId <template-id> -GpuTypeIds "NVIDIA RTX A4000","NVIDIA RTX A4500"
```

1. Stop after the plan until explicit billable-resource approval is recorded.
2. In the RunPod console, create the endpoint from the reviewed template and
   select **Load Balancer**. Set the worker minimum to `0`, worker maximum to
   `1`, idle timeout to `30`, and GPU concurrency to `1`; enable FlashBoot,
   matching the plan.
3. Record the endpoint ID, then verify the resulting configuration with
   `runpodctl serverless get <endpoint-id> --include-template --include-workers`
   and the REST read API. Do not accept queue-style `/run` or `/runsync` URLs.
4. Confirm the provider's direct
   `https://ENDPOINT_ID.api.runpod.ai/ping` health behavior, then call
   `https://ENDPOINT_ID.api.runpod.ai/ready` with the configured bearer
   credential to verify application readiness. Use
   `https://ENDPOINT_ID.api.runpod.ai` as the Convex
   `TEMPORAL_INFERENCE_BASE_URL`.

RunPod documents `200` as healthy and `204` as initializing for load-balanced
`/ping` checks. Direct load-balanced requests have no provider queue or
automatic retry, so Convex owns the durable continuation job.

## Convex configuration

Set independently per environment:

- `TEMPORAL_PARSING_ENABLED=true`
- `TEMPORAL_INFERENCE_BASE_URL`
- `TEMPORAL_INFERENCE_AUTH_TOKEN`
- `TEMPORAL_DAILY_ACCOUNT_LIMIT=250`
- `TEMPORAL_MONTHLY_ACCOUNT_LIMIT=2000`

The service fails closed unless `TEMPORAL_PARSING_ENABLED` is exactly `true`.
Unset it or set it to `false` as the operator kill switch. Rotate the inference
credential in this maintenance sequence:

1. set `TEMPORAL_PARSING_ENABLED=false`
2. replace the provider template credential
3. update `TEMPORAL_INFERENCE_AUTH_TOKEN` in Convex
4. verify direct `/ping` and an authenticated worker smoke request
5. restore `TEMPORAL_PARSING_ENABLED=true` and run one end-to-end parse

If verification fails, leave the kill switch off and restore the previous
provider and Convex credential before retrying.

## Vercel configuration

Set `TEMPORAL_INPUT_HASH_KEY` to an independent random secret. It keys
non-reversible repeated-input hashes and must not equal an API-token pepper.

PostHog configuration is applied from `infra/terraform/posthog`. Applying that
stack creates the `temporal-parsing-beta` rollout flag but does not grant
backend access.

## Promotion evidence

Record required and diagnostic pass counts, wrong singular answers, Plan-IR
validity, warm and cold p50/p95/p99, bounded burst behavior, worker seconds,
cost per 1,000 calls, image digest, model revisions, dependency lock, GPU,
precision, prompt format, and rollback result.

Do not point the public route at the endpoint until required cases pass and the
previous container plus kill switch have both been exercised.
