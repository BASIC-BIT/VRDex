import type { Doc } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";

/** A handler returns this to keep its job running while a club operation completes, without spending an attempt. */
export const AwaitingClubOperation: unique symbol = Symbol("AwaitingClubOperation");
export const OPERATION_WAIT_MS = 30 * 60_000;

type Awaiting = typeof AwaitingClubOperation;
type Connector = Doc<"eventConnectors">;
type Job = Doc<"eventSyncJobs">;
type Link = Doc<"eventSyncLinks">;

// exportSeries joins this type with plan 11, once the eventSeries table exists.
export type SyncKindHandler = {
  // Every kind: link matches by date and title; import_item the rest when importing; export_upsert for unlinked upcoming VRDex events when exporting.
  reconcile?(ctx: ActionCtx, connector: Connector, job: Job): Promise<void | Awaiting>;
  // The runner, not the kind, writes the link's externalId, lastExportedAt, and lastExportedHash after success.
  exportUpsert?(ctx: ActionCtx, connector: Connector, event: Doc<"events">, link: Link | null, job: Job): Promise<{ externalId: string } | Awaiting>;
  exportDelete?(ctx: ActionCtx, connector: Connector, link: Link, job: Job): Promise<void | Awaiting>;
  importItem?(ctx: ActionCtx, connector: Connector, payload: unknown, job: Job): Promise<void | Awaiting>;
  importPoll?(ctx: ActionCtx, connector: Connector, job: Job): Promise<void | Awaiting>;
  boardRefresh?(ctx: ActionCtx, connector: Connector, job: Job): Promise<void | Awaiting>;
};
