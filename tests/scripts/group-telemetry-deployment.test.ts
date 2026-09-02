import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { parse as parseYaml } from "yaml";

import {
  assertAutomaticPlan,
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

describe("group telemetry release workflow", () => {
  it("keeps automatic writes behind exact-SHA tests, a saved plan allowlist, and post-deploy verification", async () => {
    const source = await readFile(".github/workflows/group-telemetry-release.yml", "utf8");
    const workflow = parseYaml(source) as { jobs?: Record<string, { permissions?: Record<string, string>; steps?: Array<{ name?: string; run?: string }> }> };
    const release = workflow.jobs?.release;
    assert.ok(release, "release job is missing");
    assert.equal(release.permissions?.["id-token"], "write");
    const commands = (release.steps ?? []).map((step) => step.run ?? "").join("\n");
    assert.match(commands, /git rev-parse HEAD/);
    assert.match(commands, /git merge-base --is-ancestor/);
    assert.match(commands, /docker build .*org\.opencontainers\.image\.revision=\$RELEASE_SHA/);
    assert.match(commands, /terraform plan -out=collector\.tfplan -var-file=environments\/production\.tfvars/);
    assert.match(commands, /group-telemetry-deployment\.mjs plan/);
    assert.match(commands, /terraform apply -auto-approve collector\.tfplan/);
    assert.match(commands, /aws ecs wait services-stable/);
    assert.match(commands, /collectorDeploymentReadiness/);
  });

  it("keeps drift detection read-only and checks ECR, ECS, and Convex", async () => {
    const source = await readFile(".github/workflows/group-telemetry-release.yml", "utf8");
    const workflow = parseYaml(source) as { jobs?: Record<string, { steps?: Array<{ run?: string }> }> };
    const commands = (workflow.jobs?.["drift-audit"]?.steps ?? []).map((step) => step.run ?? "").join("\n");
    assert.match(commands, /ecr describe-images/);
    assert.match(commands, /ecs describe-services/);
    assert.match(commands, /collectorDeploymentReadiness/);
    assert.match(commands, /group-telemetry-deployment\.mjs drift/);
    assert.match(commands, /actions\/workflows\/baseline-checks\.yml\/runs/);
    assert.doesNotMatch(commands, /terraform apply|ecs update-service|ecr put-image/);
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
      authRequiredCount: 0,
    }), { freshCollectorCount: 1, matchingReleaseCount: 1 });
  });
});
