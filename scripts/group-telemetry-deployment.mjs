import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const RELEASE_ENV_NAMES = new Set([
  "VRDEX_GROUP_TELEMETRY_RELEASE_SHA",
  "VRDEX_GROUP_TELEMETRY_RELEASE_VERSION",
  "VRDEX_GROUP_TELEMETRY_CAPABILITIES",
]);

const TASK_DEFINITION_COMPUTED_FIELDS = [
  "arn",
  "arn_without_revision",
  "id",
  "revision",
];

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function normalizedTaskDefinition(value) {
  const normalized = clone(value);
  if (!normalized) return normalized;
  for (const field of TASK_DEFINITION_COMPUTED_FIELDS) delete normalized[field];
  const definitions = typeof normalized.container_definitions === "string"
    ? JSON.parse(normalized.container_definitions)
    : normalized.container_definitions;
  assert.ok(Array.isArray(definitions), "task definition container_definitions must be an array");
  for (const container of definitions) {
    if (container.name !== "collector") continue;
    container.image = "<release-image>";
    for (const entry of container.environment ?? []) {
      if (RELEASE_ENV_NAMES.has(entry.name)) entry.value = `<${entry.name}>`;
    }
  }
  normalized.container_definitions = definitions;
  return normalized;
}

function normalizedService(value) {
  const normalized = clone(value);
  if (normalized) normalized.task_definition = "<release-task-definition>";
  return normalized;
}

function sameJson(left, right) {
  try {
    assert.deepStrictEqual(left, right);
    return true;
  } catch {
    return false;
  }
}

function collectorContainer(taskDefinition) {
  const definitions = typeof taskDefinition?.container_definitions === "string"
    ? JSON.parse(taskDefinition.container_definitions)
    : taskDefinition?.container_definitions;
  assert.ok(Array.isArray(definitions), "task definition container_definitions must be an array");
  const collector = definitions.find((container) => container.name === "collector");
  assert.ok(collector, "collector container is missing from task definition");
  return collector;
}

function releaseMetadata(taskDefinition) {
  const collector = collectorContainer(taskDefinition);
  const environment = new Map((collector.environment ?? []).map((entry) => [entry.name, entry.value]));
  return {
    image: collector.image,
    releaseSha: environment.get("VRDEX_GROUP_TELEMETRY_RELEASE_SHA"),
    releaseVersion: environment.get("VRDEX_GROUP_TELEMETRY_RELEASE_VERSION"),
    capabilities: String(environment.get("VRDEX_GROUP_TELEMETRY_CAPABILITIES") ?? "").split(",").filter(Boolean).sort(),
  };
}

export function assertAutomaticPlan(plan, expected = {}) {
  assert.equal(plan?.format_version?.startsWith("1."), true, "unsupported Terraform plan JSON format");
  const changes = (plan.resource_changes ?? []).filter((change) => {
    const actions = change.change?.actions ?? [];
    return !sameJson(actions, ["no-op"]) && !sameJson(actions, ["read"]);
  });

  for (const resource of changes) {
    const actions = resource.change?.actions ?? [];
    if (resource.address === "aws_ecs_task_definition.worker") {
      assert.equal(
        sameJson([...actions].sort(), ["create", "delete"]),
        true,
        `automatic collector plan has unsafe task-definition actions: ${actions.join(",")}`,
      );
      assert.equal(
        sameJson(
          normalizedTaskDefinition(resource.change.before),
          normalizedTaskDefinition(resource.change.after),
        ),
        true,
        "automatic collector plan changes task-definition fields other than image and release metadata",
      );
      continue;
    }

    if (resource.address === "aws_ecs_service.worker[0]") {
      assert.equal(sameJson(actions, ["update"]), true, "automatic collector service change must be update-only");
      assert.equal(
        sameJson(normalizedService(resource.change.before), normalizedService(resource.change.after)),
        true,
        "automatic collector plan changes ECS service fields other than task_definition",
      );
      continue;
    }

    assert.fail(`automatic collector release refuses infrastructure change ${resource.address} (${actions.join(",")})`);
  }


  const taskChange = changes.find((change) => change.address === "aws_ecs_task_definition.worker");
  assert.ok(taskChange, "automatic collector plan must replace the task definition");
  const metadata = releaseMetadata(taskChange.change.after);
  if (expected.image !== undefined) assert.equal(metadata.image, expected.image, "planned collector image does not match the built digest URI");
  if (expected.releaseSha !== undefined) assert.equal(metadata.releaseSha, expected.releaseSha, "planned collector release SHA does not match the source SHA");
  if (expected.capabilities !== undefined) {
    assert.deepStrictEqual(metadata.capabilities, [...expected.capabilities].sort(), "planned collector capabilities do not match the release contract");
  }

  return { changedResources: changes.map((change) => change.address), ...metadata };
}

export function assertEcsDeployment({ serviceResponse, tasksResponse, expectedTaskDefinitionArn, expectedDigest }) {
  assert.match(expectedDigest, /^sha256:[0-9a-f]{64}$/, "expected digest must be sha256");
  const services = serviceResponse?.services ?? [];
  assert.equal(services.length, 1, "expected exactly one ECS service");
  const service = services[0];
  assert.equal(service.status, "ACTIVE", "collector service is not ACTIVE");
  assert.equal(service.taskDefinition, expectedTaskDefinitionArn, "collector service uses another task definition");
  assert.equal(service.pendingCount, 0, "collector service still has pending tasks");
  assert.equal(service.runningCount, service.desiredCount, "collector running task count does not match desired count");
  assert.ok(service.desiredCount > 0, "collector service has no desired tasks");

  const primary = (service.deployments ?? []).find((deployment) => deployment.status === "PRIMARY");
  assert.ok(primary, "collector service has no PRIMARY deployment");
  assert.equal(primary.taskDefinition, expectedTaskDefinitionArn, "PRIMARY deployment uses another task definition");
  assert.equal(primary.rolloutState, "COMPLETED", "PRIMARY deployment has not completed");

  const tasks = tasksResponse?.tasks ?? [];
  assert.equal(tasks.length, service.desiredCount, "running task inspection did not return every desired task");
  for (const task of tasks) {
    assert.equal(task.lastStatus, "RUNNING", "collector task is not RUNNING");
    assert.equal(task.taskDefinitionArn, expectedTaskDefinitionArn, "collector task uses another task definition");
    const collector = (task.containers ?? []).find((container) => container.name === "collector");
    assert.ok(collector, "collector container is missing from a running task");
    assert.equal(collector.imageDigest, expectedDigest, "collector task uses another image digest");
  }

  return { desiredCount: service.desiredCount, runningCount: tasks.length };
}

export function assertHeartbeat(health) {
  assert.equal(health?.healthy, true, `collector operational health failed: ${(health?.issues ?? []).join(", ")}`);
  assert.ok(health.freshCollectorCount >= 1, "no fresh collector heartbeat was reported");
  assert.ok(health.matchingReleaseCount >= 1, "no fresh heartbeat matches the expected release and capabilities");
  return {
    freshCollectorCount: health.freshCollectorCount,
    matchingReleaseCount: health.matchingReleaseCount,
  };
}

export function assertClaimHealth(health) {
  assert.equal(health?.fleetKillSwitchEnabled, false, "collector fleet kill switch is enabled");
  assert.equal(health?.scanLimitReached, false, "claim health scan limit was reached");
  assert.equal(health?.authRequiredCount, 0, "a collector requires authentication");
  assert.ok(
    (health?.maxConsecutiveControlFailures ?? 0) < 3,
    "a collector reported three or more consecutive control-plane failures",
  );
  if ((health?.pendingEligibleAttemptCount ?? 0) > 0) {
    assert.ok((health?.freshCollectorCount ?? 0) > 0, "pending proofs have no fresh collector");
  }
  assert.ok(
    health?.oldestUncheckedAgeMs === null ||
      (typeof health?.oldestUncheckedAgeMs === "number" && health.oldestUncheckedAgeMs <= 120_000),
    "an eligible proof has remained unchecked for more than two minutes",
  );
  return {
    pendingEligibleAttemptCount: health.pendingEligibleAttemptCount,
    uncheckedAttemptCount: health.uncheckedAttemptCount,
    oldestUncheckedAgeMs: health.oldestUncheckedAgeMs,
    freshCollectorCount: health.freshCollectorCount,
  };
}

export function assertClaimAnalyticsHealth(health) {
  assert.equal(health?.scanLimitReached, false, "claim analytics health scan limit was reached");
  assert.equal(health?.failedCount ?? 0, 0, "claim analytics has permanently failed deliveries");
  assert.equal(health?.disabledCount ?? 0, 0, "claim analytics delivery is disabled");
  assert.ok(
    health?.oldestPendingAgeMs === null ||
      (typeof health?.oldestPendingAgeMs === "number" && health.oldestPendingAgeMs <= 15 * 60_000),
    "claim analytics delivery has been pending for more than fifteen minutes",
  );
  return {
    pendingCount: health.pendingCount,
    deliveringCount: health.deliveringCount,
    failedCount: health.failedCount,
    disabledCount: health.disabledCount,
    oldestPendingAgeMs: health.oldestPendingAgeMs,
  };
}

export function assertDriftAudit({
  imageDetails,
  taskDefinition,
  serviceResponse,
  tasksResponse,
  health,
  expectedReleaseSha: requestedReleaseSha,
  expectedReleaseAt,
  now = Date.now(),
  graceMs = 15 * 60_000,
}) {
  const candidates = (imageDetails?.imageDetails ?? [])
    .filter((image) => image.imageDigest && image.imagePushedAt && (image.imageTags ?? []).some((tag) => /^git-[0-9a-f]{40}$/.test(tag)))
    .sort((left, right) => new Date(right.imagePushedAt).getTime() - new Date(left.imagePushedAt).getTime());
  const latest = candidates[0];
  const latestTag = latest?.imageTags.find((value) => /^git-[0-9a-f]{40}$/.test(value));
  const latestReleaseSha = latestTag?.slice(4);
  const expectedReleaseSha = requestedReleaseSha ?? latestReleaseSha;
  assert.match(expectedReleaseSha ?? "", /^[0-9a-f]{40}$/, "expected release SHA must be exact lowercase Git SHA");
  const expectedImageDetail = candidates.find((image) => image.imageTags.includes(`git-${expectedReleaseSha}`));
  const expectedDigest = expectedImageDetail?.imageDigest;
  const expectedImage = taskDefinition?.taskDefinition?.containerDefinitions?.find((container) => container.name === "collector")?.image;
  const deployedRelease = new Map(
    (taskDefinition?.taskDefinition?.containerDefinitions?.find((container) => container.name === "collector")?.environment ?? [])
      .map((entry) => [entry.name, entry.value]),
  ).get("VRDEX_GROUP_TELEMETRY_RELEASE_SHA");
  const expectedTaskDefinitionArn = taskDefinition?.taskDefinition?.taskDefinitionArn;
  const mismatches = [];
  if (!expectedImageDetail) mismatches.push("ecr_release_missing");
  if (latestReleaseSha !== expectedReleaseSha) mismatches.push("ecr_latest_release");
  if (!expectedDigest || expectedImage?.endsWith(`@${expectedDigest}`) !== true) mismatches.push("ecs_image_digest");
  if (deployedRelease !== expectedReleaseSha) mismatches.push("ecs_release_sha");
  if (expectedDigest) {
    try {
      assertEcsDeployment({ serviceResponse, tasksResponse, expectedTaskDefinitionArn, expectedDigest });
    } catch {
      mismatches.push("ecs_stability");
    }
  } else mismatches.push("ecs_stability");
  try {
    assertHeartbeat(health);
  } catch {
    mismatches.push("collector_heartbeat");
  }

  const ageOrigin = expectedReleaseAt ?? expectedImageDetail?.imagePushedAt ?? latest?.imagePushedAt;
  const ageMs = now - new Date(ageOrigin).getTime();
  assert.ok(Number.isFinite(ageMs) && ageMs >= 0, "expected release has an invalid completion time");
  const uniqueMismatches = [...new Set(mismatches)];
  if (uniqueMismatches.length > 0 && ageMs >= graceMs) {
    assert.fail(`collector release drift persisted beyond grace period: ${uniqueMismatches.join(",")}`);
  }
  return { expectedReleaseSha, expectedDigest, ageMs, mismatches: uniqueMismatches, withinGrace: uniqueMismatches.length > 0 };
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function main(args) {
  const [mode, ...rest] = args;
  const option = (name) => {
    const index = rest.indexOf(name);
    assert.ok(index >= 0 && rest[index + 1], `${name} is required`);
    return rest[index + 1];
  };

  if (mode === "plan") {
    const result = assertAutomaticPlan(await readJson(option("--file")), {
      image: option("--image"),
      releaseSha: option("--release-sha"),
      capabilities: option("--capabilities").split(",").filter(Boolean),
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  if (mode === "ecs") {
    const result = assertEcsDeployment({
      serviceResponse: await readJson(option("--service")),
      tasksResponse: await readJson(option("--tasks")),
      expectedTaskDefinitionArn: option("--task-definition"),
      expectedDigest: option("--digest"),
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  if (mode === "heartbeat") {
    const result = assertHeartbeat(await readJson(option("--file")));
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  if (mode === "claim-health") {
    const result = assertClaimHealth(await readJson(option("--file")));
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  if (mode === "claim-analytics-health") {
    const result = assertClaimAnalyticsHealth(await readJson(option("--file")));
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  if (mode === "drift") {
    const result = assertDriftAudit({
      imageDetails: await readJson(option("--images")),
      taskDefinition: await readJson(option("--task-definition")),
      serviceResponse: await readJson(option("--service")),
      tasksResponse: await readJson(option("--tasks")),
      health: await readJson(option("--heartbeat")),
      expectedReleaseSha: option("--expected-release-sha"),
      expectedReleaseAt: option("--expected-release-at"),
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  throw new Error("usage: group-telemetry-deployment.mjs <plan|ecs|heartbeat|claim-health|claim-analytics-health|drift> [options]");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
