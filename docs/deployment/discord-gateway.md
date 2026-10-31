# Discord Gateway Service

## Status

Deployed by `infra/terraform/discord-gateway`, production only. Staging has no gateway.

The process relays announcement messages and `/vrdex` commands to Convex. Media controls in the checked-in runtime are ACK/routing-only; they do not enqueue Convex commands or mutate live media.

## Runtime

`apps/discord-gateway` is a dedicated long-running Discord Gateway adapter for VRDex media controls and Discord announcement intake. It uses `discord.js` v14 on Node 24 and requests the `Guilds`, `GuildMessages`, `MessageContent`, and `GuildScheduledEvents` intents. `MessageContent` is privileged, and BASIC approved it for this design. Verification is not needed under 100 servers.

The service is intentionally Gateway-first. Do not configure a Discord HTTP Interactions Endpoint URL for this app while interactions are delivered through Gateway events.

The runtime entrypoint acknowledges interactions quickly and keeps provider mutation out of the package:

- It does not create or update Discord applications.
- It does not mutate guild state.
- It does not register commands at startup; `pnpm --filter @vrdex/discord-gateway register-commands` is the separate step that does.

It runs as one Fargate task (256 CPU, 512 MiB) in cluster and service `vrdex-discord-gateway`:

- It sits in the collector's NAT-routed subnet `vrdex-group-telemetry-egress` with security group `vrdex-discord-gateway-egress` (outbound 443 only, no ingress, no public IP).
- Logs go to `/aws/ecs/vrdex-discord-gateway`, kept for 30 days.
- Deploys stop the old task before starting the new one, so two gateway connections never overlap. Posts made during that gap of a minute or two are relayed by the catch-up on start, described under Announcement Intake.

## Announcement Intake

- Posts are relayed only from channels with an active `discord_announcements` connector, looked up per channel and cached for 60 seconds. Creates, edits, deletes, and each message of a bulk delete all follow this path. Convex ignores a create or update whose content and attachments match the stored row, and a repeat delete, so link unfurls, pins, and redelivery start no run.
- Bot posts, system messages, and posts with neither text nor an image are dropped. Image attachments are the only attachments relayed.
- At startup the runtime replays up to 100 posts per connected channel made while it was down, starting from the newest stored post. Channels with no stored post are skipped. Replays are safe to repeat because Convex upserts by message ID.
- A relay failure logs one JSON line with the message ID and is not retried. The post is recovered only if a later restart's replay still reaches it.
- `/vrdex connect`, `/vrdex disconnect`, and `/vrdex status` need Manage Server by default. `pnpm --filter @vrdex/discord-gateway register-commands` registers them globally through `DISCORD_APPLICATION_ID` and `DISCORD_BOT_TOKEN`. Rerun it when the command tree changes.
- The runtime posts a heartbeat to Convex every minute while its Discord session is ready, so a dropped session stops the beat. Heartbeat failures log one JSON line and never stop the process.
- A failed interaction handler and a Discord client error each log one JSON line and never stop the process.
- Each failure logs one JSON line. It may carry a message ID, a connector ID, an HTTP status, and a Discord numeric error code. Logs never carry the bot token, the intake secret, URLs, or message content.

Deployment is under [Bootstrap](#bootstrap), and the heartbeat alert is under [Alarms](#alarms).

## Shared Media Command Routing

Discord controls route to the existing Convex media command model:

- `start` maps to `start_program`.
- `stop` maps to `stop_program`.
- `hold` maps to `switch_hold`.
- `next` maps to `next_slot`.
- `previous` maps to `previous_slot`.
- `source` maps to `switch_source` with `targetSourceKey` from a select menu.
- `fallback` maps to `force_direct_link_fallback` with submitted public fallback links.
- `publish_watch_link` maps to `publish_current_public_watch_link`.
- `refresh` updates the Discord panel and does not enqueue a media command.

Component `custom_id` values use compact routing hints in the form `vrdex:mc:<action>:<eventId>:r<revision>`. They are limited to Discord's 100-character `custom_id` cap and must not be treated as trusted authorization state.

## ACK And Stale Panel Behavior

Buttons and selects should immediately use `deferUpdate()` only when the server has loaded the current panel revision and verified that the component is current. Slash commands and modal submissions should immediately use ephemeral deferred replies.

If a component carries an old panel revision, or the runtime cannot verify freshness, the bot should send an ephemeral warning and avoid enqueueing a media command. Operators must refresh the panel before sending live controls from stale Discord components.

Dangerous live actions such as `stop` and `fallback` are marked confirmation-gated in the routing layer and do not expose an enqueueable command until confirmation succeeds. The first implementation records the routing contract; the confirmation UI and Convex enqueue call are follow-on integration work.

## Environment

| Name | Source | Owner | Rotation |
| --- | --- | --- | --- |
| `DISCORD_BOT_TOKEN` | Secrets Manager `vrdex/discord-gateway/DISCORD_BOT_TOKEN` | BASIC | Three places, below |
| `DISCORD_APPLICATION_ID` | Secrets Manager `vrdex/discord-gateway/DISCORD_APPLICATION_ID` | BASIC | Changes only when the gateway moves to another Discord application |
| `DISCORD_INTAKE_SECRET` | Secrets Manager `vrdex/discord-gateway/DISCORD_INTAKE_SECRET` | BASIC | Two places, below |
| `CONVEX_SITE_URL` | Terraform variable `convex_site_url`, from GitHub variable `GROUP_TELEMETRY_CONVEX_SITE_URL` in releases | BASIC | Not a secret. Update the GitHub variable and release |

Startup throws when `DISCORD_BOT_TOKEN`, `CONVEX_SITE_URL`, or `DISCORD_INTAKE_SECRET` is missing. ECS also refuses to start a task while any of the three secrets has no value.

ECS injects secrets at task start, so a running task keeps its old values until it is replaced. This is how a task picks up a new secret:

```bash
aws ecs update-service --region us-east-1 --cluster vrdex-discord-gateway --service vrdex-discord-gateway --force-new-deployment
```

A release does not replace this step: with no image change it leaves the running task alone.

**Rotate the bot token** by resetting it in the Discord developer portal, which revokes the old value at once, then writing the new value to all three holders and forcing a new deployment:

- Secrets Manager `vrdex/discord-gateway/DISCORD_BOT_TOKEN`.
- `DISCORD_BOT_TOKEN` in GitHub environment `discord-gateway-commands`, used by command registration.
- Convex `DISCORD_BOT_TOKEN`, used by the Integrations page. It must be the same application's token.

**Rotate `DISCORD_INTAKE_SECRET`** by writing the new value to Secrets Manager and Convex, then forcing a new deployment. The value must equal the Convex env value. Heartbeats and relays return 401 in between, and an outage longer than five minutes raises the heartbeat alert.

Future media enqueue integration should add a scoped service credential. Do not store stream keys, ingest URLs, or provider credentials in Discord messages, command payloads, logs, or ordinary event records.

## Values BASIC Provides

| Name | Where | How to generate or find it | Required |
| --- | --- | --- | --- |
| `vrdex/discord-gateway/DISCORD_BOT_TOKEN` | Secrets Manager | The production Convex `DISCORD_BOT_TOKEN`. Resetting it in the portal revokes every copy | Yes |
| `vrdex/discord-gateway/DISCORD_APPLICATION_ID` | Secrets Manager | Portal, General Information page | Yes |
| `vrdex/discord-gateway/DISCORD_INTAKE_SECRET` | Secrets Manager | `openssl rand -base64 32` | Yes |
| `DISCORD_BOT_TOKEN` | GitHub environment `discord-gateway-commands` secret | Same value as Secrets Manager | Yes, for command registration |
| `DISCORD_APPLICATION_ID` | GitHub environment `discord-gateway-commands` secret | Same value as Secrets Manager | Yes, for command registration |
| `AWS_DISCORD_GATEWAY_RELEASE_ROLE_ARN` | GitHub variable | `terraform output -raw discord_gateway_release_role_arn` in `infra/terraform/state-mgmt` | Yes |
| `DISCORD_GATEWAY_RELEASE_ENABLED` | GitHub variable | `true`. Anything else skips every release | Yes |
| `GROUP_TELEMETRY_CONVEX_SITE_URL` | GitHub variable | Production Convex HTTP actions origin. Shared with the collector release | Yes |
| `DISCORD_INTAKE_SECRET` | Convex production | Same value as Secrets Manager | Yes |
| `DISCORD_APPLICATION_ID` | Convex production | Same value as Secrets Manager. The Integrations page builds the bot invite from it | Yes |
| `DISCORD_BOT_TOKEN` | Convex production | The gateway application's bot token | Yes |
| `VRDEX_DISCORD_POSTER_TOKEN` | Web app first, then Convex production | `openssl rand -base64 32`. Web side is Vercel Terraform variable `discord_poster_token`, but see the note below this table before using it | For posters. Unset on either side, runs continue with the post text |
| `OPENAI_API_KEY` | Convex production | OpenAI project API keys | Yes |
| `VRDEX_EVENT_INTAKE_AI_ENABLED` | Convex production | `true` | Yes |
| `VRDEX_EVENT_INTAKE_MODEL` | Convex production | A model name | No, defaults to `gpt-5.6-luna` |
| `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_BASE_URL` | Convex production | Langfuse project settings | No. Missing keys disable tracing |
| `VRDEX_EVENT_CONNECTORS_ENABLED` | Convex production | `true`. While it is off, runs close as `connector_inactive` | Yes |
| `VRDEX_DISCORD_INTAKE_ENABLED` | Convex production | `true`, at step 9 of the bootstrap | Yes |
| `SITE_URL` | Convex production | `https://vrdex.net`. Runs use it as the poster bridge origin | Yes |

[Convex environments](./convex-environments.md#discord-intake) describes what each Convex value does.

BASIC owns every value here. Rotation for the release settings:

- `AWS_DISCORD_GATEWAY_RELEASE_ROLE_ARN`: not a secret. It changes only if the role is recreated; rerun the `gh variable set` in step 2.
- `DISCORD_GATEWAY_RELEASE_ENABLED`: not a secret, nothing to rotate. Any value but `true` stops releases.
- `DISCORD_APPLICATION_ID` in GitHub environment `discord-gateway-commands`: changes only when the gateway moves to another Discord application. Update it with the Secrets Manager and Convex values.

With extraction off or `OPENAI_API_KEY` unset, every run fails with `extraction_unavailable`. After three failed runs in a row the `discord-intake:<connectorId>` ops alert fires. Set the extraction values before binding a channel.

The Terraform workflow passes no value for `discord_poster_token`, so a CI apply of the `vercel` stack removes a token set by a local apply. Until the workflow passes one, set `VRDEX_DISCORD_POSTER_TOKEN` directly on the Vercel project and redeploy. Vercel changes reach new deployments only.

## Alarms

`vrdex-discord-gateway-missing-task` reads ECS `RunningTaskCount` with `Maximum` over five minutes, with missing data breaching.

- It means no running task for a whole five-minute window. Allow up to ten minutes for it to fire.
- A deploy's gap of a minute or two does not trip it.
- A crash-looping task that runs at all in each window does not trip it. The heartbeat alert covers that case once the Discord session stops being ready.
- It may fire once right after the service is first created, before metrics exist.
- It emails alarm and recovery through SNS topic `vrdex-group-telemetry-alerts`, the collector topic subscribed to `basic@basicbit.net`.
- That topic exists only while the collector stack is enabled. Disabling the collector stack removes the topic and leaves this alarm with no action. Every plan of this stack, release plans included, then fails at the topic lookup until the topic exists again. The heartbeat email still works.

`internal.discordIntake.checkHeartbeat` runs every five minutes.

- It emails through `notifyOps` (key `discord_gateway_heartbeat_stale`, at most once per six hours) when the newest heartbeat received is older than 300 seconds, or when none exists.
- It sends one resolved email through `resolveOps` when heartbeats return.
- It is silent while `VRDEX_DISCORD_INTAKE_ENABLED` is off.

`internal.discordIntake.sweepStalledRuns` runs every five minutes.

- A run still `running` 15 minutes after it started is closed as `stalled`. Only the sweep closes stalled runs.
- Its posts are requeued once, and it emails `discord-intake:<connectorId>`, resolved by the connector's next finished run. A retry counts against the connector's daily cap of 20 runs.
- When posts are not requeued, because the retry also stalled or the connector is paused or off, it emails `discord-intake-dropped:<runId>`. Those posts need a real edit to run again.

All three Convex alerts use the [ops alert path](./convex-environments.md#ops-alerts).

## Releases

`.github/workflows/discord-gateway-release.yml` rolls the image. It runs on a push to `main` that touches `apps/discord-gateway/**` or the workflow file, and on dispatch, and only while `DISCORD_GATEWAY_RELEASE_ENABLED` is `true`. A change outside those paths, such as a lockfile bump, needs a dispatch:

```bash
gh workflow run discord-gateway-release.yml --ref main
```

Each run:

1. Builds and pushes the image tagged `git-` plus the commit SHA, or reuses it if already published.
2. Saves a Terraform plan and refuses it unless it changes only `aws_ecs_task_definition.gateway` and `aws_ecs_service.gateway[0]`.
3. Applies that saved plan and waits for the rollout. A circuit-breaker rollback fails the job, even though ECS reports the rollout complete, because the job compares the running task definition with the one it applied.
4. Registers slash commands in its own job after the roll, from the `discord-gateway-commands` environment, including while the service is disabled. A failed roll registers nothing.

Any failed job emails through `vrdex-group-telemetry-alerts`: a failed roll, a plan guard refusal, a rollback, or a failed registration.

CI validates and tests this stack and never plans or applies it. Any infrastructure change is a manual apply, which must pass the image and origin, or validation rejects the plan once `enable_service = true`. Reuse the running image so the apply does not roll it:

```bash
cd infra/terraform/discord-gateway
TASK_DEFINITION=$(aws ecs describe-services --region us-east-1 --cluster vrdex-discord-gateway --services vrdex-discord-gateway --query 'services[0].taskDefinition' --output text | tr -d '\r')
CONTAINER_IMAGE=$(aws ecs describe-task-definition --region us-east-1 --task-definition "$TASK_DEFINITION" --query 'taskDefinition.containerDefinitions[0].image' --output text | tr -d '\r')
CONVEX_SITE_URL=$(gh variable get GROUP_TELEMETRY_CONVEX_SITE_URL)
terraform apply -var-file=environments/production.tfvars -var "container_image=$CONTAINER_IMAGE" -var "convex_site_url=$CONVEX_SITE_URL"
```

## Bootstrap

BASIC runs this once, from Git Bash at the root of a `main` checkout. Before starting:

- Run `pnpm install` in that checkout.
- Have `CONVEX_DEPLOYMENT_PROD` and `CONVEX_DEPLOY_KEY_PROD` in the main checkout's `.env.local`, which `scripts/cx.ts` reads for the `prod` target.
- Sign in to `gh`, with admin access to the repository: this creates an environment and sets secrets and variables. `gh auth status` shows the account.
- Have Terraform 1.10 or later, and AWS credentials for the production account.

Export these first. Path conversion would otherwise rewrite values that start with a slash.

```bash
export MSYS_NO_PATHCONV=1 AWS_REGION=us-east-1
```

1. **Developer portal.** Confirm the production Discord application still has:
   - Bot page: **Message Content Intent** on, Presence and Server Members off.
   - Installation: guild install with scopes `bot` and `applications.commands`, and permission integer `17600776072192`. That integer is `DISCORD_BOT_PERMISSIONS` from `convex/_discordRest.ts`, the same value the Integrations invite uses. It grants seven permissions: View Channel, Send Messages, Manage Messages, Embed Links, Read Message History, Manage Events, and Create Events.
   - Interactions Endpoint URL empty.
   - A server count under 100. Above 100, message content needs Discord's verification.

2. **Release role.** Work in the checkout that holds the local state of `infra/terraform/state-mgmt`, on current `main`. Find the `vrdex.net` public zone ID: the part after `/hostedzone/` in this output.

   ```bash
   aws route53 list-hosted-zones-by-name --dns-name vrdex.net --query 'HostedZones[0].Id' --output text
   ```

   Add `enable_discord_gateway_release_permissions = true` to `infra/terraform/state-mgmt/terraform.tfvars`. If that file does not exist, create it with only this line and `route53_zone_id`; everything else defaults. Do not copy `terraform.tfvars.example`.

   ```bash
   cd infra/terraform/state-mgmt
   terraform init
   terraform plan
   ```

   Expect two additions: the role and its policy. Other changes may be pending, including a policy update on the CI role. Those are a separate decision, so read them. The targets below apply only this step.

   ```bash
   terraform apply -target='aws_iam_role.discord_gateway_release[0]' -target='aws_iam_role_policy.discord_gateway_release[0]'
   gh variable set AWS_DISCORD_GATEWAY_RELEASE_ROLE_ARN --body "$(terraform output -raw discord_gateway_release_role_arn)"
   cd ../../..
   ```

3. **Confirm the shared resources exist.** Expect exactly one subnet, and a `basic@basicbit.net` email subscription whose `SubscriptionArn` is not `PendingConfirmation`.

   ```bash
   aws ec2 describe-subnets --filters Name=tag:Name,Values=vrdex-group-telemetry-egress --query 'Subnets[].SubnetId'
   TOPIC_ARN=$(aws sns list-topics --query "Topics[?ends_with(TopicArn, ':vrdex-group-telemetry-alerts')].TopicArn | [0]" --output text | tr -d '\r')
   aws sns list-subscriptions-by-topic --topic-arn "$TOPIC_ARN"
   ```

4. **First stack apply.** With `enable_service = false`, this creates the repository, secrets, roles, network, cluster, log group, and a task definition holding the placeholder image. No image exists yet, so this is the one apply without `container_image`.

   ```bash
   cd infra/terraform/discord-gateway
   terraform init
   CONVEX_SITE_URL=$(gh variable get GROUP_TELEMETRY_CONVEX_SITE_URL)
   terraform apply -var-file=environments/production.tfvars -var "convex_site_url=$CONVEX_SITE_URL"
   cd ../../..
   ```

5. **Write secret values.** Set `APPLICATION_ID` from the portal. The bot token comes from production Convex, because a reset would revoke the copy already there. Values read by `$(...)` carry no trailing newline. See [setting secret values](./convex-environments.md#setting-secret-values-without-corrupting-them).

   Create the `discord-gateway-commands` environment first and restrict it to `main`. Only it holds the GitHub copies of these two values.

   ```bash
   gh api --method PUT repos/BASIC-BIT/VRDex/environments/discord-gateway-commands \n     --input - <<< '{"deployment_branch_policy":{"protected_branches":false,"custom_branch_policies":true}}'
   gh api --method POST repos/BASIC-BIT/VRDex/environments/discord-gateway-commands/deployment-branch-policies -f name=main -f type=branch
   BOT_TOKEN=$(pnpm --silent cx -- prod env get DISCORD_BOT_TOKEN)
   INTAKE_SECRET=$(openssl rand -base64 32)
   aws secretsmanager put-secret-value --secret-id vrdex/discord-gateway/DISCORD_BOT_TOKEN --secret-string "$BOT_TOKEN"
   aws secretsmanager put-secret-value --secret-id vrdex/discord-gateway/DISCORD_APPLICATION_ID --secret-string "$APPLICATION_ID"
   aws secretsmanager put-secret-value --secret-id vrdex/discord-gateway/DISCORD_INTAKE_SECRET --secret-string "$INTAKE_SECRET"
   pnpm cx -- prod env set DISCORD_INTAKE_SECRET "$INTAKE_SECRET"
   pnpm cx -- prod env set DISCORD_APPLICATION_ID "$APPLICATION_ID"
   gh secret set DISCORD_BOT_TOKEN --env discord-gateway-commands --body "$BOT_TOKEN"
   gh secret set DISCORD_APPLICATION_ID --env discord-gateway-commands --body "$APPLICATION_ID"
   ```

   Then run the check under "Always verify after writing a secret" in [that section](./convex-environments.md#setting-secret-values-without-corrupting-them) for each Convex value written here. `CR` must be `0`.

6. **First release.** This pushes the first image and registers commands. There is no service yet, so the workflow reports nothing to roll. `GROUP_TELEMETRY_CONVEX_SITE_URL` must already be set.

   ```bash
   gh variable set DISCORD_GATEWAY_RELEASE_ENABLED --body true
   gh workflow run discord-gateway-release.yml --ref main
   sleep 10
   RUN_ID=$(gh run list --workflow discord-gateway-release.yml --event workflow_dispatch --limit 1 --json databaseId --jq '.[0].databaseId')
   gh run watch "$RUN_ID" --exit-status
   aws ecs describe-task-definition --task-definition vrdex-discord-gateway --query 'taskDefinition.containerDefinitions[0].image' --output text
   ```

   Do not move on until the run succeeds and the image ends in `@sha256:` plus 64 hex characters. `:bootstrap-placeholder` means the release did not apply. Once the enable PR in step 8 has merged, a re-dispatched release fails the plan guard, so revert that PR, or read the digest from `aws ecr describe-images --repository-name vrdex-discord-gateway` and join it to `terraform output -raw repository_url` with `@` for step 10.

7. **Set extraction and poster values.** Set these before any channel is bound; see [Values BASIC Provides](#values-basic-provides). Set `OPENAI_KEY` to the OpenAI key and `POSTER_TOKEN` to the output of `openssl rand -base64 32`, and write `POSTER_TOKEN` to the web app first. The first command must print `https://vrdex.net`, the poster bridge origin.

   ```bash
   pnpm --silent cx -- prod env get SITE_URL
   pnpm cx -- prod env set OPENAI_API_KEY "$OPENAI_KEY"
   pnpm cx -- prod env set VRDEX_EVENT_INTAKE_AI_ENABLED true
   pnpm cx -- prod env set VRDEX_EVENT_CONNECTORS_ENABLED true
   pnpm cx -- prod env set VRDEX_DISCORD_POSTER_TOKEN "$POSTER_TOKEN"
   ```

   Then run the same check for each Convex value written here. `CR` must be `0`.

8. **Enable the service in git.** Open a PR setting `enable_service = true` in `infra/terraform/discord-gateway/environments/production.tfvars` and merge it. A release that runs before step 10 fails at the plan guard, because the plan would create the service and its alarm.

9. **Turn on intake.** Do this immediately before step 10. While the flag is off the gateway's connector lookups answer 503, so every guild message would log a failed lookup.

   ```bash
   pnpm cx -- prod env set VRDEX_DISCORD_INTAKE_ENABLED true
   ```

   With the flag on and no gateway yet, `checkHeartbeat` usually emails one stale alert within five minutes, then one resolved email once heartbeats arrive. That pair is expected and proves the email path. If the first heartbeat lands before the next check, no pair arrives at all. Keep this step and step 10 close together.

   The flag is global: it reveals the Integrations connect flow to every community, and `/vrdex connect` defaults to `hold`, so the [Rollout](#rollout) prerequisite applies to the first connect by anyone.

10. **Create the service.** This also creates the running-task alarm, which may send the alarm and OK email pair described under [Alarms](#alarms). Run it from an updated `main`, so the merged tfvars apply. The image is the one step 6 released. Check the plan for a task definition replacement: with the image unchanged it means `linuxParameters` shows a perpetual diff, and every manual apply then rolls the task.

    ```bash
    cd infra/terraform/discord-gateway
    CONTAINER_IMAGE=$(aws ecs describe-task-definition --task-definition vrdex-discord-gateway --query 'taskDefinition.containerDefinitions[0].image' --output text | tr -d '\r')
    CONVEX_SITE_URL=$(gh variable get GROUP_TELEMETRY_CONVEX_SITE_URL)
    terraform apply -var-file=environments/production.tfvars -var "container_image=$CONTAINER_IMAGE" -var "convex_site_url=$CONVEX_SITE_URL"
    aws ecs wait services-stable --cluster vrdex-discord-gateway --services vrdex-discord-gateway
    cd ../../..
    ```

11. **Confirm a heartbeat.** One should land within two minutes of the task running. Check that `receivedAt` is recent, and read the logs if no row appears.

    ```bash
    pnpm cx -- prod data discordGatewayHeartbeats
    aws logs tail /aws/ecs/vrdex-discord-gateway --since 10m
    ```

## Rollout

The first binding is BASIC's own community, in `hold` mode, moving to `autopublish` after a week of clean runs.

Prerequisite: `hold` mode needs staff publishing of a held draft to write the event back to its link and source rows. Today that publish leaves them on the draft, so the next edit of that post files a second draft. Do not bind a channel in `hold` until that ships.

## Local Control Demo

Use the local demo before provider setup to inspect the route-to-command contract and public media state projection:

```powershell
pnpm proof:restream:control
```

The demo writes `artifacts/restream-control-demo/<timestamp>/report.html` and `control-demo-summary.json`. It simulates fresh Discord controls, stale-panel rejection, confirmation-gated stop behavior, sanitized media commands, and public-safe state snapshots. It does not connect to Discord, enqueue Convex commands, or mutate event records.
