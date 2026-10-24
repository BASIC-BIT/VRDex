import { resolveWorkerAllocation, validateMeasuredSnapshot } from '../workers/restream/broadcast-capacity.mjs';
import { validateAllocationSnapshot } from '../workers/restream/worker-allocation.mjs';
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";

const convexApi = {
  completeTaskCleanup: makeFunctionReference("eventMediaWorker:completeTaskCleanup"),
  recordProcessStatus: makeFunctionReference("eventMediaWorker:recordProcessStatus"),
  admitDispatch: makeFunctionReference("eventMediaWorker:admitDispatch"),
  recordDispatchedTask: makeFunctionReference("eventMediaWorker:recordDispatchedTask"),
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

export function loadConfig(options = {}) {
  const bridgeToken = Object.hasOwn(options, "bridgeToken")
    ? options.bridgeToken
    : requiredEnv("VRDEX_EVENT_MEDIA_BRIDGE_TOKEN");
  if (typeof bridgeToken !== "string" || !bridgeToken.trim()) {
    throw new Error("Bridge token must be a non-empty string.");
  }
  const secretRefMap = stringMapEnv("VRDEX_EVENT_MEDIA_SECRET_REF_MAP_JSON");
  const baseEnvironment = stringMapEnv("VRDEX_EVENT_MEDIA_ECS_BASE_ENV_JSON", {});
  if (Object.keys(baseEnvironment).some(name => (name === "VRDEX_EVENT_MEDIA_BRIDGE_TOKEN" || name === "VRDEX_EVENT_MEDIA_OPTIONAL_SECRET_ARNS_JSON" || name === optionalEnv("VRDEX_EVENT_MEDIA_OUTPUT_SECRET_ENV") || name.startsWith("VRDEX_EVENT_MEDIA_OUTPUT_SECRET_") || name === "VRDEX_EVENT_MEDIA_OUTPUT_INGEST_SECRET_JSON"))) throw new Error("Worker credentials must use ECS secret references.");
  if (optionalEnv("VRDEX_EVENT_MEDIA_ECS_CPU") || optionalEnv("VRDEX_EVENT_MEDIA_ECS_MEMORY")) throw Error("Event worker resources must use the session allocation");
  validateBaseEnvironment(baseEnvironment);
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
    containerCommand: stringListJsonEnv("VRDEX_EVENT_MEDIA_ECS_COMMAND_JSON") ?? ["node", "workers/restream/event-worker.mjs"],
    workerTokenSecretArn: requiredEnv("VRDEX_EVENT_MEDIA_WORKER_TOKEN_SECRET_ARN"),
    logGroupName: requiredEnv("VRDEX_EVENT_MEDIA_ECS_LOG_GROUP"),
    logStreamPrefix: optionalEnv("VRDEX_EVENT_MEDIA_ECS_LOG_STREAM_PREFIX") ?? "worker",
    ephemeralStorageGiB: integerEnv("VRDEX_EVENT_MEDIA_ECS_EPHEMERAL_STORAGE_GIB", 40, 21, 200),
    subnets: listEnv("VRDEX_EVENT_MEDIA_ECS_SUBNETS"),
    securityGroups: listEnv("VRDEX_EVENT_MEDIA_ECS_SECURITY_GROUPS"),
    assignPublicIp: optionalEnv("VRDEX_EVENT_MEDIA_ECS_ASSIGN_PUBLIC_IP") ?? "ENABLED",
    outputSecretEnvName: optionalEnv("VRDEX_EVENT_MEDIA_OUTPUT_SECRET_ENV") ?? "VRDEX_EVENT_MEDIA_OUTPUT_INGEST_SECRET_JSON",
    pollMs: integerEnv("VRDEX_EVENT_MEDIA_BRIDGE_POLL_MS", 30_000, 1_000, 300_000),
    drainAtMs: optionalEnv("VRDEX_EVENT_MEDIA_BRIDGE_DRAIN_AT_MS") === undefined
      ? undefined
      : integerEnv("VRDEX_EVENT_MEDIA_BRIDGE_DRAIN_AT_MS", 0, 0, Number.MAX_SAFE_INTEGER),
    once: process.argv.includes("--once"),
    configCheckOnly: process.env.VRDEX_EVENT_MEDIA_ECS_BRIDGE_CONFIG_CHECK_ONLY === "true",
    secretRefMap,
    baseEnvironment,
    redactValues: [bridgeToken, ...Object.values(secretRefMap)],
  };
}

function validateBaseEnvironment(environment) {
  if (Object.keys(environment ?? {}).some(key => /(?:ALLOCATION|MEDIA_SETTINGS|VIDEO_PRESET|AUDIO_BITRATE|QUALITY|ECS_CPU|ECS_MEMORY|ECS_CONTAINER_METADATA_URI)/.test(key))) throw Error("Conflicting worker snapshot environment");
}
function environmentEntries(command, config, snapshot) {
  const watchUrl = outputWatchUrl(command.output);

  return Object.entries({
    ...config.baseEnvironment,
    VRDEX_EVENT_MEDIA_ALLOCATION_SNAPSHOT_JSON: JSON.stringify(snapshot),
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

export function taskDefinitionFor(command, config, resolve = resolveWorkerAllocation) {
  validateBaseEnvironment(config.baseEnvironment);
  const snapshot = validateAllocationSnapshot(command.session);
  const allocation = validateMeasuredSnapshot(snapshot, resolve);
  if (command.output && command.output.outputId !== snapshot.outputId) throw Error('Mismatched primary destination');
  if ((command.optionalOutputs ?? []).some(output => !snapshot.destinationProfiles.some(d => d.destination === 'twitch' && d.outputId === output.outputId))) throw Error('Mismatched optional destination');
  const credentialRef = command.output?.credentialRef;
  const secretArn = credentialRef === undefined ? undefined : config.secretRefMap[credentialRef];

  if (credentialRef !== undefined && secretArn === undefined) {
    throw new Error(`No AWS secret ARN is configured for credential reference ${credentialRef}.`);
  }

  const optional = command.optionalOutputs ?? [];
  if (optional.length > 1) throw new Error("At most one optional output is supported.");
  const bindings = {}, additionalSecrets = [];
  if (secretArn && config.outputSecretEnvName !== "VRDEX_EVENT_MEDIA_OUTPUT_INGEST_SECRET_JSON") additionalSecrets.push({name:"VRDEX_EVENT_MEDIA_OUTPUT_INGEST_SECRET_JSON", valueFrom:secretArn});
  for (const output of optional) {
    const ref = output?.credentialRef;
    const arn = ref && config.secretRefMap[ref];
    // Missing optional binding is a destination setup fault, not primary failure.
    if (!arn) continue;
    bindings[ref] = arn;
  }
  return {
    family: `${config.familyPrefix}-${ecsNamePart(command.session.sessionId)}`,
    requiresCompatibilities: ["FARGATE"],
    networkMode: "awsvpc",
    cpu: String(allocation.cpuUnits),
    memory: String(allocation.memoryMiB),
    executionRoleArn: config.executionRoleArn,
    taskRoleArn: config.taskRoleArn,
    runtimePlatform: { operatingSystemFamily: "LINUX", cpuArchitecture: "X86_64" },
    ephemeralStorage: { sizeInGiB: config.ephemeralStorageGiB },
    containerDefinitions: [
      {
        name: config.containerName,
        image: config.image,
        cpu: allocation.cpuUnits,
        memory: allocation.memoryMiB,
        essential: true,
        ...(config.containerCommand === undefined ? {} : { command: config.containerCommand }),
        environment: [...environmentEntries(command, config, snapshot), {name:"VRDEX_EVENT_MEDIA_OPTIONAL_SECRET_ARNS_JSON",value:JSON.stringify(bindings)}],
        secrets: [{name:"VRDEX_EVENT_MEDIA_BRIDGE_TOKEN",valueFrom:config.workerTokenSecretArn}, ...(secretArn === undefined ? [] : [{ name: config.outputSecretEnvName, valueFrom: secretArn }]), ...additionalSecrets],
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

async function registerTaskDefinition(command, config, runAws) {
  return runAws(config, ["ecs", "register-task-definition", "--cli-input-json", JSON.stringify(taskDefinitionFor(command, config))]);
}

async function runTask(command, taskDefinitionArn, config, runAws) {
  const response = await runAws(config, [
    "ecs",
    "run-task",
    "--cluster",
    config.cluster,
    "--task-definition",
    taskDefinitionArn,
    "--launch-type",
    "FARGATE",
    "--propagate-tags",
    "TASK_DEFINITION",
    "--platform-version",
    "LATEST",
    "--count",
    "1",
    "--client-token",
    command.dispatchId,
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

async function cleanupUnlaunched(client, config, session, runAws) {
  try {
    await runAws(config, ["ecs", "deregister-task-definition", "--task-definition", session.workerTaskDefinitionArn]);
  } catch {
    console.warn(JSON.stringify({ event: "event_media_unlaunched_cleanup_retry", sessionId: session.sessionId }));
    return;
  }
  await client.mutation(makeFunctionReference("eventMediaWorker:completeUnlaunchedCleanup"), { bridgeToken: config.bridgeToken, sessionId: session.sessionId, taskDefinitionArn: session.workerTaskDefinitionArn });
}
async function cleanupLosingDefinition(client, config, command, taskDefinitionArn, runAws) {
  try {
    await runAws(config, ["ecs", "deregister-task-definition", "--task-definition", taskDefinitionArn]);
  } catch {
    const recorded = await client.mutation(makeFunctionReference("eventMediaWorker:recordUnusedDefinitionCleanup"), { bridgeToken: config.bridgeToken, sessionId: command.session.sessionId, taskDefinitionArn });
    console.warn(JSON.stringify({ event: "event_media_unused_definition_manual_cleanup", sessionId: command.session.sessionId, ...(recorded?.accepted === true ? { taskDefinitionArn } : {}) }));
  }
}
async function startCommand(command, client, config, runAws, isDraining) {
  command.dispatchId = command.session.dispatchId ?? randomUUID();
  const identity = { bridgeToken: config.bridgeToken, eventId: command.eventId, sessionId: command.session.sessionId, dispatchId: command.dispatchId, commandId: command.commandId, workerId: config.workerId };
  const admission = await client.mutation(convexApi.admitDispatch, {bridgeToken:config.bridgeToken,eventId:command.eventId,sessionId:command.session.sessionId,dispatchId:command.dispatchId,launchProtocol:"fenced-v1"});
  if (admission?.granted === false) {
    delete command.dispatchId;
    throw new Error("Worker dispatch capacity or ownership denied.");
  }
  if (admission?.granted !== true) throw new Error("Worker dispatch admission response is unknown.");
  let taskDefinitionArn;
  try {
    if (isDraining()) throw Error("Bridge is draining before task registration.");
    const registered = await registerTaskDefinition(command, config, runAws);
    taskDefinitionArn = registered.taskDefinition?.taskDefinitionArn;
    if (typeof taskDefinitionArn !== "string" || !taskDefinitionArn || taskDefinitionArn.length > 512) throw Error("Task definition registration is unknown.");
  } catch {
    // No RunTask is possible until the backend marker. A competing bridge's
    // marker atomically defeats this release, even after claim reclamation.
    await client.mutation(makeFunctionReference("eventMediaWorker:releaseUnlaunchedDispatch"), identity);
    throw Error("Worker prelaunch configuration or registration failed.");
  }
  if (isDraining()) {
    const released = await client.mutation(makeFunctionReference("eventMediaWorker:releaseUnlaunchedDispatch"), { ...identity, taskDefinitionArn });
    if (released?.accepted === true) await cleanupUnlaunched(client, config, { sessionId: identity.sessionId, workerTaskDefinitionArn: taskDefinitionArn }, runAws);
    throw Error("Bridge is draining before launch intent.");
  }
  // A throw or malformed marker response is ambiguous. Never release or launch.
  const marker = await client.mutation(makeFunctionReference("eventMediaWorker:markLaunchAttempt"), { ...identity, taskDefinitionArn });
  if (marker?.accepted !== true) {
    if (marker?.accepted === false) {
      const released = await client.mutation(makeFunctionReference("eventMediaWorker:releaseUnlaunchedDispatch"), { ...identity, taskDefinitionArn });
      if (released?.accepted === true) await cleanupUnlaunched(client, config, { sessionId: identity.sessionId, workerTaskDefinitionArn: taskDefinitionArn }, runAws);
      else if (marker.cleanupUnused === true) await cleanupLosingDefinition(client, config, command, taskDefinitionArn, runAws);
    }
    throw Error("Worker launch fence was not granted.");
  }
  // Accepted intent completes the launch/registration handshake even if drain
  // begins in flight. Reconciliation can then stop the exact recorded task.
  const taskArn = await runTask(command, taskDefinitionArn, config, runAws);
  if (!taskArn) throw new Error("ECS RunTask did not return a task ARN.");
  // This path registers LINUX/X86_64 and uses explicit --launch-type FARGATE,
  // with no capacity-provider strategy (therefore On-Demand, never FARGATE_SPOT).
  const recorded=await client.mutation(convexApi.recordDispatchedTask, {bridgeToken:config.bridgeToken,sessionId:command.session.sessionId,dispatchId:command.dispatchId,taskArn,taskDefinitionArn,computeRuntime:{region:config.region,os:"linux",architecture:"x86_64",purchaseModel:"on_demand"}});
  if(recorded?.accepted!==true)throw new Error("Worker dispatch registration denied.");
  console.log(JSON.stringify({ event: "event_media_ecs_task_started", sessionId: command.session.sessionId, taskArn, taskDefinitionArn }));
}

async function stopCommand(command, client, config, runAws = aws) {
  const taskArn = command.session.workerTaskId;

  if (!taskArn) {
    if (command.session.epoch !== undefined || command.session.dispatchId) return;
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

  await runAws(config, ["ecs", "stop-task", "--cluster", config.cluster, "--task", taskArn, "--reason", "VRDex event media stop command."]);
  if (command.session.epoch !== undefined || command.session.dispatchId) {
    await client.mutation(makeFunctionReference("eventMediaWorker:recordTaskStopRequested"), {
      bridgeToken: config.bridgeToken, sessionId: command.session.sessionId, taskArn,
    });
  } else await client.mutation(convexApi.recordEventMediaWorkerBridgeTaskStatus, {
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
  const reason = "Worker dispatch failed; inspect reservation before retrying.";
  if(command.dispatchId || command.session.dispatchId || command.session.epoch !== undefined){console.error(JSON.stringify({event:"event_media_ecs_dispatch_failed",sessionId:command.session.sessionId}));return;}

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

export async function claimAndProcess(client, config, runAws = aws, isDraining = () => false) {
  if (isDraining()) return false;
  const command = await client.mutation(convexApi.claimEventMediaWorkerCommand, {
    bridgeToken: config.bridgeToken,
    workerId: config.workerId,
  });

  if (command === null) {
    return false;
  }

  try {
    if (command.commandType === "start_program") {
      if (isDraining()) throw Error("Bridge is draining after command claim.");
      await startCommand(command, client, config, runAws, isDraining);
      return true;
    }

    if (command.commandType === "stop_program") {
      await stopCommand(command, client, config, runAws);
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
    return { status: "starting", workerTaskStatus: "running", reason: undefined };
  }

  return { status: "starting", workerTaskStatus: "starting", reason: workerStatusReason(task.lastStatus) };
}

async function cleanupStoppedTask(client, config, session, runAws) {
  try {
    if (session.workerTaskDefinitionArn)
      await runAws(config, ["ecs", "deregister-task-definition", "--task-definition", session.workerTaskDefinitionArn]);
  } catch {
    // Retry from durable cleanup-pending discovery. Never log provider exceptions
    // (which can contain secrets), and never swallow control-plane failures.
    console.warn(JSON.stringify({ event: "event_media_task_cleanup_retry", sessionId: session.sessionId }));
    return;
  }
  await client.mutation(convexApi.completeTaskCleanup, { bridgeToken: config.bridgeToken, sessionId: session.sessionId, taskArn: session.workerTaskId });
}

export async function refreshSessions(client, config, runAws = aws, draining = false) {
  const queryArgs = {
    bridgeToken: config.bridgeToken,
    workerId: config.workerId,
  };
  const sessions = await client.query(convexApi.listEventMediaWorkerBridgeSessions, queryArgs);
  for (const session of sessions.filter(session => !session.workerTaskId && !session.dispatchId && session.epoch === undefined && session.launchAttemptedAt === undefined && session.workerTaskDefinitionArn && session.workerTaskCleanupPending === true))
    await cleanupUnlaunched(client, config, session, runAws);
  const taskSessions = sessions.filter((session) => session.workerTaskId);

  if (taskSessions.length === 0) {
    return draining ? (await client.query(convexApi.listEventMediaWorkerBridgeSessions, queryArgs)).length : undefined;
  }

  const tasks=[];
  for(let offset=0;offset<taskSessions.length;offset+=100){
    const response=await runAws(config,["ecs","describe-tasks","--cluster",config.cluster,"--tasks",...taskSessions.slice(offset,offset+100).map(session=>taskId(session.workerTaskId))]);
    tasks.push(...(response.tasks??[]));
  }
  const tasksByArn=new Map(tasks.flatMap(task=>[[task.taskArn,task],[taskId(task.taskArn),task]]));

  for (const session of taskSessions) {
    const task = tasksByArn.get(session.workerTaskId);

    if (task === undefined) {
      continue;
    }

    if (draining && task.lastStatus !== "STOPPED") {
      await runAws(config, ["ecs", "stop-task", "--cluster", config.cluster, "--task", session.workerTaskId, "--reason", "VRDex event media bridge drain."]);
    }
    if(session.dispatchId || session.epoch !== undefined){
      // Stop intent survives a failed/ambiguous request, late ARN registration,
      // and a racing worker acknowledgement. ECS StopTask is idempotent for this
      // exact session task; only DescribeTasks STOPPED can release admission.
      if (session.stopRequestedAt !== undefined && task.lastStatus !== "STOPPED") {
        if (!draining) await runAws(config, ["ecs", "stop-task", "--cluster", config.cluster, "--task", session.workerTaskId, "--reason", "VRDex event media stop reconciliation."]);
        await client.mutation(makeFunctionReference("eventMediaWorker:recordTaskStopRequested"), {
          bridgeToken: config.bridgeToken, sessionId: session.sessionId, taskArn: session.workerTaskId,
        });
      }
      await client.mutation(convexApi.recordProcessStatus,{bridgeToken:config.bridgeToken,sessionId:session.sessionId,taskArn:session.workerTaskId,stopped:task.lastStatus==="STOPPED"});
      if(task.lastStatus==="STOPPED"){
        if (session.workerTaskCleanupPending !== false)
          await cleanupStoppedTask(client, config, session, runAws);
      }
      continue;
    }
    const next = ecsStatusToSessionStatus(task);
    const cleanupOnly = task.lastStatus === "STOPPED" && session.workerTaskCleanupPending !== undefined;
    // Confirmed terminal tasks need only cleanup retries. Replaying their legacy
    // publication status can race a replacement session using the destination.
    if (!cleanupOnly && (session.status !== next.status || session.workerTaskStatus !== next.workerTaskStatus)) {
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
    }

    if (task.lastStatus === "STOPPED") {
      await client.mutation(convexApi.recordProcessStatus, { bridgeToken: config.bridgeToken, sessionId: session.sessionId, taskArn: session.workerTaskId, stopped: true });
      if (session.workerTaskCleanupPending !== false)
        await cleanupStoppedTask(client, config, session, runAws);
    }
  }
  // A fresh empty discovery result proves both process reconciliation and
  // cleanup acknowledgement. Unknown task ARNs and failed cleanup stay visible.
  return draining ? (await client.query(convexApi.listEventMediaWorkerBridgeSessions, queryArgs)).length : undefined;
}

export async function runBridge(client, config, runAws = aws, {
  wallClock = Date.now,
  monotonicClock = () => performance.now(),
  signals = process,
  wait = (ms, signal) => sleep(ms, undefined, { signal }),
} = {}) {
  // Anchor the absolute deadline once. Wall clock changes cannot extend this
  // process, and a retry uses the same absolute environment deadline.
  const drainDeadline = config.drainAtMs === undefined
    ? Infinity
    : monotonicClock() + Math.max(0, config.drainAtMs - wallClock());
  let draining = false;
  let sleepController;
  const requestDrain = () => {
    draining = true;
    sleepController?.abort();
  };
  const isDraining = () => {
    if (monotonicClock() >= drainDeadline) draining = true;
    return draining;
  };
  signals.on("SIGTERM", requestDrain);
  signals.on("SIGINT", requestDrain);
  try {
    while (true) {
      if (!isDraining()) await claimAndProcess(client, config, runAws, isDraining);
      const refreshDraining = isDraining();
      const remaining = await refreshSessions(client, config, runAws, refreshDraining);
      if (isDraining()) {
        if (!refreshDraining) continue;
        if (remaining === 0) return;
      } else if (config.once) return;

      sleepController = new AbortController();
      try {
        const waitMs = refreshDraining ? Math.min(config.pollMs, 1000) : Math.min(config.pollMs, Math.max(0, drainDeadline - monotonicClock()));
        if (waitMs === 0) continue;
        await wait(waitMs, sleepController.signal);
      } catch (error) {
        if (error?.name !== "AbortError" || !isDraining()) throw error;
      } finally {
        sleepController = undefined;
      }
    }
  } finally {
    signals.off("SIGTERM", requestDrain);
    signals.off("SIGINT", requestDrain);
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

  await runBridge(client, config);
}

if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href)main().catch((error) => {
  console.error(error instanceof Error ? sanitizeLog(error.message, [process.env.VRDEX_EVENT_MEDIA_BRIDGE_TOKEN]) : String(error));
  process.exitCode = 1;
});
