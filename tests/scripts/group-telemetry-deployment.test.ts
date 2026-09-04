import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { parse as parseYaml } from "yaml";

import {
  assertAutomaticPlan,
  assertEcsDeployment,
  assertHeartbeat,
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
  it("keeps the production request budget in checked deployment state", async () => {
    const productionVariables = await readFile(
      "infra/terraform/group-telemetry-collector/environments/production.tfvars",
      "utf8",
    );
    assert.match(productionVariables, /^requests_per_minute\s*=\s*\d+$/m);
  });

  it("allows only the immutable image and release metadata replacement", () => {
    const before = taskDefinition("repo@sha256:" + "1".repeat(64), "1".repeat(40));
    const after = taskDefinition("repo@sha256:" + "2".repeat(64), "2".repeat(40));
    Object.assign(before, { arn: "old", arn_without_revision: "old", id: "old", revision: 3 });
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

  it("ignores empty-versus-null serialization noise on the replaced task definition", () => {
    // Observed on 2026-09-04: the AWS provider reads unset fields back as ""
    // or [] and plans them as null, so a plain image release showed
    // ipc_mode/pid_mode and four container arrays "changing".
    const before = {
      ...taskDefinition("repo@sha256:" + "1".repeat(64), "1".repeat(40)),
      ipc_mode: "",
      pid_mode: "",
      arn: "old",
      // Known in state, "known after apply" in the plan: not comparable.
      enable_fault_injection: false,
    };
    const beforeContainers = JSON.parse(before.container_definitions);
    Object.assign(beforeContainers[0], { mountPoints: [], portMappings: [], systemControls: [], volumesFrom: [] });
    before.container_definitions = JSON.stringify(beforeContainers);
    const after = {
      ...taskDefinition("repo@sha256:" + "2".repeat(64), "2".repeat(40)),
      ipc_mode: null,
      pid_mode: null,
      arn: null,
    };
    const result = assertAutomaticPlan({
      format_version: "1.2",
      resource_changes: [
        {
          address: "aws_ecs_task_definition.worker",
          change: { actions: ["create", "delete"], before, after, after_unknown: { arn: true, enable_fault_injection: true } },
        },
      ],
    });
    assert.equal(result.releaseSha, "2".repeat(40));
  });

  it("rejects other task, scaling, identity, and infrastructure changes", () => {
    const before = { ...taskDefinition("old", "1".repeat(40)), execution_role_arn: "old-role" };
    const after = { ...taskDefinition("new", "2".repeat(40)), execution_role_arn: "new-role" };
    assert.throws(() => assertAutomaticPlan({
      format_version: "1.2",
      resource_changes: [{
        address: "aws_ecs_task_definition.worker",
        change: { actions: ["delete", "create"], before, after },
      }],
    }), /fields other than image and release metadata/);
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
  });

  it("accepts an exact current release as a no-op rerun", () => {
    const image = `123456789012.dkr.ecr.us-east-1.amazonaws.com/vrdex-group-telemetry@${digest}`;
    const current = taskDefinition(image, "2".repeat(40));
    const result = assertAutomaticPlan({
      format_version: "1.2",
      resource_changes: [{
        address: "aws_ecs_task_definition.worker",
        change: { actions: ["no-op"], before: current, after: current },
      }],
    }, {
      image,
      releaseSha: "2".repeat(40),
      capabilities: ["telemetry_v1", "vrchat_proof_v1"],
    });
    assert.deepEqual(result.changedResources, []);
  });
});

describe("group telemetry release workflow", () => {
  it("does not block the application deploy when PostHog is unconfigured", async () => {
    const source = await readFile(".github/workflows/baseline-checks.yml", "utf8");
    assert.match(source, /analytics provisioning was skipped/);
    assert.doesNotMatch(source, /TERRAFORM_POSTHOG_PUBLIC_KEY is required/);
  });

  it("runs only for a successful main baseline or explicit manual release", async () => {
    const source = await readFile(".github/workflows/group-telemetry-release.yml", "utf8");
    const workflow = parseYaml(source) as {
      on?: Record<string, unknown>;
      jobs?: Record<string, unknown>;
      concurrency?: { group?: string };
    };
    assert.ok(workflow.on?.workflow_run);
    assert.ok(workflow.on?.workflow_dispatch !== undefined);
    assert.equal(workflow.on?.schedule, undefined);
    assert.equal(workflow.jobs?.["drift-audit"], undefined);
    assert.equal(workflow.concurrency?.group, "group-telemetry-production-release");
  });

  it("keeps release writes behind exact-SHA tests, a saved plan allowlist, and verification", async () => {
    const source = await readFile(".github/workflows/group-telemetry-release.yml", "utf8");
    const workflow = parseYaml(source) as { jobs?: Record<string, { "timeout-minutes"?: number; permissions?: Record<string, string>; steps?: Array<{ name?: string; run?: string }> }> };
    const release = workflow.jobs?.release;
    assert.ok(release, "release job is missing");
    assert.ok((release["timeout-minutes"] ?? 0) >= 90);
    assert.equal(release.permissions?.["id-token"], "write");
    const commands = (release.steps ?? []).map((step) => step.run ?? "").join("\n");
    assert.match(commands, /git merge-base --is-ancestor/);
    assert.match(commands, /release_sha.*latest_successful_sha/);
    assert.match(commands, /tests\/backend\/collector-proof-checks\.test\.ts/);
    assert.match(commands, /docker build .*org\.opencontainers\.image\.revision=\$RELEASE_SHA/);
    assert.match(commands, /terraform plan -out=collector\.tfplan/);
    assert.match(commands, /group-telemetry-deployment\.mjs plan/);
    assert.match(commands, /terraform apply -auto-approve collector\.tfplan/);
    assert.match(commands, /aws ecs wait services-stable/);
    assert.match(commands, /collectorDeploymentReadiness/);
    assert.match(commands, /PREVIOUS_IMAGE_URI/);
    assert.match(commands, /deadline=\$\(\(SECONDS \+ 300\)\)/);
  });

  it("keeps runtime alarms in CloudWatch without polling from GitHub", async () => {
    const source = await readFile("infra/terraform/group-telemetry-collector/main.tf", "utf8");
    const worker = await readFile("workers/group-telemetry/worker.mjs", "utf8");
    assert.match(source, /alarm_name\s+= "\$\{var\.name_prefix\}-missing-heartbeat"/);
    assert.match(source, /treat_missing_data\s+= "breaching"/);
    assert.match(source, /resource "aws_cloudwatch_dashboard" "operations"/);
    assert.match(worker, /async function pauseWithHeartbeats/);
    assert.match(worker, /await pauseWithHeartbeats\(retryAfterMs\)/);
  });

  it("keeps the claim dashboard to a funnel and terminal outcomes", async () => {
    const source = await readFile("infra/terraform/posthog/main.tf", "utf8");
    assert.match(source, /posthog_insight" "claim_journey_funnel/);
    assert.match(source, /posthog_insight" "claim_terminal_outcomes/);
    assert.doesNotMatch(source, /claim_method_selection|claim_first_check_latency/);
    assert.doesNotMatch(source, /claim_resolution_latency|claim_milestone_reconciliation/);
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

  it("rejects a stale digest or unhealthy heartbeat", () => {
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
});
