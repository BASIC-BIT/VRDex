import { z } from "zod";
import {
  OwnershipLeaseSchema,
  SourceDescriptorSchema,
  SourceStateSchema,
  PackagerContinuitySchema,
  GatewayAuthorizationSchema,
} from "../contracts";
import type { RelayControl } from "../worker/registry";
import type { WorkerBinding } from "../worker/deployment";
import { boundedJson, deadline } from "./transport";
const envelope = z.discriminatedUnion("status", [
  z.object({ status: z.literal("success"), value: z.unknown() }),
  z.object({ status: z.literal("error") }),
]);
const discovery = z
  .array(
    z.strictObject({
      source: SourceDescriptorSchema,
      state: SourceStateSchema,
      admissionRevision: z.number().int().nonnegative(),
    }),
  )
  .max(1000);
const session = z.strictObject({
  recoveryStartedAt: z.number().nonnegative(),
  progressAt: z.number().nonnegative().optional(),
  continuity: PackagerContinuitySchema.optional(),
});
export function createControlRpc({
  url,
  credential,
  fetcher = fetch,
}: {
  url: string;
  credential: string;
  fetcher?: typeof fetch;
}) {
  const origin = new URL(url);
  if (origin.protocol !== "https:" || origin.origin !== url || !credential)
    throw Error("Invalid control configuration");
  return async (
    method: "query" | "mutation",
    name: string,
    args: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<unknown> => {
    const bounded = deadline(signal);
    bounded.throwIfAborted();
    try {
      const reply = envelope.parse(
        await boundedJson(
          await fetcher(`${url}/api/${method}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              path: `mediaRelayWorker:${name}`,
              args: { ...args, credential },
              format: "json",
            }),
            signal: bounded,
          }),
        ),
      );
      if (reply.status !== "success") throw Error("Control rejected");
      return reply.value;
    } catch {
      throw Error("Relay control unavailable");
    }
  };
}
export function createConvexControl(
  rpc: ReturnType<typeof createControlRpc>,
  binding: WorkerBinding,
): RelayControl {
  const identity = {
    workerId: binding.workerId,
    workerEpoch: binding.workerEpoch,
  };
  const owned = (lease: Parameters<RelayControl["renew"]>[0]) => ({
    ...identity,
    streamKey: lease.streamKey,
    epoch: lease.epoch,
  });
  return {
    async register(observation, signal) {
      await rpc("mutation", "registerWorker", { observation }, signal);
    },
    async list(signal) {
      return discovery.parse(
        await rpc("mutation", "listSources", identity, signal),
      );
    },
    async claim(source, signal) {
      return OwnershipLeaseSchema.parse(
        await rpc(
          "mutation",
          "claimSource",
          { ...identity, streamKey: source.streamKey },
          signal,
        ),
      );
    },
    async renew(lease, signal) {
      return OwnershipLeaseSchema.parse(
        await rpc("mutation", "renewSource", owned(lease), signal),
      );
    },
    async read(lease, signal) {
      return session.parse(
        await rpc("mutation", "readSource", owned(lease), signal),
      );
    },
    async observe({ lease, state, progressAt, terminalReason, signal }) {
      await rpc(
        "mutation",
        "observeSource",
        {
          ...owned(lease),
          state,
          progressAt,
          ...(terminalReason ? { terminalReason } : {}),
        },
        signal,
      );
    },
    async commitSnapshot({ lease, snapshot, objectKey, signal, isCurrent }) {
      signal.throwIfAborted();
      if (!isCurrent()) throw Error("Publication fenced");
      await rpc(
        "mutation",
        "commitSnapshot",
        { ...owned(lease), snapshot, objectKey },
        signal,
      );
    },
  };
}
export function gatewayAuthorization(rpc: ReturnType<typeof createControlRpc>) {
  return async ({
    grantId,
    rendition,
    signal,
  }: {
    grantId: string;
    rendition: "audio" | "video";
    signal: AbortSignal;
  }) =>
    GatewayAuthorizationSchema.parse(
      await rpc("query", "readGateway", { grantId, rendition }, signal),
    );
}
