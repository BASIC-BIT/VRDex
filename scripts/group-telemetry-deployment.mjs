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

/**
 * Drop fields whose value carries no configuration: null, "", or []. The AWS
 * provider reads an unset task-definition field back as "" or [] and plans it
 * as null (or the other way round between provider versions), which is not a
 * change an operator made.
 */
function withoutEmpty(object) {
  for (const [key, entry] of Object.entries(object)) {
    if (entry === null || entry === "" || (Array.isArray(entry) && entry.length === 0)) delete object[key];
  }
  return object;
}

function normalizedTaskDefinition(value, unknownFields = []) {
  const normalized = clone(value);
  if (!normalized) return normalized;
  // Fields Terraform only knows after apply cannot be compared, whatever the
  // state holds for them; they are computed, not configured.
  for (const field of [...TASK_DEFINITION_COMPUTED_FIELDS, ...unknownFields]) delete normalized[field];
  withoutEmpty(normalized);
  const definitions = typeof normalized.container_definitions === "string"
    ? JSON.parse(normalized.container_definitions)
    : normalized.container_definitions;
  assert.ok(Array.isArray(definitions), "task definition container_definitions must be an array");
  for (const container of definitions) {
    withoutEmpty(container);
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
  const resources = plan.resource_changes ?? [];
  const changes = resources.filter((change) => {
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
      const unknownFields = Object.keys(resource.change.after_unknown ?? {});
      assert.equal(
        sameJson(
          normalizedTaskDefinition(resource.change.before, unknownFields),
          normalizedTaskDefinition(resource.change.after, unknownFields),
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
  const taskResource = resources.find((change) => change.address === "aws_ecs_task_definition.worker");
  assert.ok(taskResource, "automatic collector plan must include the task definition");
  if (!taskChange) {
    assert.equal(
      sameJson(taskResource.change?.actions ?? [], ["no-op"]),
      true,
      "unchanged collector task definition must be a Terraform no-op",
    );
  }
  const metadata = releaseMetadata(taskResource.change.after ?? taskResource.change.before);
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
  throw new Error("usage: group-telemetry-deployment.mjs <plan|ecs|heartbeat> [options]");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
