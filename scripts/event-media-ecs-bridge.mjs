import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";

const OPEN_SESSION_STATUSES = new Set(["scheduled", "starting", "live", "hold", "fallback", "stopping"]);
const convexApi = {
  claimEventMediaWorkerCommand: makeFunctionReference("events:claimEventMediaWorkerCommand"),
  listEventMediaWorkerBridgeSessions: makeFunctionReference("events:listEventMediaWorkerBridgeSessions"),
  recordEventMediaWorkerBridgeTaskStatus: makeFunctionReference("events:recordEventMediaWorkerBridgeTaskStatus"),
};

function requiredEnv(name) {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`${name} is required.`);
  }

  return value;
}

function optionalEnv(name) {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function integerEnv(name, defaultValue, min, max) {
  const value = optionalEnv(name) ?? String(defaultValue);

  if (!/^\d+$/.test(value)) {
    throw new Error(`${name} must be an integer.`);
  }

  const parsed = Number(value);

  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} must be between ${min} and ${max}.`);
  }

  return parsed;
}

function listEnv(name) {
  return requiredEnv(name)
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function jsonObjectEnv(name, defaultValue = {}) {
  const value = optionalEnv(name);

  if (value === undefined) {
    return defaultValue;
  }

  const parsed = JSON.parse(value);

  if (parsed === null || Array.isArray(parsed) || typeof parsed !== "object") {
    throw new Error(`${name} must be a JSON object.`);
  }

  return parsed;
}

function stringMapEnv(name, defaultValue = {}) {
  const parsed = jsonObjectEnv(name, defaultValue);
  const entries = Object.entries(parsed);

  for (const [key, value] of entries) {
    if (typeof value !== "string" || value.trim() === "") {
      throw new Error(`${name}.${key} must be a non-empty string.`);
    }
  }

  return Object.fromEntries(entries.map(([key, value]) => [key, value.trim()]));
}

function stringListJsonEnv(name) {
  const value = optionalEnv(name);

  if (value === undefined) {
    return undefined;
  }

  const parsed = JSON.parse(value);

  if (!Array.isArray(parsed) || parsed.length === 0 || parsed.some((entry) => typeof entry !== "string" || entry.trim() === "")) {
    throw new Error(`${name} must be a JSON array of non-empty strings.`);
  }

  return parsed.map((entry) => entry.trim());
}

function ecsNamePart(value) {
  return value.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);
}

function taskId(taskArn) {
  return taskArn.split("/").at(-1) ?? taskArn;
}

function workerStatusReason(value) {
  if (value === undefined) {
    return undefined;
  }

  return value.length <= 500 ? value : `${value.slice(0, 497)}...`;
}

function outputWatchUrl(output) {
  return output?.playbackLinks?.find((link) => link.platform === "browser")?.url ?? output?.playbackLinks?.[0]?.url;
}

function sanitizeLog(value, redactValues) {
  let output = value;

  for (const secret of redactValues) {
    if (secret) {
      output = output.split(secret).join("[REDACTED]");
    }
  }

  return output;
}

function run(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      const cleanStderr = sanitizeLog(stderr, options.redactValues ?? []);

      if (code === 0) {
        resolvePromise(stdout.trim() ? JSON.parse(stdout) : {});
        return;
      }

      reject(new Error(`${command} ${args[0] ?? ""} failed with exit ${code}${cleanStderr ? `: ${cleanStderr}` : ""}`));
    });
  });
}

function aws(config, args) {
  return run(config.awsCommand, [...args, "--region", config.region], { redactValues: config.redactValues });
}

function loadConfig() {
  const bridgeToken = requiredEnv("VRDEX_EVENT_MEDIA_BRIDGE_TOKEN");
  const secretRefMap = stringMapEnv("VRDEX_EVENT_MEDIA_SECRET_REF_MAP_JSON");
  const baseEnvironment = stringMapEnv("VRDEX_EVENT_MEDIA_ECS_BASE_ENV_JSON", {});
  const workerId = optionalEnv("VRDEX_EVENT_MEDIA_BRIDGE_WORKER_ID") ?? `event-media-ecs-bridge-${process.pid}`;

  return {
    awsCommand: optionalEnv("VRDEX_EVENT_MEDIA_AWS_COMMAND") ?? "aws",
    bridgeToken,
    workerId,
    convexUrl: requiredEnv("CONVEX_URL"),
    region: requiredEnv("VRDEX_EVENT_MEDIA_ECS_REGION"),
    cluster: requiredEnv("VRDEX_EVENT_MEDIA_ECS_CLUSTER"),
    familyPrefix: optionalEnv("VRDEX_EVENT_MEDIA_ECS_TASK_FAMILY_PREFIX") ?? "vrdex-event-media-worker",
    image: requiredEnv("VRDEX_EVENT_MEDIA_ECS_IMAGE"),
    executionRoleArn: requiredEnv("VRDEX_EVENT_MEDIA_ECS_EXECUTION_ROLE_ARN"),
    taskRoleArn: requiredEnv("VRDEX_EVENT_MEDIA_ECS_TASK_ROLE_ARN"),
    containerName: optionalEnv("VRDEX_EVENT_MEDIA_ECS_CONTAINER") ?? "hosted-worker",
    containerCommand: stringListJsonEnv("VRDEX_EVENT_MEDIA_ECS_COMMAND_JSON"),
    logGroupName: requiredEnv("VRDEX_EVENT_MEDIA_ECS_LOG_GROUP"),
    logStreamPrefix: optionalEnv("VRDEX_EVENT_MEDIA_ECS_LOG_STREAM_PREFIX") ?? "worker",
    cpu: String(integerEnv("VRDEX_EVENT_MEDIA_ECS_CPU", 1024, 256, 16384)),
    memory: String(integerEnv("VRDEX_EVENT_MEDIA_ECS_MEMORY", 2048, 512, 32768)),
    ephemeralStorageGiB: integerEnv("VRDEX_EVENT_MEDIA_ECS_EPHEMERAL_STORAGE_GIB", 40, 21, 200),
    subnets: listEnv("VRDEX_EVENT_MEDIA_ECS_SUBNETS"),
    securityGroups: listEnv("VRDEX_EVENT_MEDIA_ECS_SECURITY_GROUPS"),
    assignPublicIp: optionalEnv("VRDEX_EVENT_MEDIA_ECS_ASSIGN_PUBLIC_IP") ?? "ENABLED",
    outputSecretEnvName: optionalEnv("VRDEX_EVENT_MEDIA_OUTPUT_SECRET_ENV") ?? "VRDEX_EVENT_MEDIA_OUTPUT_INGEST_SECRET_JSON",
    pollMs: integerEnv("VRDEX_EVENT_MEDIA_BRIDGE_POLL_MS", 30_000, 1_000, 300_000),
    once: process.argv.includes("--once"),
    configCheckOnly: process.env.VRDEX_EVENT_MEDIA_ECS_BRIDGE_CONFIG_CHECK_ONLY === "true",
    secretRefMap,
    baseEnvironment,
    redactValues: [bridgeToken, ...Object.values(secretRefMap)],
  };
}

function environmentEntries(command, config) {
  const watchUrl = outputWatchUrl(command.output);

  return Object.entries({
    ...config.baseEnvironment,
    CONVEX_URL: config.convexUrl,
    VRDEX_EVENT_MEDIA_COMMAND_ID: command.commandId,
    VRDEX_EVENT_MEDIA_EVENT_ID: command.eventId,
    VRDEX_EVENT_MEDIA_PROGRAM_ID: command.program.programId,
    VRDEX_EVENT_MEDIA_SESSION_ID: command.session.sessionId,
    ...(command.output === undefined
      ? {}
      : {
          VRDEX_EVENT_MEDIA_OUTPUT_ID: command.output.outputId,
          VRDEX_EVENT_MEDIA_OUTPUT_PLAYBACK_LINKS_JSON: JSON.stringify(command.output.playbackLinks),
          ...(watchUrl === undefined
            ? {}
            : {
                VRDEX_EVENT_MEDIA_OUTPUT_WATCH_URL: watchUrl,
                VRDEX_VRCDN_POC_OUTPUT_WATCH_URL: watchUrl,
              }),
        }),
  }).map(([name, value]) => ({ name, value: String(value) }));
}

function taskDefinitionFor(command, config) {
  const credentialRef = command.output?.credentialRef;
  const secretArn = credentialRef === undefined ? undefined : config.secretRefMap[credentialRef];

  if (credentialRef !== undefined && secretArn === undefined) {
    throw new Error(`No AWS secret ARN is configured for credential reference ${credentialRef}.`);
  }

  return {
    family: `${config.familyPrefix}-${ecsNamePart(command.session.sessionId)}`,
    requiresCompatibilities: ["FARGATE"],
    networkMode: "awsvpc",
    cpu: config.cpu,
    memory: config.memory,
    executionRoleArn: config.executionRoleArn,
    taskRoleArn: config.taskRoleArn,
    runtimePlatform: { operatingSystemFamily: "LINUX", cpuArchitecture: "X86_64" },
    ephemeralStorage: { sizeInGiB: config.ephemeralStorageGiB },
    containerDefinitions: [
      {
        name: config.containerName,
        image: config.image,
        cpu: Number(config.cpu),
        memory: Number(config.memory),
        essential: true,
        ...(config.containerCommand === undefined ? {} : { command: config.containerCommand }),
        environment: environmentEntries(command, config),
        secrets: secretArn === undefined ? [] : [{ name: config.outputSecretEnvName, valueFrom: secretArn }],
        logConfiguration: {
          logDriver: "awslogs",
          options: {
            "awslogs-group": config.logGroupName,
            "awslogs-region": config.region,
            "awslogs-stream-prefix": config.logStreamPrefix,
          },
        },
      },
    ],
    tags: [
      { key: "Project", value: "VRDex" },
      { key: "Component", value: "event-media-worker" },
      { key: "ManagedBy", value: "event-media-ecs-bridge" },
    ],
  };
}

async function registerTaskDefinition(command, config) {
  return aws(config, ["ecs", "register-task-definition", "--cli-input-json", JSON.stringify(taskDefinitionFor(command, config))]);
}

async function runTask(command, taskDefinitionArn, config) {
  const response = await aws(config, [
    "ecs",
    "run-task",
    "--cluster",
    config.cluster,
    "--task-definition",
    taskDefinitionArn,
    "--launch-type",
    "FARGATE",
    "--platform-version",
    "LATEST",
    "--count",
    "1",
    "--started-by",
    `${config.workerId}-${command.session.sessionId}`,
    "--network-configuration",
    JSON.stringify({
      awsvpcConfiguration: {
        subnets: config.subnets,
        securityGroups: config.securityGroups,
        assignPublicIp: config.assignPublicIp,
      },
    }),
  ]);

  if (response.failures?.length > 0) {
    throw new Error(`ECS RunTask returned failures: ${JSON.stringify(response.failures)}`);
  }

  return response.tasks?.[0]?.taskArn;
}

async function startCommand(command, client, config) {
  const registered = await registerTaskDefinition(command, config);
  const taskDefinitionArn = registered.taskDefinition.taskDefinitionArn;
  const taskArn = await runTask(command, taskDefinitionArn, config);

  if (!taskArn) {
    throw new Error("ECS RunTask did not return a task ARN.");
  }

  await client.mutation(convexApi.recordEventMediaWorkerBridgeTaskStatus, {
    bridgeToken: config.bridgeToken,
    workerId: config.workerId,
    sessionId: command.session.sessionId,
    commandId: command.commandId,
    status: "starting",
    workerRuntime: "ecs-fargate",
    workerProvider: "aws_ecs",
    workerTaskDefinitionArn: taskDefinitionArn,
    workerTaskId: taskArn,
    workerTaskStatus: "starting",
  });

  console.log(JSON.stringify({ event: "event_media_ecs_task_started", sessionId: command.session.sessionId, taskArn, taskDefinitionArn }));
}

async function stopCommand(command, client, config) {
  const taskArn = command.session.workerTaskId;

  if (!taskArn) {
    await client.mutation(convexApi.recordEventMediaWorkerBridgeTaskStatus, {
      bridgeToken: config.bridgeToken,
      workerId: config.workerId,
      sessionId: command.session.sessionId,
      commandId: command.commandId,
      status: "error",
      workerTaskStatus: "failed",
      workerTaskStatusReason: "Stop command received before an ECS task ARN was recorded.",
    });
    return;
  }

  await aws(config, ["ecs", "stop-task", "--cluster", config.cluster, "--task", taskArn, "--reason", "VRDex event media stop command."]);
  await client.mutation(convexApi.recordEventMediaWorkerBridgeTaskStatus, {
    bridgeToken: config.bridgeToken,
    workerId: config.workerId,
    sessionId: command.session.sessionId,
    commandId: command.commandId,
    status: "stopping",
    workerProvider: "aws_ecs",
    workerTaskId: taskArn,
    workerTaskStatus: "stopping",
  });
  console.log(JSON.stringify({ event: "event_media_ecs_task_stop_requested", sessionId: command.session.sessionId, taskArn }));
}

async function recordClaimedCommandError(command, error, client, config) {
  const reason = workerStatusReason(error instanceof Error ? error.message : String(error));

  await client.mutation(convexApi.recordEventMediaWorkerBridgeTaskStatus, {
    bridgeToken: config.bridgeToken,
    workerId: config.workerId,
    sessionId: command.session.sessionId,
    commandId: command.commandId,
    status: "error",
    workerProvider: "aws_ecs",
    workerTaskStatus: "failed",
    workerTaskStatusReason: reason,
  });

  console.error(
    sanitizeLog(
      JSON.stringify({
        event: "event_media_ecs_command_failed",
        commandId: command.commandId,
        sessionId: command.session.sessionId,
        reason,
      }),
      config.redactValues,
    ),
  );
}

async function claimAndProcess(client, config) {
  const command = await client.mutation(convexApi.claimEventMediaWorkerCommand, {
    bridgeToken: config.bridgeToken,
    workerId: config.workerId,
  });

  if (command === null) {
    return false;
  }

  try {
    if (command.commandType === "start_program") {
      await startCommand(command, client, config);
      return true;
    }

    if (command.commandType === "stop_program") {
      await stopCommand(command, client, config);
      return true;
    }
  } catch (error) {
    await recordClaimedCommandError(command, error, client, config);
    return true;
  }

  return false;
}

function ecsStatusToSessionStatus(task) {
  const container = task.containers?.[0];

  if (task.lastStatus === "STOPPED") {
    return {
      status: container?.exitCode === 0 ? "ended" : "error",
      workerTaskStatus: container?.exitCode === 0 ? "stopped" : "failed",
      reason: workerStatusReason(container?.reason ?? task.stoppedReason),
    };
  }

  if (task.lastStatus === "RUNNING") {
    return { status: "live", workerTaskStatus: "running", reason: undefined };
  }

  return { status: "starting", workerTaskStatus: "starting", reason: workerStatusReason(task.lastStatus) };
}

async function deregisterTaskDefinition(taskDefinitionArn, config) {
  if (!taskDefinitionArn) {
    return;
  }

  await aws(config, ["ecs", "deregister-task-definition", "--task-definition", taskDefinitionArn]);
}

async function refreshSessions(client, config) {
  const sessions = await client.query(convexApi.listEventMediaWorkerBridgeSessions, {
    bridgeToken: config.bridgeToken,
    workerId: config.workerId,
  });
  const taskSessions = sessions.filter((session) => session.workerTaskId && OPEN_SESSION_STATUSES.has(session.status));

  if (taskSessions.length === 0) {
    return;
  }

  const response = await aws(config, [
    "ecs",
    "describe-tasks",
    "--cluster",
    config.cluster,
    "--tasks",
    ...taskSessions.map((session) => taskId(session.workerTaskId)),
  ]);
  const tasksByArn = new Map((response.tasks ?? []).flatMap((task) => [[task.taskArn, task], [taskId(task.taskArn), task]]));

  for (const session of taskSessions) {
    const task = tasksByArn.get(session.workerTaskId);

    if (task === undefined) {
      continue;
    }

    const next = ecsStatusToSessionStatus(task);

    if (session.status === next.status && session.workerTaskStatus === next.workerTaskStatus) {
      continue;
    }

    await client.mutation(convexApi.recordEventMediaWorkerBridgeTaskStatus, {
      bridgeToken: config.bridgeToken,
      workerId: config.workerId,
      sessionId: session.sessionId,
      status: next.status,
      workerProvider: "aws_ecs",
      workerTaskId: session.workerTaskId,
      workerTaskStatus: next.workerTaskStatus,
      ...(next.reason === undefined ? {} : { workerTaskStatusReason: next.reason }),
    });

    if (next.status === "ended" || next.status === "error") {
      await deregisterTaskDefinition(session.workerTaskDefinitionArn, config);
    }
  }
}

async function main() {
  const config = loadConfig();

  if (config.configCheckOnly) {
    console.log(
      JSON.stringify({
        event: "event_media_ecs_bridge_configuration_validated",
        cluster: config.cluster,
        region: config.region,
        containerName: config.containerName,
        containerCommand: config.containerCommand ?? null,
        secretRefCount: Object.keys(config.secretRefMap).length,
        baseEnvironmentKeys: Object.keys(config.baseEnvironment).sort(),
      }),
    );
    return;
  }

  const client = new ConvexHttpClient(config.convexUrl);

  do {
    await claimAndProcess(client, config);
    await refreshSessions(client, config);

    if (!config.once) {
      await sleep(config.pollMs);
    }
  } while (!config.once);
}

main().catch((error) => {
  console.error(error instanceof Error ? sanitizeLog(error.message, [process.env.VRDEX_EVENT_MEDIA_BRIDGE_TOKEN]) : String(error));
  process.exitCode = 1;
});
