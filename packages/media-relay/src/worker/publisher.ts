import { RELAY_POLICY } from "../policy";
import { join } from "node:path";
import {
  OwnershipLeaseSchema,
  RenditionSnapshotSchema,
  PublishedSnapshotSchema,
  snapshotObjectKey,
  type OwnershipLease,
  type RenditionSnapshot,
} from "../contracts";

export type PublicationCommit = (args: {
  lease: OwnershipLease;
  snapshot: RenditionSnapshot;
  objectKey: string;
  signal: AbortSignal;
  isCurrent: () => boolean;
}) => Promise<void>;
/** Implementations must honor signal; snapshot objects are immutable, never the current pointer. */
export type RelayStorage = {
  putSegment(args: {
    objectKey: string;
    filePath: string;
    signal: AbortSignal;
    retireAfterMs: number;
  }): Promise<void>;
  putSnapshot(args: {
    objectKey: string;
    snapshot: RenditionSnapshot;
    signal: AbortSignal;
    retireAfterMs: number;
  }): Promise<void>;
  /** Bounded server-side listing/deletion; delete only objects older than before. */
  retire(args: {
    before: number;
    limit: number;
    signal: AbortSignal;
  }): Promise<void>;
};
export type PublishOptions = {
  lease: OwnershipLease;
  snapshot: RenditionSnapshot;
  segments: { directory: string };
  signal: AbortSignal;
};

/** Two fixed rendition lanes. A timed-out physical call retains its slot until settled. */
export function createPublisher({
  storage,
  commitSnapshot,
  isCurrent,
  limits = { maxPending: 2, operationTimeoutMs: 5000 },
}: {
  storage: RelayStorage;
  commitSnapshot: PublicationCommit;
  isCurrent: (lease: OwnershipLease) => boolean;
  limits?: { maxPending: number; operationTimeoutMs: number };
}) {
  if (
    !Number.isSafeInteger(limits.maxPending) ||
    limits.maxPending < 1 ||
    !Number.isFinite(limits.operationTimeoutMs) ||
    limits.operationTimeoutMs <= 0
  )
    throw Error("Invalid publication limits");
  const lanes = {
    video: { pending: 0, tail: Promise.resolve(), last: -1 },
    audio: { pending: 0, tail: Promise.resolve(), last: -1 },
  };
  return {
    isIdle: () => lanes.video.pending === 0 && lanes.audio.pending === 0,
    publishSnapshot(args: PublishOptions): Promise<void> {
      const lane = lanes[args.snapshot.rendition];
      if (!lane) return Promise.reject(Error("Invalid rendition"));
      if (lane.pending >= limits.maxPending)
        return Promise.reject(Error("Publication queue full"));
      lane.pending++;
      const abort = new AbortController();
      const onAbort = () => abort.abort(args.signal.reason);
      args.signal.addEventListener("abort", onAbort, { once: true });
      if (args.signal.aborted) onAbort();
      const timer = setTimeout(
        () => abort.abort(Error("Publication timed out")),
        limits.operationTimeoutMs,
      );
      const check = () => {
        abort.signal.throwIfAborted();
        if (!isCurrent(args.lease)) throw Error("Publication fenced");
      };
      const physical = lane.tail.then(async () => {
        check();
        const lease = OwnershipLeaseSchema.parse(args.lease),
          local = RenditionSnapshotSchema.parse(args.snapshot);
        if (local.epoch !== lease.epoch || local.streamKey !== lease.streamKey)
          throw Error("Publication lease mismatch");
        const last = local.segments.at(-1);
        if (!last || last.sequence <= lane.last)
          throw Error("Snapshot out of order");
        const prefix = `${lease.streamKey}/epochs/${lease.epoch}/`;
        const snapshot = PublishedSnapshotSchema.parse({
          ...local,
          segments: local.segments.map((s) => ({
            ...s,
            objectKey: prefix + s.objectKey,
          })),
        });
        // Reserve monotonically before any remote operation, including uncertain commits.
        lane.last = last.sequence;
        for (const segment of local.segments) {
          check();
          await storage.putSegment({
            objectKey: prefix + segment.objectKey,
            filePath: join(args.segments.directory, segment.objectKey),
            signal: abort.signal,
            retireAfterMs: RELAY_POLICY.objectRetentionMs,
          });
        }
        check();
        const objectKey = snapshotObjectKey(snapshot);
        await storage.putSnapshot({
          objectKey,
          snapshot,
          signal: abort.signal,
          retireAfterMs: RELAY_POLICY.objectRetentionMs,
        });
        check();
        await commitSnapshot({
          lease,
          snapshot,
          objectKey,
          signal: abort.signal,
          isCurrent: () => !abort.signal.aborted && isCurrent(lease),
        });
        check();
      });
      lane.tail = physical
        .catch(() => {})
        .finally(() => {
          lane.pending--;
        });
      let remove = () => {};
      const cancelled = new Promise<never>((_resolve, reject) => {
        const listener = () =>
          reject(abort.signal.reason ?? Error("Publication aborted"));
        remove = () => abort.signal.removeEventListener("abort", listener);
        abort.signal.addEventListener("abort", listener, { once: true });
        if (abort.signal.aborted) listener();
      });
      return Promise.race([physical, cancelled]).finally(() => {
        clearTimeout(timer);
        args.signal.removeEventListener("abort", onAbort);
        remove();
      });
    },
  };
}
