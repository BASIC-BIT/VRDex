import { v, type Infer } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { workerSessionArgs } from "./_eventBroadcastInputs";
import { estimateComputeRate } from "../workers/restream/broadcast-rates.mjs";
import {
  RESOURCE_STALE_AFTER_MS,
  RESOURCE_REQUEST_ALLOWANCE_MS,
} from "../workers/restream/resource-policy.mjs";

/** Stored measurements are optional independently; absence means unknown. */
export const resourceSnapshotValidator = v.object({
  sampleSequence: v.number(),
  windowMs: v.number(),
  sampleAgeMs: v.number(),
  cpuUsagePercent: v.optional(v.number()),
  memoryUsedBytes: v.optional(v.number()),
});
export const computeRuntimeValidator = v.object({
  region: v.string(),
  os: v.literal("linux"),
  architecture: v.literal("x86_64"),
  purchaseModel: v.literal("on_demand"),
});
type ResourceSnapshot = Infer<typeof resourceSnapshotValidator>;
const requestValidator = v.object(workerSessionArgs);
const nonnegative = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;
function parseSnapshot(value: unknown): ResourceSnapshot | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return undefined;
  const allowed = new Set([
    "sampleSequence",
    "windowMs",
    "sampleAgeMs",
    "cpuUsagePercent",
    "memoryUsedBytes",
  ]);
  if (
    Object.keys(value).length > 5 ||
    Object.keys(value).some((key) => !allowed.has(key))
  )
    return undefined;
  if (
    !("sampleSequence" in value) ||
    !nonnegative(value.sampleSequence) ||
    !Number.isSafeInteger(value.sampleSequence) ||
    value.sampleSequence < 1 ||
    !("windowMs" in value) ||
    !nonnegative(value.windowMs) ||
    value.windowMs > 43_200_000 ||
    !("sampleAgeMs" in value) ||
    !nonnegative(value.sampleAgeMs) ||
    value.sampleAgeMs + RESOURCE_REQUEST_ALLOWANCE_MS >= RESOURCE_STALE_AFTER_MS
  )
    return undefined;
  const cpuUsagePercent =
    "cpuUsagePercent" in value ? value.cpuUsagePercent : undefined;
  const memoryUsedBytes =
    "memoryUsedBytes" in value ? value.memoryUsedBytes : undefined;
  if (
    cpuUsagePercent !== undefined &&
    (!nonnegative(cpuUsagePercent) || value.windowMs === 0)
  )
    return undefined;
  if (
    memoryUsedBytes !== undefined &&
    (!nonnegative(memoryUsedBytes) || !Number.isSafeInteger(memoryUsedBytes))
  )
    return undefined;
  if (cpuUsagePercent === undefined && memoryUsedBytes === undefined)
    return undefined;
  return {
    sampleSequence: value.sampleSequence,
    windowMs: value.windowMs,
    sampleAgeMs: value.sampleAgeMs,
    ...(cpuUsagePercent === undefined ? {} : { cpuUsagePercent }),
    ...(memoryUsedBytes === undefined ? {} : { memoryUsedBytes }),
  };
}
/** Called only after renewal authentication. Invalid optional telemetry is a
 * no-op, never a lease/control result. Ownership is checked independently before
 * the single latest-only patch; heartbeat time cannot refresh resource time.
 */
export async function recordResourceSnapshot(
  ctx: MutationCtx,
  args: Infer<typeof requestValidator> & { sample: unknown },
) {
  const sample = parseSnapshot(args.sample);
  if (!sample) return;
  const now = Date.now(),
    session = await ctx.db.get(args.sessionId);
  if (
    !session ||
    session.eventId !== args.eventId ||
    session.workerId !== args.workerId ||
    session.epoch !== args.epoch ||
    (session.leaseExpiresAt ?? 0) <= now ||
    ["ended", "error"].includes(session.status) ||
    sample.sampleSequence <= (session.resourceSnapshot?.sampleSequence ?? 0)
  )
    return;
  const [event, program] = await Promise.all([
    ctx.db.get(args.eventId),
    ctx.db.get(session.programId),
  ]);
  if (
    !event ||
    !program ||
    program.eventId !== event._id ||
    program.activeSessionId !== session._id
  )
    return;
  const resourceObservedAt =
    now - sample.sampleAgeMs - RESOURCE_REQUEST_ALLOWANCE_MS;
  if (resourceObservedAt < (session.resourceObservedAt ?? -Infinity)) return;
  await ctx.db.patch(session._id, {
    resourceSnapshot: sample,
    resourceObservedAt,
  });
}
/** Dispatch-owned provenance is valid only for the same actual task/definition
 * region and account. The bridge supplies enums from its explicit launch path.
 */
export function trustedComputeRuntime(
  runtime: Infer<typeof computeRuntimeValidator> | undefined,
  taskArn: string,
  definitionArn: string,
) {
  const task = /^arn:aws:ecs:([a-z0-9-]+):(\d{12}):task\/[A-Za-z0-9_/-]+$/.exec(
    taskArn,
  );
  const definition =
    /^arn:aws:ecs:([a-z0-9-]+):(\d{12}):task-definition\/[A-Za-z0-9_-]+:\d+$/.exec(
      definitionArn,
    );
  return runtime &&
    task &&
    definition &&
    task[1] === runtime.region &&
    definition[1] === runtime.region &&
    task[2] === definition[2]
    ? runtime
    : undefined;
}
/** Authorized console projection only; Task 8 ages observedAt from serverNow
 * plus local monotonic elapsed time without adding frontend polling.
 */
export function projectSessionResources(
  session: Doc<"eventMediaSessions">,
  now: number,
) {
  const sample = session.resourceSnapshot,
    observedAt = session.resourceObservedAt;
  const ageMs =
    observedAt === undefined ? undefined : Math.max(0, now - observedAt);
  const fresh =
    !!sample && ageMs !== undefined && ageMs < RESOURCE_STALE_AFTER_MS;
  return {
    allocation: session.allocation,
    provider: session.workerProvider,
    region: session.computeRuntime?.region,
    activeFormats: session.destinationProfiles ?? [],
    computeRuntime: session.computeRuntime,
    computeEstimate: session.computeRuntime
      ? estimateComputeRate({
          ...session.computeRuntime,
          allocation: session.allocation,
        })
      : undefined,
    observedAt,
    sampleAgeMs: ageMs,
    sampleSequence: sample?.sampleSequence,
    windowMs: sample?.windowMs,
    staleAfterMs: RESOURCE_STALE_AFTER_MS,
    fresh,
    cpuUsagePercent: fresh ? sample?.cpuUsagePercent : undefined,
    memoryUsedBytes: fresh ? sample?.memoryUsedBytes : undefined,
  };
}
