import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { parse as parseYaml } from "yaml";

import {
  assertAutomaticPlan,
  assertClaimAnalyticsHealth,
  assertClaimHealth,
  assertEcsDeployment,
  assertHeartbeat,
  assertDriftAudit,
} from "../../scripts/group-telemetry-deployment.mjs";

const digest = `sha256:${"a".repeat(64)}`;
const taskDefinitionArn = "arn:aws:ecs:us-east-1:123456789012:task-definition/vrdex-group-telemetry:4";

function taskDefinition(image: string, release: string) {
  return {
    family: "vrdex-group-telemetry",
    cpu: "256",
    container_definitions: JSON.stringify([{
      name: "collector",
      image,
      environment: [
        { name: "STATIC", value: "same" },
        { name: "VRDEX_GROUP_TELEMETRY_RELEASE_SHA", value: release },
        { name: "VRDEX_GROUP_TELEMETRY_RELEASE_VERSION", value: `git-${release.slice(0, 12)}` },
        { name: "VRDEX_GROUP_TELEMETRY_CAPABILITIES", value: "telemetry_v1,vrchat_proof_v1" },
      ],
    }]),
  };
}

describe("group telemetry automatic deployment policy", () => {
  it("allows only the immutable image and release metadata replacement", () => {
    const before = taskDefinition("repo@sha256:" + "1".repeat(64), "1".repeat(40));
    const after = taskDefinition("repo@sha256:" + "2".repeat(64), "2".repeat(40));
    Object.assign(before, {
      arn: `${taskDefinitionArn}:before`,
      arn_without_revision: taskDefinitionArn.replace(/:\d+$/, ""),
      id: `${taskDefinitionArn}:before`,
      revision: 3,
    });
    Object.assign(after, { arn: null, arn_without_revision: null, id: null, revision: null });
    const result = assertAutomaticPlan({
      format_version: "1.2",
      resource_changes: [
        { address: "aws_ecs_task_definition.worker", change: { actions: ["create", "delete"], before, after } },
        {
          address: "aws_ecs_service.worker[0]",
          change: {
            actions: ["update"],
            before: { desired_count: 1, task_definition: "old" },
            after: { desired_count: 1, task_definition: "new" },
          },
        },
      ],
    });
    assert.deepEqual(result.changedResources, ["aws_ecs_task_definition.worker", "aws_ecs_service.worker[0]"]);
    assert.equal(result.releaseSha, "2".repeat(40));
  });

  it("still rejects configured task-definition changes", () => {
    const before = { ...taskDefinition("old", "1".repeat(40)), execution_role_arn: "old-role" };
    const after = { ...taskDefinition("new", "2".repeat(40)), execution_role_arn: "new-role" };
    assert.throws(
      () => assertAutomaticPlan({
        format_version: "1.2",
        resource_changes: [{
          address: "aws_ecs_task_definition.worker",
          change: { actions: ["delete", "create"], before, after },
        }],
      }),
      /fields other than image and release metadata/,
    );
  });

  it("rejects scaling, identity, and infrastructure changes", () => {
    assert.throws(() => assertAutomaticPlan({
      format_version: "1.2",
      resource_changes: [{
        address: "aws_ecs_service.worker[0]",
        change: {
          actions: ["update"],
          before: { desired_count: 1, task_definition: "old" },
          after: { desired_count: 2, task_definition: "new" },
        },
      }],
    }), /fields other than task_definition/);

    assert.throws(() => assertAutomaticPlan({
      format_version: "1.2",
      resource_changes: [{ address: "aws_ssm_parameter.enabled", change: { actions: ["update"], before: {}, after: {} } }],
    }), /refuses infrastructure change/);

    assert.throws(() => assertAutomaticPlan({ format_version: "1.2", resource_changes: [] }), /must replace the task definition/);
  });
});

describe("group telemetry scheduled drift audit", () => {
  const releaseSha = "c".repeat(40);
  const imageDetails = {
    imageDetails: [{
      imageDigest: digest,
      imageTags: [`git-${releaseSha}`],
      imagePushedAt: "2026-09-02T12:00:00.000Z",
    }],
  };
  const deployedTaskDefinition = {
    taskDefinition: {
      taskDefinitionArn,
      containerDefinitions: [{
        name: "collector",
        image: `123456789012.dkr.ecr.us-east-1.amazonaws.com/vrdex-group-telemetry@${digest}`,
        environment: [{ name: "VRDEX_GROUP_TELEMETRY_RELEASE_SHA", value: releaseSha }],
      }],
    },
  };
  const serviceResponse = { services: [{
    status: "ACTIVE", taskDefinition: taskDefinitionArn, desiredCount: 1, runningCount: 1, pendingCount: 0,
    deployments: [{ status: "PRIMARY", rolloutState: "COMPLETED", taskDefinition: taskDefinitionArn }],
  }] };
  const tasksResponse = { tasks: [{
    lastStatus: "RUNNING", taskDefinitionArn,
    containers: [{ name: "collector", imageDigest: digest }],
  }] };
  const health = { healthy: true, issues: [], freshCollectorCount: 1, matchingReleaseCount: 1, authRequiredCount: 0 };

  it("accepts matching ECR, ECS, and heartbeat state", () => {
    const result = assertDriftAudit({
      imageDetails, taskDefinition: deployedTaskDefinition, serviceResponse, tasksResponse, health,
      now: Date.parse("2026-09-02T12:20:00.000Z"),
    });
    assert.deepEqual(result.mismatches, []);
  });

  it("allows rollout convergence briefly, then fails persistent drift", () => {
    const stale = structuredClone(deployedTaskDefinition);
    stale.taskDefinition.containerDefinitions[0].image = `repo@sha256:${"d".repeat(64)}`;
    const withinGrace = assertDriftAudit({
      imageDetails, taskDefinition: stale, serviceResponse, tasksResponse, health,
      now: Date.parse("2026-09-02T12:10:00.000Z"),
    });
    assert.equal(withinGrace.withinGrace, true);
    assert.throws(() => assertDriftAudit({
      imageDetails, taskDefinition: stale, serviceResponse, tasksResponse, health,
      now: Date.parse("2026-09-02T12:16:00.000Z"),
    }), /persisted beyond grace period/);
  });

  it("detects a successful main baseline that was never built", () => {
    assert.throws(() => assertDriftAudit({
      imageDetails, taskDefinition: deployedTaskDefinition, serviceResponse, tasksResponse, health,
      expectedReleaseSha: "e".repeat(40),
      expectedReleaseAt: "2026-09-02T12:00:00.000Z",
      now: Date.parse("2026-09-02T12:16:00.000Z"),
    }), /ecr_release_missing/);
    const withinGrace = assertDriftAudit({
      imageDetails: { imageDetails: [] }, taskDefinition: deployedTaskDefinition, serviceResponse, tasksResponse, health,
      expectedReleaseSha: "e".repeat(40),
      expectedReleaseAt: "2026-09-02T12:00:00.000Z",
      now: Date.parse("2026-09-02T12:10:00.000Z"),
    });
    assert.deepEqual(withinGrace.mismatches.includes("ecr_release_missing"), true);
  });
});

describe("claim verification operational health", () => {
  const healthy = {
    fleetKillSwitchEnabled: false,
    pendingEligibleAttemptCount: 1,
    scanLimitReached: false,
    uncheckedAttemptCount: 1,
    oldestUncheckedAgeMs: 90_000,
    maxRecentFirstCheckLatencyMs: 90_000,
    freshCollectorCount: 1,
    authRequiredCount: 0,
    maxConsecutiveControlFailures: 0,
    releases: [],
  };

  it("accepts a bounded backlog with a fresh collector", () => {
    assert.deepEqual(assertClaimHealth(healthy), {
      pendingEligibleAttemptCount: 1,
      uncheckedAttemptCount: 1,
      oldestUncheckedAgeMs: 90_000,
      maxRecentFirstCheckLatencyMs: 90_000,
      freshCollectorCount: 1,
    });
  });

  it("rejects stale unchecked work and missing collectors", () => {
    assert.throws(
      () => assertClaimHealth({ ...healthy, oldestUncheckedAgeMs: 120_001 }),
      /more than two minutes/,
    );
    assert.throws(
      () => assertClaimHealth({ ...healthy, maxRecentFirstCheckLatencyMs: 120_001 }),
      /took more than two minutes/,
    );
    assert.throws(
      () => assertClaimHealth({ ...healthy, freshCollectorCount: 0 }),
      /no fresh collector/,
    );
    assert.throws(
      () => assertClaimHealth({ ...healthy, maxConsecutiveControlFailures: 3 }),
      /a collector reported three or more/,
    );
  });
});

describe("claim analytics delivery health", () => {
  const healthy = {
    pendingCount: 1,
    deliveringCount: 0,
    failedCount: 0,
    disabledCount: 0,
    oldestPendingAgeMs: 30_000,
    scanLimitReached: false,
  };

  it("accepts a bounded, advancing outbox", () => {
    assert.deepEqual(assertClaimAnalyticsHealth(healthy), {
      pendingCount: 1,
      deliveringCount: 0,
      failedCount: 0,
      disabledCount: 0,
      oldestPendingAgeMs: 30_000,
    });
  });

  it("rejects disabled, failed, and stale delivery", () => {
    assert.throws(() => assertClaimAnalyticsHealth({ ...healthy, disabledCount: 1 }), /disabled/);
    assert.throws(() => assertClaimAnalyticsHealth({ ...healthy, failedCount: 1 }), /failed/);
    assert.throws(
      () => assertClaimAnalyticsHealth({ ...healthy, oldestPendingAgeMs: 900_001 }),
      /more than fifteen minutes/,
    );
  });
});

describe("group telemetry release workflow", () => {
  it("fails closed when hosted production claim analytics is not configured", async () => {
    const source = await readFile(".github/workflows/baseline-checks.yml", "utf8");
    assert.match(source, /TERRAFORM_POSTHOG_PUBLIC_KEY is required for the hosted production claim analytics pipeline/);
    assert.doesNotMatch(source, /server claim analytics remain disabled/);
  });

  it("keeps automatic writes behind exact-SHA tests, a saved plan allowlist, and post-deploy verification", async () => {
    const source = await readFile(".github/workflows/group-telemetry-release.yml", "utf8");
    const workflow = parseYaml(source) as { jobs?: Record<string, { "timeout-minutes"?: number; permissions?: Record<string, string>; steps?: Array<{ name?: string; run?: string }> }> };
    const release = workflow.jobs?.release;
    assert.ok(release, "release job is missing");
    assert.ok((release["timeout-minutes"] ?? 0) >= 90, "release job does not reserve rollback time");
    assert.equal(release.permissions?.["id-token"], "write");
    const commands = (release.steps ?? []).map((step) => step.run ?? "").join("\n");
    assert.match(commands, /git rev-parse HEAD/);
    assert.match(commands, /git merge-base --is-ancestor/);
    assert.match(commands, /actions\/workflows\/baseline-checks\.yml\/runs/);
    assert.match(commands, /release_sha.*latest_successful_sha/);
    assert.match(commands, /docker build .*org\.opencontainers\.image\.revision=\$RELEASE_SHA/);
    assert.match(commands, /terraform plan -out=collector\.tfplan -var-file=environments\/production\.tfvars/);
    assert.match(commands, /group-telemetry-deployment\.mjs plan/);
    assert.match(commands, /terraform apply -auto-approve collector\.tfplan/);
    assert.match(source, /id: apply[\s\S]*continue-on-error: true/);
    assert.match(source, /steps\.apply\.outcome == 'failure'/);
    assert.match(commands, /aws ecs wait services-stable/);
    assert.match(commands, /collectorDeploymentReadiness/);
    assert.match(commands, /CONVEX_DEPLOY_KEY="\$CONVEX_DEPLOY_KEY_PROD" pnpm --silent exec convex run --prod/);
    assert.match(commands, /PREVIOUS_TASK_DEFINITION/);
    assert.match(commands, /PREVIOUS_IMAGE_URI/);
    assert.match(commands, /TF_VAR_release_sha="\$PREVIOUS_RELEASE_SHA"/);
    assert.match(commands, /terraform apply -auto-approve -var-file=environments\/production\.tfvars/);
    assert.match(commands, /rollback_task_definition="\$\(terraform output -raw task_definition_arn\)"/);
    const rollback = (release.steps ?? []).find((step) => step.name === "Reconcile Terraform and ECS to the previous release");
    assert.ok(rollback, "Terraform rollback step is missing");
    assert.doesNotMatch(rollback.run ?? "", /ecs update-service/);
    assert.match(commands, /deadline=\$\(\(SECONDS \+ 300\)\)/);
    assert.match(commands, /sleep 10/);
  });

  it("keeps drift detection read-only and checks ECR, ECS, and Convex", async () => {
    const source = await readFile(".github/workflows/group-telemetry-release.yml", "utf8");
    const workflow = parseYaml(source) as { jobs?: Record<string, { steps?: Array<{ run?: string }> }> };
    const commands = (workflow.jobs?.["drift-audit"]?.steps ?? []).map((step) => step.run ?? "").join("\n");
    assert.match(commands, /ecr describe-images/);
    assert.match(commands, /ecs describe-services/);
    assert.match(commands, /collectorDeploymentReadiness/);
    assert.match(commands, /claimVerificationOperationalHealth/);
    assert.match(commands, /claimAnalytics:deliveryOperationalHealth/);
    assert.match(commands, /group-telemetry-deployment\.mjs claim-health/);
    assert.match(commands, /group-telemetry-deployment\.mjs claim-analytics-health/);
    assert.match(commands, /CONVEX_DEPLOY_KEY="\$CONVEX_DEPLOY_KEY_PROD" pnpm --silent exec convex run --prod/);
    assert.match(commands, /GITHUB_STEP_SUMMARY/);
    assert.ok(
      commands.indexOf("GITHUB_STEP_SUMMARY") < commands.indexOf("claim-health --file"),
      "the aggregate health summary must be written before fail-closed assertions",
    );
    assert.match(commands, /group-telemetry-deployment\.mjs drift/);
    assert.match(commands, /actions\/workflows\/baseline-checks\.yml\/runs/);
    assert.doesNotMatch(commands, /terraform apply|ecs update-service|ecr put-image/);
    assert.match(source, /group-telemetry-production-\$\{\{[\s\S]*'audit'[\s\S]*'release'/);
  });

  it("declares the two-minute heartbeat alarm from the redacted worker event", async () => {
    const source = await readFile("infra/terraform/group-telemetry-collector/main.tf", "utf8");
    const worker = await readFile("workers/group-telemetry/worker.mjs", "utf8");
    assert.match(source, /\$\.event = \\"collector_heartbeat\\"/);
    assert.match(source, /alarm_name\s+= "\$\{var\.name_prefix\}-missing-heartbeat"/);
    assert.match(source, /evaluation_periods\s+= 2/);
    assert.match(source, /period\s+= 60/);
    assert.match(source, /treat_missing_data\s+= "breaching"/);
    assert.match(source, /resource "aws_cloudwatch_dashboard" "operations"/);
    assert.match(source, /observability_namespace\s+= "VRDex\/GroupTelemetry\/\$\{var\.name_prefix\}"/);
    assert.match(source, /namespace\s+= local\.observability_namespace/);
    assert.match(source, /\$\.attempt >= 3/);
    assert.match(source, /tagStatus\s+= "untagged"/);
    assert.match(source, /countType\s+= "sinceImagePushed"/);
    assert.doesNotMatch(source, /imageCountMoreThan/);
    assert.match(source, /fields @timestamp, event, outcome, attempt, retryDelayMs/);
    assert.match(source, /skip_destroy\s+= true/);
    assert.match(worker, /async function pauseWithHeartbeats/);
    assert.match(worker, /await pauseWithHeartbeats\(retryAfterMs\)/);
    assert.match(worker, /for \(const attempt of pending\) \{[\s\S]*await heartbeat\(\)/);
    assert.match(worker, /for \(const assignment of assignments\) \{[\s\S]*await heartbeat\(\)/);
  });

  it("keeps connection-only journeys out of conversion and labels transport reconciliation", async () => {
    const source = await readFile("infra/terraform/posthog/main.tf", "utf8");
    assert.match(source, /WHERE connection_only = 0\s+AND has\(milestones, 'claim_journey_viewed'\)/);
    assert.match(source, /properties\.connection_only = 'true'/);
    assert.match(source, /toDate\(timestamp\) AS day/);
    assert.match(source, /transport-level browser submissions/);
  });
});

describe("group telemetry post-deploy verification", () => {
  it("requires exact stable ECS task identity and digest", () => {
    const result = assertEcsDeployment({
      expectedDigest: digest,
      expectedTaskDefinitionArn: taskDefinitionArn,
      serviceResponse: { services: [{
        status: "ACTIVE",
        taskDefinition: taskDefinitionArn,
        desiredCount: 1,
        runningCount: 1,
        pendingCount: 0,
        deployments: [{ status: "PRIMARY", rolloutState: "COMPLETED", taskDefinition: taskDefinitionArn }],
      }] },
      tasksResponse: { tasks: [{
        lastStatus: "RUNNING",
        taskDefinitionArn,
        containers: [{ name: "collector", imageDigest: digest }],
      }] },
    });
    assert.deepEqual(result, { desiredCount: 1, runningCount: 1 });
  });

  it("rejects a stale digest and unhealthy heartbeat", () => {
    assert.throws(() => assertEcsDeployment({
      expectedDigest: digest,
      expectedTaskDefinitionArn: taskDefinitionArn,
      serviceResponse: { services: [{
        status: "ACTIVE", taskDefinition: taskDefinitionArn, desiredCount: 1, runningCount: 1, pendingCount: 0,
        deployments: [{ status: "PRIMARY", rolloutState: "COMPLETED", taskDefinition: taskDefinitionArn }],
      }] },
      tasksResponse: { tasks: [{
        lastStatus: "RUNNING", taskDefinitionArn,
        containers: [{ name: "collector", imageDigest: `sha256:${"b".repeat(64)}` }],
      }] },
    }), /another image digest/);
    assert.throws(() => assertHeartbeat({ healthy: false, issues: ["heartbeat_stale"] }), /heartbeat_stale/);
  });

  it("accepts a fresh matching heartbeat summary", () => {
    assert.deepEqual(assertHeartbeat({
      healthy: true,
      issues: [],
      freshCollectorCount: 1,
      matchingReleaseCount: 1,
      authRequiredCount: 3,
    }), { freshCollectorCount: 1, matchingReleaseCount: 1 });
  });
});
