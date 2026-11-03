# Event Platform 05: Gateway Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run `apps/discord-gateway` as one always-on ECS Fargate task with Secrets Manager credentials, a release workflow that builds, deploys, and registers slash commands, and two alarms that email `basic@basicbit.net`: one on the ECS running-task count and one on a stale heartbeat.

**Architecture:** A new Terraform stack, `infra/terraform/discord-gateway/`, copies the collector's ECS conventions. It reuses the collector's VPC, its NAT-routed egress subnet, and its `vrdex-group-telemetry-alerts` SNS topic, which already emails `basic@basicbit.net`. Terraform creates the three secrets with no value, so secret values never land in Terraform state; the operator writes them once with `put-secret-value`. Heartbeat staleness is a Convex-side check: `internal.discordIntake.checkHeartbeat` runs on a five-minute cron and calls plan 02's `notifyOps`. Convex never calls AWS for this check. A release workflow modelled on `group-telemetry-release.yml` builds an immutable image and applies a plan that is allowed to change only the task definition and the service. It then runs `register-commands`.

**Tech Stack:** Terraform `>= 1.10.0` with `hashicorp/aws ~> 6.0`, ECS Fargate, ECR, Secrets Manager, CloudWatch, GitHub Actions OIDC, Docker with pnpm 10 workspaces on Node 24, Convex (`internalMutation`, crons), `convex-test` under `node:test`.

**Spec:** `docs/superpowers/specs/2026-10-28-discord-event-intake-design.md` (Observability: Alarms; Runtime and deployment; Rollout). Interface contract: `docs/superpowers/plans/2026-10-29-event-platform-master.md` (Gateway deployment; Ops alerts under Connector foundation; Discord relay).

## Global Constraints

- Anything that runs unattended in production ships with an alarm whose action emails `basic@basicbit.net`, in the same PR. For the ECS gateway, use a CloudWatch alarm with an SNS email action. For the Convex heartbeat check, use `notifyOps`. An alarm with no email action is not an alarm.
- Every new env var is documented by name, scope, owner, and rotation path in `docs/deployment/convex-environments.md` (Convex). Values stay in provider secret stores.
- Gateway env: `DISCORD_BOT_TOKEN`, `DISCORD_APPLICATION_ID`, `CONVEX_SITE_URL`, `DISCORD_INTAKE_SECRET`. The first, second, and fourth come from Secrets Manager. `CONVEX_SITE_URL` is a plain variable.
- Heartbeat: the gateway POSTs `/discord-intake/heartbeat` every 60 s (plan 03). `checkHeartbeat` runs every 5 minutes and raises the alarm when the newest heartbeat is older than 300 s.
- The flag `VRDEX_DISCORD_INTAKE_ENABLED` is on Convex and defaults to false. The heartbeat HTTP action returns 503 while it is off.
- The bot stays under 100 servers, which keeps message-content access unverified.
- Slash commands register once per deploy through `pnpm --filter @vrdex/discord-gateway register-commands`, not by hand.
- Markdown passes `pnpm exec markdownlint-cli2`. Docs under `docs/` are published: no bare angle-bracket placeholders outside fenced code, and no bare `<https://...>` autolinks.
- Commit per task with a conventional-commit subject ending in `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Universal agent rule: no applies, no deploys, no secret writes. Every bootstrap step marked BASIC is documented, not executed.

## Review Focus

1. **Overlapping tasks during a deploy.** A rolling deploy must never run two gateway tasks at once. Two sessions would double-handle `/vrdex connect`. Pin `deployment_minimum_healthy_percent = 0` and `deployment_maximum_percent = 100` (Task 2 test `enabled_service_alarm_and_network`).
2. **Heartbeat check while intake is off.** If `VRDEX_DISCORD_INTAKE_ENABLED` is off while the task runs, every heartbeat gets a 503. `checkHeartbeat` must do nothing then, not email every six hours (Task 4 test `skips while intake is disabled`).
3. **A gateway that has never sent a heartbeat.** For example, a wrong `DISCORD_INTAKE_SECRET` gets a 401 on every POST, so no heartbeat is ever stored. With the flag on, this must alarm, not read as "nothing to compare" (Task 4 test `alerts when no heartbeat was ever recorded`).
4. **An enabled stack with a bad image or URL.** An enabled stack with a mutable image tag or a non-HTTPS `convex_site_url` must fail at plan time (Task 2 tests `rejects_mutable_image` and `rejects_http_convex_site_url`).
5. **No RunningTaskCount data.** The ECS alarm must fire when the service emits no data at all, for example after the service was deleted or scaled to zero by hand: `treat_missing_data = "breaching"` (Task 2 test `enabled_service_alarm_and_network`).

---

## File Structure

| Path | Responsibility |
| --- | --- |
| `apps/discord-gateway/Dockerfile` (new) | Multi-stage image: filtered pnpm workspace install, then `pnpm deploy` into a slim runtime |
| `apps/discord-gateway/Dockerfile.dockerignore` (new) | Allow-list build context for this Dockerfile only |
| `infra/terraform/discord-gateway/{versions,variables,main,outputs}.tf` (new) | ECR, cluster, secrets, roles, security group, task definition, service, alarm |
| `infra/terraform/discord-gateway/environments/production.tfvars` (new) | Checked-in production run state (`enable_service`) |
| `infra/terraform/discord-gateway/tests/gateway.tftest.hcl` (new) | Plan- and mock-apply-time tests |
| `infra/terraform/state-mgmt/discord-gateway-release.tf` (new), `tests/discord-gateway-release.tftest.hcl` (new) | Main-only OIDC release role |
| `.github/workflows/discord-gateway-release.yml` (new) | Build, push, guarded apply, wait stable, register commands |
| `.github/workflows/terraform.yml` | Add the stack to the validate and test matrix |
| `convex/discordIntake.ts` (plan 03 file), `convex/crons.ts` | `checkHeartbeat` and its cron |
| `tests/backend/discord-gateway-heartbeat.test.ts` (new) | Stale, fresh, and flag-off tests |
| `docs/deployment/discord-gateway.md`, `docs/deployment/convex-environments.md`, `infra/terraform/README.md` | Docs |

---

### Task 1: Gateway container image

**Files:**

- Create: `apps/discord-gateway/Dockerfile`
- Create: `apps/discord-gateway/Dockerfile.dockerignore`

**Interfaces:**

- Consumes: `apps/discord-gateway/package.json` (`@vrdex/discord-gateway`, entry `src/index.ts`, runtime needs `tsx` because imports are extensionless). Plan 03 adds `src/register-commands.ts` and any workspace dependencies.
- Produces: an image whose default command starts the gateway. Task 3 builds it with `docker build --file apps/discord-gateway/Dockerfile .` from the repo root.

- [ ] **Step 1: Write `Dockerfile.dockerignore` as an allow-list**

BuildKit reads `<Dockerfile>.dockerignore` beside the Dockerfile, so other images keep their context. Contents: `*`, then `!package.json`, `!pnpm-lock.yaml`, `!pnpm-workspace.yaml`, `!apps/*/package.json`, `!packages/*/package.json`, `!apps/discord-gateway/**`, `!packages/**` (only needed if plan 03 made the gateway depend on a workspace package; otherwise omit), and finally `**/node_modules`.

- [ ] **Step 2: Write the Dockerfile**

- Stage `build` from `node:24-bookworm-slim`. Run `corepack enable`, which uses the root `packageManager` pin `pnpm@10.15.1`. Set `WORKDIR /repo` and `COPY . .`.
- Then run `pnpm install --frozen-lockfile --ignore-scripts --filter @vrdex/discord-gateway...`. `--ignore-scripts` skips the root `prepare: husky`.
- Then run `pnpm --filter @vrdex/discord-gateway deploy --legacy /out`. Leave out `--prod`, because `tsx` is a devDependency the runtime needs.
- Stage `runtime` from `node:24-bookworm-slim`: `WORKDIR /app`, `COPY --from=build /out .`, `ENV NODE_ENV=production`, `USER node`, `CMD ["node", "--import", "tsx", "src/index.ts"]`.
- Do not use `pnpm start`. Its `prestart` guard belongs to developer worktrees.

- [ ] **Step 3: Build and smoke-test the image**

Run, from the repo root:

```bash
docker build --file apps/discord-gateway/Dockerfile --tag vrdex-discord-gateway:local .
docker run --rm vrdex-discord-gateway:local; echo "exit=$?"
```

Expected: the build succeeds. The run exits non-zero with `DISCORD_BOT_TOKEN is required to start the VRDex Discord Gateway service.`, which proves that `tsx`, `discord.js`, and the entry point resolved. If Docker is unavailable locally, record that in the PR. Task 3's workflow is the build of record.

- [ ] **Step 4: Commit**

```bash
git add apps/discord-gateway/Dockerfile apps/discord-gateway/Dockerfile.dockerignore
git commit -m "build(discord-gateway): add multi-stage container image" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Terraform stack `infra/terraform/discord-gateway`

**Files:**

- Create: `infra/terraform/discord-gateway/versions.tf`, `variables.tf`, `main.tf`, `outputs.tf`, `environments/production.tfvars`
- Test: `infra/terraform/discord-gateway/tests/gateway.tftest.hcl`
- Modify: `.github/workflows/terraform.yml` (dispatch `stack` options, matrix entry, test step condition)

**Interfaces:**

- Consumes: `vrdex-group-telemetry-alerts` SNS topic and `vrdex-group-telemetry-egress` subnet. Both are created by `infra/terraform/group-telemetry-collector/main.tf` (`aws_sns_topic.alerts`, `aws_subnet.egress`, with `name_prefix = "vrdex-group-telemetry"`), and both are looked up by name.
- Produces outputs used by Task 3:
  - `repository_url`
  - `cluster_name`
  - `service_name`, which is `""` while disabled
  - `task_definition_arn`
  - `execution_role_arn`
  - `task_role_arn`
  - `secret_arns`, a map keyed by env name
- Resource addresses Task 3's plan guard allows: `aws_ecs_task_definition.gateway` and `aws_ecs_service.gateway[0]`.

Pinned values. These are the decisions; the implementer writes the HCL.

- **`versions.tf`**
  - Backend `s3`: bucket `vrdex-terraform-state`, key `discord-gateway/terraform.tfstate`, region `us-east-1`, `encrypt = true`, `use_lockfile = true`.
  - Provider `aws ~> 6.0`, region `us-east-1`, `default_tags { tags = local.tags }`.
- **`variables.tf`** (keep to these five, plus `tags`):
  - `container_image`: default `null`. Validation as in the collector: `!var.enable_service || can(regex("@sha256:[0-9a-fA-F]{64}$", ...))`.
  - `enable_service`: bool, default `false`.
  - `convex_site_url`: default `""`. Validation: `!var.enable_service || can(regex("^https://", var.convex_site_url))`, the collector's rule (production may use a Convex custom domain).
  - `egress_subnet_name`: default `"vrdex-group-telemetry-egress"`.
  - `alerts_topic_name`: default `"vrdex-group-telemetry-alerts"`.
- **`locals`**
  - `name = "vrdex-discord-gateway"`
  - `secret_names = ["DISCORD_APPLICATION_ID", "DISCORD_BOT_TOKEN", "DISCORD_INTAKE_SECRET"]`
  - Tags `{ Project = "VRDex", ManagedBy = "Terraform", Component = "discord-gateway" }` merged with `var.tags`.
  - Image: `var.container_image`, falling back to `"${aws_ecr_repository.gateway.repository_url}:bootstrap-placeholder"`.
- **Data sources**
  - `data "aws_sns_topic" "alerts"` with `name = var.alerts_topic_name`.
  - `data "aws_subnet" "egress"` with a `filter` on `tag:Name` set to `var.egress_subnet_name`.
- **ECR:** `aws_ecr_repository.gateway`, name `local.name`, `IMMUTABLE`, scan on push, AES256. The lifecycle policy is copied from the collector (expire untagged images after 7 days).
- **Logs:** `aws_cloudwatch_log_group.gateway`, name `/aws/ecs/vrdex-discord-gateway`, `retention_in_days = 30`.
- **Cluster:** `aws_ecs_cluster.gateway`, name `local.name`, `containerInsights = "enabled"`. The alarm's metric needs it.
- **Secrets:** `aws_secretsmanager_secret.gateway`, `for_each = toset(local.secret_names)`, name `vrdex/discord-gateway/${each.key}`, `recovery_window_in_days = 7`.
  - There is no `aws_secretsmanager_secret_version`. Refreshing a version calls `GetSecretValue` and would copy the bot token into state. The repo has no Terraform-managed secret pattern to follow; the collector and restream stacks take ARNs as variables.
- **IAM**
  - `aws_iam_role.execution` (`${local.name}-execution`), with the `AmazonECSTaskExecutionRolePolicy` attachment.
  - `aws_iam_role_policy.execution_secrets` (name `read-gateway-secrets`), built with `jsonencode`, not a policy-document data source, so tests can decode it. It has exactly one statement: `{ Sid = "ReadGatewaySecrets", Effect = "Allow", Action = "secretsmanager:GetSecretValue", Resource = sort([for s in aws_secretsmanager_secret.gateway : s.arn]) }`.
  - `aws_iam_role.task` (`${local.name}-task`). It gets no permissions: logs and secret injection are execution-role duties.
  - Enforce the empty task role with `aws_iam_role_policies_exclusive.task` (`policy_names = []`) and `aws_iam_role_policy_attachments_exclusive.task` (`policy_arns = []`).
- **Network:** `aws_security_group.gateway`, name `${local.name}-egress`, `vpc_id = data.aws_subnet.egress.vpc_id`, `ingress = []`, and one `egress` rule: TCP 443 to `0.0.0.0/0`. The Discord gateway WSS, Convex, ECR, and CloudWatch Logs all use 443. DNS goes to the VPC resolver, which security groups do not filter.
- **Task definition:** `aws_ecs_task_definition.gateway`
  - Family `local.name`, `FARGATE`, `awsvpc`, `cpu = "256"`, `memory = "512"` (the smallest Fargate size). `runtime_platform { LINUX, X86_64 }`.
  - `skip_destroy = true` and `lifecycle { create_before_destroy = true }`, copied from the collector so the circuit breaker can roll back.
  - One container named `gateway`, `essential = true`, image `local.image`.
  - `environment = [{ name = "CONVEX_SITE_URL", value = var.convex_site_url }]`.
  - `secrets = [for n in local.secret_names : { name = n, valueFrom = aws_secretsmanager_secret.gateway[n].arn }]`.
  - `awslogs` options: group as above, region `us-east-1`, stream prefix `gateway`.
- **Service:** `aws_ecs_service.gateway`, `count = var.enable_service ? 1 : 0`
  - Name `local.name`, `desired_count = 1`, `FARGATE`, `enable_execute_command = false`.
  - `deployment_minimum_healthy_percent = 0` and `deployment_maximum_percent = 100`.
  - `deployment_circuit_breaker { enable = true, rollback = true }`.
  - `network_configuration { subnets = [data.aws_subnet.egress.id], security_groups = [aws_security_group.gateway.id], assign_public_ip = false }`.
- **Alarm:** `aws_cloudwatch_metric_alarm.running_tasks`, `count = var.enable_service ? 1 : 0`
  - Name `${local.name}-missing-task`, namespace `ECS/ContainerInsights`, metric `RunningTaskCount`, dimensions `{ ClusterName, ServiceName }`.
  - `statistic = "Minimum"`, `period = 300`, `evaluation_periods = 1`, `comparison_operator = "LessThanThreshold"`, `threshold = 1`, `treat_missing_data = "breaching"`.
  - `alarm_actions` and `ok_actions` both `[data.aws_sns_topic.alerts.arn]`.
  - `alarm_description`: "The Discord gateway has had no running task for five minutes."
- **`environments/production.tfvars`:** `enable_service = false`, with a header comment in the collector's style. Production enable state lives in git. Task 5's bootstrap flips it to `true` in its own PR once the secrets hold values.

- [ ] **Step 1: Write the failing test file `tests/gateway.tftest.hcl`**

Mocks follow `infra/terraform/restream-worker/tests/bridge.tftest.hcl`:

- `mock_provider "aws"` with these defaults:
  - `mock_data "aws_sns_topic"`: arn `arn:aws:sns:us-east-1:079358094174:vrdex-group-telemetry-alerts`
  - `mock_data "aws_subnet"`: `id = "subnet-0123456789abcdef0"`, `vpc_id = "vpc-0123456789abcdef0"`
  - `mock_data "aws_iam_policy_document"`: the empty-statement JSON
  - `mock_resource "aws_iam_role"`: an arn
- `override_resource` for `aws_ecs_cluster.gateway` (name `vrdex-discord-gateway`).
- File-level `variables` block with:
  - `enable_service = true`
  - `container_image = "079358094174.dkr.ecr.us-east-1.amazonaws.com/vrdex-discord-gateway@sha256:fa5515d574355d6a647ce8390285f62edec1ad4f7e6e98956230c0b1391c2548"`
  - `convex_site_url = "https://example-123.convex.site"`

Runs and assertions:

```hcl
run "default_disabled" {
  command = plan
  variables {
    enable_service  = false
    container_image = null
    convex_site_url = ""
  }
  assert {
    condition     = length(aws_ecs_service.gateway) == 0 && length(aws_cloudwatch_metric_alarm.running_tasks) == 0
    error_message = "Disabled must create no service and no alarm."
  }
  assert {
    condition     = sort(keys(aws_secretsmanager_secret.gateway)) == ["DISCORD_APPLICATION_ID", "DISCORD_BOT_TOKEN", "DISCORD_INTAKE_SECRET"]
    error_message = "The three gateway secrets exist even while disabled, so values can be set before enabling."
  }
}

run "task_role_has_no_permissions" {
  command = apply
  assert {
    condition     = length(aws_iam_role_policies_exclusive.task.policy_names) == 0 && length(aws_iam_role_policy_attachments_exclusive.task.policy_arns) == 0
    error_message = "The task role must hold no inline or managed policies."
  }
  assert {
    condition     = aws_iam_role_policy.execution_secrets.role == aws_iam_role.execution.id
    error_message = "Secret reads belong to the execution role only."
  }
}

run "execution_reads_only_gateway_secrets" {
  command = apply
  assert {
    condition = jsondecode(aws_iam_role_policy.execution_secrets.policy) == {
      Version   = "2012-10-17"
      Statement = [{ Sid = "ReadGatewaySecrets", Effect = "Allow", Action = "secretsmanager:GetSecretValue", Resource = sort([for s in aws_secretsmanager_secret.gateway : s.arn]) }]
    }
    error_message = "Execution role may read exactly the three gateway secrets."
  }
  assert {
    condition = [for s in jsondecode(aws_ecs_task_definition.gateway.container_definitions)[0].secrets : s.name] == ["DISCORD_APPLICATION_ID", "DISCORD_BOT_TOKEN", "DISCORD_INTAKE_SECRET"] && jsondecode(aws_ecs_task_definition.gateway.container_definitions)[0].environment == [{ name = "CONVEX_SITE_URL", value = "https://example-123.convex.site" }]
    error_message = "Container env must be CONVEX_SITE_URL plus the three secrets."
  }
}

run "enabled_service_alarm_and_network" {
  command = apply
  assert {
    condition = (
      aws_cloudwatch_metric_alarm.running_tasks[0].alarm_actions == toset(["arn:aws:sns:us-east-1:079358094174:vrdex-group-telemetry-alerts"]) &&
      aws_cloudwatch_metric_alarm.running_tasks[0].ok_actions == toset(["arn:aws:sns:us-east-1:079358094174:vrdex-group-telemetry-alerts"]) &&
      aws_cloudwatch_metric_alarm.running_tasks[0].metric_name == "RunningTaskCount" &&
      aws_cloudwatch_metric_alarm.running_tasks[0].threshold == 1 &&
      aws_cloudwatch_metric_alarm.running_tasks[0].period == 300 &&
      aws_cloudwatch_metric_alarm.running_tasks[0].evaluation_periods == 1 &&
      aws_cloudwatch_metric_alarm.running_tasks[0].treat_missing_data == "breaching"
    )
    error_message = "The running-task alarm must email through the existing alerts topic, fire after five minutes below one task, and treat no data as breaching."
  }
  assert {
    condition     = aws_ecs_service.gateway[0].desired_count == 1 && aws_ecs_service.gateway[0].deployment_minimum_healthy_percent == 0 && aws_ecs_service.gateway[0].deployment_maximum_percent == 100
    error_message = "Exactly one gateway task, and never two during a deploy."
  }
  assert {
    condition     = length(aws_security_group.gateway.ingress) == 0 && one(aws_security_group.gateway.egress).from_port == 443 && one(aws_security_group.gateway.egress).to_port == 443 && aws_ecs_service.gateway[0].network_configuration[0].assign_public_ip == false
    error_message = "Outbound HTTPS only, no ingress, no public IP."
  }
}

run "rejects_mutable_image" {
  command         = plan
  variables { container_image = "079358094174.dkr.ecr.us-east-1.amazonaws.com/vrdex-discord-gateway:latest" }
  expect_failures = [var.container_image]
}

run "rejects_http_convex_site_url" {
  command         = plan
  variables { convex_site_url = "http://example-123.convex.site" }
  expect_failures = [var.convex_site_url]
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd infra/terraform/discord-gateway && terraform init -backend=false && terraform test -no-color`
Expected: FAIL, with errors about undeclared resources and variables.

- [ ] **Step 3: Implement the four `.tf` files and `environments/production.tfvars` with the pinned values above**

Outputs: `repository_url`, `cluster_name`, `service_name = try(aws_ecs_service.gateway[0].name, "")`, `task_definition_arn`, `execution_role_arn`, `task_role_arn`, and `secret_arns = { for k, s in aws_secretsmanager_secret.gateway : k => s.arn }`.

- [ ] **Step 4: Run tests, validate, and format**

Run: `terraform test -no-color && terraform validate && terraform fmt -check -recursive`
Expected: `Success! 6 passed, 0 failed.`, then `Success! The configuration is valid.`, and no fmt output.

- [ ] **Step 5: Add the stack to `.github/workflows/terraform.yml`**

- Add `discord-gateway` to the `workflow_dispatch` `stack` options.
- Add a matrix entry with `path: infra/terraform/discord-gateway`, copying the `group-telemetry-collector` entry's flags (`backend: "true"`, `plan: "false"`, every `requires_*` `"false"`).
- Extend the test step's condition to `(matrix.stack.name == 'state-mgmt' || matrix.stack.name == 'restream-worker' || matrix.stack.name == 'discord-gateway')`.

- [ ] **Step 6: Commit**

```bash
git add infra/terraform/discord-gateway .github/workflows/terraform.yml
git commit -m "feat(infra): add discord gateway ECS stack with running-task alarm" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Release role and release workflow with command registration

**Files:**

- Create: `infra/terraform/state-mgmt/discord-gateway-release.tf`
- Test: `infra/terraform/state-mgmt/tests/discord-gateway-release.tftest.hcl`
- Create: `.github/workflows/discord-gateway-release.yml`

**Interfaces:**

- Consumes:
  - From Task 2: outputs `repository_url`, `service_name`, `cluster_name`, `execution_role_arn`, `task_role_arn`, and the guarded addresses.
  - From Task 1: the Dockerfile path.
  - From plan 03: the `register-commands` script, which reads `DISCORD_BOT_TOKEN` and `DISCORD_APPLICATION_ID`.
  - From `state-mgmt/main.tf`: `data.aws_iam_openid_connect_provider.github_actions`, `data.aws_caller_identity.current`, `local.state_bucket_arn`, `var.github_repository`.
- Produces:
  - IAM role `vrdex-discord-gateway-release`, output as `discord_gateway_release_role_arn`.
  - GitHub settings the workflow reads: variables `AWS_DISCORD_GATEWAY_RELEASE_ROLE_ARN`, `DISCORD_GATEWAY_RELEASE_ENABLED`, and `GROUP_TELEMETRY_CONVEX_SITE_URL` (reused; it is the same production Convex site); secrets `DISCORD_BOT_TOKEN` and `DISCORD_APPLICATION_ID`.

Role, copying `restream-proof.tf`:

- Gate it on `var.enable_discord_gateway_release_permissions`, a bool defaulting to `false` and declared in the same file.
- Trust is exactly the restream-proof trust: the GitHub OIDC provider, `aud = sts.amazonaws.com`, `sub = repo:${var.github_repository}:ref:refs/heads/main`.
- Inline policy `vrdex-discord-gateway-release`, built with `jsonencode`, with these statements:
  - `GatewayRegistryAuthentication`: `ecr:GetAuthorizationToken` on `*`.
  - `PublishGatewayImages`: `ecr:BatchCheckLayerAvailability`, `ecr:InitiateLayerUpload`, `ecr:UploadLayerPart`, `ecr:CompleteLayerUpload`, `ecr:PutImage`, `ecr:DescribeImages`, `ecr:BatchGetImage`, `ecr:GetDownloadUrlForLayer`, `ecr:DescribeRepositories`, `ecr:GetLifecyclePolicy`, `ecr:ListTagsForResource`. Resource `arn:aws:ecr:us-east-1:${account}:repository/vrdex-discord-gateway`.
  - `GatewayState`: `s3:GetObject`, `s3:PutObject`, `s3:DeleteObject` on `${local.state_bucket_arn}/discord-gateway/terraform.tfstate` and `.../terraform.tfstate.tflock`; `s3:ListBucket` on `local.state_bucket_arn`.
  - `RefreshGatewayStack` (read-only; resource `*`, because these describe calls do not support resource scoping): `ecs:DescribeClusters`, `ecs:DescribeServices`, `ecs:DescribeTaskDefinition`, `ec2:DescribeSubnets`, `ec2:DescribeSecurityGroups`, `ec2:DescribeVpcs`, `sns:GetTopicAttributes`, `sns:ListTagsForResource`, `logs:DescribeLogGroups`, `logs:ListTagsForResource`, `cloudwatch:DescribeAlarms`, `cloudwatch:ListTagsForResource`, `secretsmanager:DescribeSecret`, `secretsmanager:GetResourcePolicy`, `iam:GetRole`, `iam:GetRolePolicy`, `iam:ListRolePolicies`, `iam:ListAttachedRolePolicies`.
    - There is no `secretsmanager:GetSecretValue`. Task 2 created no secret versions, so refresh never needs it.
  - `RollGatewayService`: `ecs:RegisterTaskDefinition`, `ecs:DeregisterTaskDefinition`, `ecs:TagResource` on `*`, and `ecs:UpdateService` on `arn:aws:ecs:us-east-1:${account}:service/vrdex-discord-gateway/vrdex-discord-gateway`.
  - `PassGatewayRoles`: `iam:PassRole` on `arn:aws:iam::${account}:role/vrdex-discord-gateway-execution` and `...-task`, with condition `iam:PassedToService = ecs-tasks.amazonaws.com`.

- [ ] **Step 1: Write the failing state-mgmt test**

Copy the mocks and `variables { route53_zone_id = "ZTESTONLY" }` from `tests/restream-proof.tftest.hcl`. Add these runs:

- `default_disabled` (plan): `length(aws_iam_role.discord_gateway_release) == 0`.
- `enabled_release_role` (plan, `enable_discord_gateway_release_permissions = true`):
  - The decoded trust equals the main-only document. Copy the restream-proof assertion with role name `vrdex-discord-gateway-release`.
  - The decoded policy has no statement whose `Action` includes `secretsmanager:GetSecretValue`: `alltrue([for s in jsondecode(aws_iam_role_policy.discord_gateway_release[0].policy).Statement : !contains(flatten([s.Action]), "secretsmanager:GetSecretValue")])`.
  - `UpdateService` is scoped to the one service ARN: `one([for s in jsondecode(aws_iam_role_policy.discord_gateway_release[0].policy).Statement : s if s.Sid == "RollGatewayService"]).Resource` contains the exact service ARN.

- [ ] **Step 2: Run it and verify it fails**

Run: `cd infra/terraform/state-mgmt && terraform init -backend=false && terraform test -no-color -filter=tests/discord-gateway-release.tftest.hcl`
Expected: FAIL, with undeclared `aws_iam_role.discord_gateway_release`.

- [ ] **Step 3: Implement `discord-gateway-release.tf`**

Use the statements above. Add output `discord_gateway_release_role_arn = try(aws_iam_role.discord_gateway_release[0].arn, null)`.

- [ ] **Step 4: Run the state-mgmt tests**

Run: `terraform test -no-color && terraform fmt -check`
Expected: all runs pass, including the existing `restream-proof` runs.

- [ ] **Step 5: Write `.github/workflows/discord-gateway-release.yml`**

- **Triggers:** `push` on `main` with `paths: [apps/discord-gateway/**, .github/workflows/discord-gateway-release.yml]`, and `workflow_dispatch`.
- **Job settings:**
  - `concurrency: discord-gateway-release`, `cancel-in-progress: false`.
  - Job `if: vars.DISCORD_GATEWAY_RELEASE_ENABLED == 'true'`. The job is skipped, not failed, before bootstrap.
  - `permissions: { contents: read, id-token: write }`, `timeout-minutes: 30`.
  - Env: `AWS_REGION: us-east-1`, `ECR_REPOSITORY: vrdex-discord-gateway`, `ECS_CLUSTER: vrdex-discord-gateway`, `TF_VAR_convex_site_url: ${{ vars.GROUP_TELEMETRY_CONVEX_SITE_URL }}`.
- **Steps, in order:**
  1. Checkout with `fetch-depth: 0`. Fail unless `git merge-base --is-ancestor HEAD origin/main`. Set `RELEASE_SHA` and `IMAGE_TAG=git-$RELEASE_SHA`.
  2. `aws-actions/configure-aws-credentials@v6` with `role-to-assume: ${{ vars.AWS_DISCORD_GATEWAY_RELEASE_ROLE_ARN }}`.
  3. `hashicorp/setup-terraform@v4` with `terraform_version: 1.10.5` and `terraform_wrapper: false`. Then `terraform -chdir=infra/terraform/discord-gateway init`.
  4. Resolve the image. Copy the collector's "Resolve repository and immutable image" step, swapping in `--file apps/discord-gateway/Dockerfile` and adding `--platform linux/amd64`. Export `IMAGE_URI=$repository_url@$digest`.
  5. Plan: `TF_VAR_container_image="$IMAGE_URI" terraform plan -out=gateway.tfplan -var-file=environments/production.tfvars`, then `terraform show -json gateway.tfplan > plan.json`.
  6. Guard: refuse anything but an image roll. Run `jq -e '[.resource_changes[] | select(.change.actions != ["no-op"]) | .address] - ["aws_ecs_task_definition.gateway","aws_ecs_service.gateway[0]"] | length == 0' plan.json`, and on failure emit `::error::Release plans may change only the gateway task definition and service; apply infrastructure changes manually.`
  7. `terraform apply -auto-approve gateway.tfplan`.
  8. If `terraform output -raw service_name` is non-empty, run `aws ecs wait services-stable --cluster "$ECS_CLUSTER" --services vrdex-discord-gateway`. Then fail if `services[0].deployments[?status=='PRIMARY']|[0].rolloutState` does not become `COMPLETED` within 600 s, using the collector's polling loop.
  9. Set up pnpm (`pnpm/action-setup@v6`) and Node 24 with the pnpm cache. Run `pnpm install --frozen-lockfile --filter @vrdex/discord-gateway...`.
  10. Register commands with `pnpm --filter @vrdex/discord-gateway register-commands`, setting env `DISCORD_BOT_TOKEN: ${{ secrets.DISCORD_BOT_TOKEN }}` and `DISCORD_APPLICATION_ID: ${{ secrets.DISCORD_APPLICATION_ID }}`. This runs after the image push and roll, so commands never point at code that is not running.

- [ ] **Step 6: Check the guard expression locally against both outcomes**

Run, in Git Bash (the runner has `jq`; this machine may not, so use `node -e` with the same filter logic if `jq` is missing):

```bash
echo '{"resource_changes":[{"address":"aws_ecs_task_definition.gateway","change":{"actions":["create","delete"]}},{"address":"aws_ecs_service.gateway[0]","change":{"actions":["update"]}}]}' > ok.json
echo '{"resource_changes":[{"address":"aws_cloudwatch_metric_alarm.running_tasks[0]","change":{"actions":["delete"]}}]}' > bad.json
```

Expected: the filter exits 0 on `ok.json` and 1 on `bad.json`. Delete both files.

- [ ] **Step 7: Lint the workflow**

Run: `pnpm exec prettier --check .github/workflows/discord-gateway-release.yml .github/workflows/terraform.yml`
Expected: clean, or apply `--write`.

- [ ] **Step 8: Commit**

```bash
git add infra/terraform/state-mgmt/discord-gateway-release.tf infra/terraform/state-mgmt/tests/discord-gateway-release.tftest.hcl .github/workflows/discord-gateway-release.yml
git commit -m "ci(discord-gateway): add main-only release role and image release workflow" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Heartbeat staleness check

**Files:**

- Modify: `convex/discordIntake.ts` (created by plan 03; add `checkHeartbeat`)
- Modify: `convex/crons.ts`
- Test: `tests/backend/discord-gateway-heartbeat.test.ts`

**Interfaces:**

- Consumes:
  - From plan 02: `notifyOps(ctx: MutationCtx | ActionCtx, alert: { key: string; subject: string; body: string }): Promise<void>` in `convex/_opsAlerts.ts`, `resolveOps(ctx, key: string): Promise<void>` in the same file, and their table `opsAlerts { key, lastSentAt, resolvedAt? }`.
  - From plan 03: the table `discordGatewayHeartbeats { instanceId: string, at: number, receivedAt: number }` with index `by_receivedAt`. `internal.discordIntake.recordHeartbeat` upserts one row per `instanceId` and stamps `receivedAt: Date.now()` from the Convex clock. Staleness uses `receivedAt` only, never the gateway-supplied `at`.
- Produces: `internal.discordIntake.checkHeartbeat`, an `internalMutation({ args: {} })` returning `{ checked: false } | { checked: true; stale: boolean; newestAt: number | null }`.

- [ ] **Step 1: Write the failing tests**

Use the `convexTest(schemaModule, modules)` setup from existing `tests/backend/*.test.ts`. Set `process.env.VRDEX_DISCORD_INTAKE_ENABLED` per test and restore it in `afterEach`. `seedHeartbeat(t, receivedAt)` inserts `{ instanceId: crypto.randomUUID(), at: receivedAt, receivedAt }` into `discordGatewayHeartbeats` with `t.run(ctx => ctx.db.insert(...))`. Read alerts with `t.run(ctx => ctx.db.query("opsAlerts").collect())`.

```ts
it("alerts when the newest heartbeat is older than 300 s", async () => {
  process.env.VRDEX_DISCORD_INTAKE_ENABLED = "true";
  await seedHeartbeat(t, Date.now() - 301_000);
  const result = await t.mutation(internal.discordIntake.checkHeartbeat, {});
  assert.equal(result.checked && result.stale, true);
  assert.deepEqual((await opsAlerts(t)).map((a) => a.key), ["discord_gateway_heartbeat_stale"]);
});
it("stays quiet when a heartbeat arrived within 300 s", async () => {
  process.env.VRDEX_DISCORD_INTAKE_ENABLED = "true";
  await seedHeartbeat(t, Date.now() - 301_000);
  await seedHeartbeat(t, Date.now() - 299_000); // newest wins
  const result = await t.mutation(internal.discordIntake.checkHeartbeat, {});
  assert.equal(result.checked && result.stale, false);
  assert.equal((await opsAlerts(t)).length, 0);
});
it("resolves once when a fresh heartbeat follows a stale alert", async () => {
  process.env.VRDEX_DISCORD_INTAKE_ENABLED = "true";
  await seedHeartbeat(t, Date.now() - 301_000);
  await t.mutation(internal.discordIntake.checkHeartbeat, {}); // stale: alert
  await seedHeartbeat(t, Date.now());
  await t.mutation(internal.discordIntake.checkHeartbeat, {}); // fresh: resolve
  const [first] = await opsAlerts(t);
  assert.equal(typeof first.resolvedAt, "number");
  await t.mutation(internal.discordIntake.checkHeartbeat, {}); // still fresh: no second resolved email
  const [second] = await opsAlerts(t);
  assert.equal(second.resolvedAt, first.resolvedAt);
});
it("alerts when no heartbeat was ever recorded", async () => {
  process.env.VRDEX_DISCORD_INTAKE_ENABLED = "true";
  const result = await t.mutation(internal.discordIntake.checkHeartbeat, {});
  assert.deepEqual(result, { checked: true, stale: true, newestAt: null });
  assert.equal((await opsAlerts(t)).length, 1);
});
it("skips while intake is disabled", async () => {
  delete process.env.VRDEX_DISCORD_INTAKE_ENABLED;
  const result = await t.mutation(internal.discordIntake.checkHeartbeat, {});
  assert.deepEqual(result, { checked: false });
  assert.equal((await opsAlerts(t)).length, 0);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --conditions=import --import tsx --test tests/backend/discord-gateway-heartbeat.test.ts`
Expected: FAIL, because `internal.discordIntake.checkHeartbeat` is undefined.

- [ ] **Step 3: Implement `checkHeartbeat`**

- Return `{ checked: false }` unless `process.env.VRDEX_DISCORD_INTAKE_ENABLED === "true"`.
- Read `newestAt` as the `receivedAt` of `ctx.db.query("discordGatewayHeartbeats").withIndex("by_receivedAt").order("desc").first()`.
- Treat the gateway as stale when there is no row (`newestAt === null`) or when `Date.now() - newestAt > 300_000`.
- When stale, call `notifyOps(ctx, { key: "discord_gateway_heartbeat_stale", subject, body })`:
  - `subject`: `Discord gateway heartbeat is stale`. `notifyOps` adds the `[VRDex ops]` prefix itself.
  - `body`: `Newest heartbeat: ${newestAt === null ? "never" : new Date(newestAt).toISOString()}. Threshold: 300 s. Check ECS service vrdex-discord-gateway and log group /aws/ecs/vrdex-discord-gateway.`
- `notifyOps` dedupes to one email per six hours.
- When fresh, call `resolveOps(ctx, "discord_gateway_heartbeat_stale")`. It sends one `[VRDex ops] Resolved:` email only while the key is alerting, so calling it on every fresh check is correct.
- Export the 300 s threshold as `DISCORD_GATEWAY_HEARTBEAT_STALE_MS = 300_000` from the same file.

- [ ] **Step 4: Register the cron in `convex/crons.ts`**

Next to the other five-minute intervals, add `crons.interval("check discord gateway heartbeat", { minutes: 5 }, internal.discordIntake.checkHeartbeat, {});`.

- [ ] **Step 5: Run the tests and typecheck**

Run: `node --conditions=import --import tsx --test tests/backend/discord-gateway-heartbeat.test.ts && pnpm exec tsc --noEmit -p convex`
Expected: 5 passing, with no type errors.

- [ ] **Step 6: Commit**

```bash
git add convex/discordIntake.ts convex/crons.ts tests/backend/discord-gateway-heartbeat.test.ts
git commit -m "feat(discord-intake): alert when the gateway heartbeat goes stale" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Deployment docs and bootstrap runbook

**Files:**

- Modify (rewrite): `docs/deployment/discord-gateway.md`
- Modify: `docs/deployment/convex-environments.md`
- Modify: `infra/terraform/README.md` (one paragraph after the collector paragraph, plus a Stack Boundaries bullet)

**Interfaces:**

- Consumes: every name above.
- Produces: none.

- [ ] **Step 1: Rewrite `docs/deployment/discord-gateway.md`**

Keep the existing "Shared Media Command Routing" and "ACK And Stale Panel Behavior" sections unchanged. Replace everything else with these sections:

- **Status:** deployed by `infra/terraform/discord-gateway`. The process also relays announcement messages, scheduled-event changes, and `/vrdex` commands to Convex (plan 03 describes the relay). The intents are `Guilds`, `GuildMessages`, `MessageContent`, and `GuildScheduledEvents`. `MessageContent` is privileged, and this design is its approval.
- **Runtime:** one Fargate task (256 CPU, 512 MiB) in cluster and service `vrdex-discord-gateway`.
  - It sits in the collector's NAT-routed subnet `vrdex-group-telemetry-egress` with security group `vrdex-discord-gateway-egress` (outbound 443 only, no ingress, no public IP).
  - Logs go to `/aws/ecs/vrdex-discord-gateway`, kept for 30 days.
  - Deploys stop the old task before starting the new one. Messages posted during that gap of a minute or two are relayed by the gateway's catch-up on start (plan 03).
- **Environment:** a table of `DISCORD_BOT_TOKEN`, `DISCORD_APPLICATION_ID`, and `DISCORD_INTAKE_SECRET` (Secrets Manager `vrdex/discord-gateway/...`) and `CONVEX_SITE_URL` (Terraform variable `convex_site_url`, from GitHub variable `GROUP_TELEMETRY_CONVEX_SITE_URL` in releases). Columns: name, source, owner (BASIC), rotation.
  - The bot token is also stored as GitHub secret `DISCORD_BOT_TOKEN` for command registration. Rotating it means updating both, then dispatching the release workflow.
  - `DISCORD_INTAKE_SECRET` must equal the Convex env value. Rotate by writing the new value to Secrets Manager and Convex, then forcing a new deployment. Heartbeats return 401 in between, and an outage longer than five minutes raises the heartbeat alert.
- **Alarms:**
  - `vrdex-discord-gateway-missing-task` (ECS `RunningTaskCount` below 1 for 5 minutes, missing data breaching) emails through SNS topic `vrdex-group-telemetry-alerts`, the collector topic subscribed to `basic@basicbit.net`.
  - The heartbeat check `internal.discordIntake.checkHeartbeat` runs every 5 minutes and emails through `notifyOps` (key `discord_gateway_heartbeat_stale`, at most once per six hours) when the newest heartbeat is older than 300 s. It sends one resolved email through `resolveOps` when heartbeats return. It is silent while `VRDEX_DISCORD_INTAKE_ENABLED` is off.
- **Releases:** describe `.github/workflows/discord-gateway-release.yml`: when it triggers, the image-only plan guard, and command registration after the roll. Any infrastructure change is a manual `terraform apply -var-file=environments/production.tfvars`.
- **Bootstrap (BASIC, once), as a numbered list:**
  1. **Developer portal.** On the existing VRDex Discord application:
     - Bot page: enable **Message Content Intent**. Leave Presence and Server Members off.
     - Installation: guild install with scopes `bot` and `applications.commands`, and the permission integer `17600776072192`. That integer is `DISCORD_BOT_PERMISSIONS` from `convex/_discordRest.ts`, the same value plan 03's invite URL uses. It grants seven permissions: View Channel, Send Messages, Manage Messages, Embed Links, Read Message History, Manage Events, and Create Events.
     - Leave the Interactions Endpoint URL empty.
     - Confirm the app's server count is under 100. Above 100, message content needs Discord's verification.
  2. **Release role.** Apply `infra/terraform/state-mgmt` locally with `enable_discord_gateway_release_permissions = true`. Store `terraform output -raw discord_gateway_release_role_arn` in GitHub variable `AWS_DISCORD_GATEWAY_RELEASE_ROLE_ARN`.
  3. **Confirm the shared resources exist.**
     - Run `aws ec2 describe-subnets --filters Name=tag:Name,Values=vrdex-group-telemetry-egress` and expect exactly one subnet.
     - Run `aws sns list-subscriptions-by-topic` on the alerts topic and expect a confirmed `basic@basicbit.net` email subscription.
  4. **First stack apply.** In `infra/terraform/discord-gateway`, run `terraform init` and `terraform apply -var-file=environments/production.tfvars -var convex_site_url=...`. With `enable_service = false`, this creates the repository, secrets, roles, and network only.
  5. **Write secret values.**
     - Write each secret value with `aws secretsmanager put-secret-value --secret-id vrdex/discord-gateway/NAME --secret-string "$VALUE"` from Git Bash, with values read by `$(...)` so there is no trailing newline.
     - Set the same `DISCORD_INTAKE_SECRET` on production Convex as in "Setting secret values without corrupting them" in `convex-environments.md`.
     - Set GitHub secrets `DISCORD_BOT_TOKEN` and `DISCORD_APPLICATION_ID`.
  6. **First release.** Set GitHub variable `DISCORD_GATEWAY_RELEASE_ENABLED=true` and dispatch the release workflow. This pushes the first image and registers commands; there is no service yet.
  7. **Enable the service.** Open a PR setting `enable_service = true` in `environments/production.tfvars`. After merge, apply it manually with `-var container_image=` set to the digest the release printed. This creates the service and the running-task alarm.
  8. **Turn on intake.** Set `VRDEX_DISCORD_INTAKE_ENABLED=true` on production Convex. Confirm a heartbeat lands within two minutes.
- **Rollout:** after that, follow the spec's Rollout section. The first binding is BASIC's own community, in `hold` mode, moving to `autopublish` after a week of clean runs.

- [ ] **Step 2: Update `docs/deployment/convex-environments.md`**

Add a "Discord gateway" section after "Transactional Email Environment" with these entries. If plan 03 already documented either name, extend its entry with the pairing and rotation text instead of duplicating it.

- `DISCORD_INTAKE_SECRET`: Convex production. It must match Secrets Manager `vrdex/discord-gateway/DISCORD_INTAKE_SECRET`. Owner: BASIC. Rotation is as in `discord-gateway.md`.
- `VRDEX_DISCORD_INTAKE_ENABLED`: Convex. Default off. While it is off, the heartbeat check is silent.

The heartbeat check adds no AWS credential on Convex. It emails through `notifyOps`, whose `VRDEX_OPS_ALERT_EMAIL` and SES chain plan 02 documents.

- [ ] **Step 3: Update `infra/terraform/README.md`**

- After the collector release paragraph, add: "The Discord gateway uses `.github/workflows/discord-gateway-release.yml` for image rolls; its bootstrap is in `docs/deployment/discord-gateway.md`."
- Under Stack Boundaries, add: "keep `discord-gateway/` separate because it holds the Discord bot's secrets and has its own release role".

- [ ] **Step 4: Lint the docs and check the build**

Run: `pnpm exec markdownlint-cli2 docs/deployment/discord-gateway.md docs/deployment/convex-environments.md infra/terraform/README.md`
Expected: `0 error(s)`.

Then grep the two docs for `<http` and for angle-bracket placeholders outside code fences.
Expected: none.

- [ ] **Step 5: Commit**

```bash
git add docs/deployment/discord-gateway.md docs/deployment/convex-environments.md infra/terraform/README.md
git commit -m "docs(discord-gateway): document deployment, alarms, and bootstrap" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```
