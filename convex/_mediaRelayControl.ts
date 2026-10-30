import { relayEnabled, relayOperationState } from "./_mediaRelayOperations";
import {
  WorkerBindingsSchema,
  type WorkerBinding,
} from "../packages/media-relay/src/worker/deployment";
import type { MutationCtx } from "./_generated/server";
import {
  OwnershipLeaseSchema,
  RELAY_POLICY,
  StreamKeySchema,
  type WorkerObservation,
} from "../packages/media-relay/src";
export function authenticateWorker(
  credential: string,
  workerId: string,
  workerEpoch: number,
) {
  const expected = process.env.MEDIA_RELAY_WORKER_TOKEN;
  if (
    !expected ||
    expected === process.env.MEDIA_RELAY_GATEWAY_TOKEN ||
    credential !== expected
  )
    throw Error("Relay deployment authentication denied");
  const bindings = WorkerBindingsSchema.parse(
    JSON.parse(process.env.MEDIA_RELAY_WORKERS ?? "null"),
  );
  const matches = bindings.filter((binding) => binding.workerId === workerId);
  const binding = matches[0];
  if (matches.length !== 1 || !binding || binding.workerEpoch !== workerEpoch)
    throw Error("Unverified relay worker identity");
  return binding;
}
export async function register(
  ctx: MutationCtx,
  credential: string,
  observation: WorkerObservation,
) {
  const binding = authenticateWorker(
    credential,
    observation.workerId,
    observation.workerEpoch,
  );
  if (
    Object.entries(binding.allocation).some(
      ([key, value]) => Reflect.get(observation.allocation, key) !== value,
    )
  )
    throw Error("Unverified relay worker allocation");
  const current = await ctx.db
    .query("mediaRelayWorkers")
    .withIndex("by_workerId", (q) => q.eq("workerId", observation.workerId))
    .unique();
  if (
    current &&
    (current.workerEpoch > observation.workerEpoch ||
      (current.workerEpoch === observation.workerEpoch &&
        current.observedAt > observation.observedAt))
  )
    throw Error("Stale worker observation");
  const data = {
    workerId: observation.workerId,
    workerEpoch: observation.workerEpoch,
    observedAt: observation.observedAt,
    registeredAt: Date.now(),
    observation,
  };
  if (current) await ctx.db.patch(current._id, data);
  else await ctx.db.insert("mediaRelayWorkers", data);
  return null;
}
export type Identity = Pick<WorkerObservation, "workerId" | "workerEpoch">;
export async function authority(
  ctx: MutationCtx,
  credential: string,
  identity: Identity,
) {
  const binding = authenticateWorker(
    credential,
    identity.workerId,
    identity.workerEpoch,
  );
  const worker = await ctx.db
    .query("mediaRelayWorkers")
    .withIndex("by_workerId", (q) => q.eq("workerId", identity.workerId))
    .unique();
  if (!worker || worker.workerEpoch !== identity.workerEpoch)
    throw Error("Worker registration required");
  const operations = await relayOperationState(ctx.db);
  return {
    ...binding,
    draining:
      binding.draining ||
      (operations?.drainingWorkers.includes(binding.workerId) ?? false),
  };
}
export async function source(ctx: MutationCtx, streamKey: string) {
  StreamKeySchema.parse(streamKey);
  const row = await ctx.db
    .query("mediaRelaySources")
    .withIndex("by_streamKey", (q) => q.eq("streamKey", streamKey))
    .unique();
  if (!row) throw Error("Source admission required");
  return row;
}
export async function owned(
  ctx: MutationCtx,
  identity: Identity & {
    streamKey: string;
    epoch: number;
  },
  now: number,
) {
  const row = await source(ctx, identity.streamKey);
  if (
    !row.owner ||
    row.owner.workerId !== identity.workerId ||
    row.owner.workerEpoch !== identity.workerEpoch ||
    row.epoch !== identity.epoch ||
    !row.leaseExpiresAt ||
    now >= row.leaseExpiresAt
  )
    throw Error("Source authority denied");
  return row;
}
export function lease(
  streamKey: string,
  workerId: string,
  epoch: number,
  now: number,
) {
  return OwnershipLeaseSchema.parse({
    streamKey,
    workerId,
    epoch,
    serverNow: now,
    expiresAt: now + RELAY_POLICY.leaseDurationMs,
    renewAfterMs: RELAY_POLICY.leaseRenewIntervalMs,
  });
}
export async function capacity(
  ctx: MutationCtx,
  binding: WorkerBinding,
  now: number,
  renewing: boolean,
) {
  if (!(await relayEnabled(ctx.db)) || (binding.draining && !renewing))
    throw Error("Relay worker draining or disabled");
  const rows = await ctx.db
    .query("mediaRelaySources")
    .withIndex("by_owner", (q) =>
      q.eq("owner.workerId", binding.workerId).gt("leaseExpiresAt", now),
    )
    .take(binding.maxSources + 1);
  const active = rows.length;
  if (renewing ? active > binding.maxSources : active >= binding.maxSources)
    throw Error("Relay worker capacity exhausted");
}
