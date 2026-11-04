import type { Doc } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";

/** A handler returns this to keep its job running while a club operation completes, without spending an attempt. */
export const AwaitingClubOperation: unique symbol = Symbol("AwaitingClubOperation");
export const OPERATION_WAIT_MS = 30 * 60_000;

type Awaiting = typeof AwaitingClubOperation;
type Connector = Doc<"eventConnectors">;
type Job = Doc<"eventSyncJobs">;
type Link = Doc<"eventSyncLinks">;

/** `unchanged`: the kind wrote nothing and left the existing link as it was, so the runner writes nothing to it either. Only series paths send it. */
export type ExportResult = { externalId: string; unchanged?: true };

export type SyncKindHandler = {
  // Every kind: link matches by date and title; import_item the rest when importing; export_upsert for unlinked upcoming VRDex events when exporting.
  reconcile?(ctx: ActionCtx, connector: Connector, job: Job): Promise<void | Awaiting>;
  // The runner, not the kind, writes the link's externalId, lastExportedAt, and lastExportedHash after success. `exportedHash` is the hash it will write.
  exportUpsert?(ctx: ActionCtx, connector: Connector, event: Doc<"events">, link: Link | null, job: Job, exportedHash: string): Promise<ExportResult | Awaiting>;
  // A series export_upsert: one master or scheduled event for the whole series. `link` is the series link; the runner writes it, as for exportUpsert.
  exportSeries?(ctx: ActionCtx, connector: Connector, series: Doc<"eventSeries">, link: Link | null, job: Job): Promise<ExportResult>;
  exportDelete?(ctx: ActionCtx, connector: Connector, link: Link, job: Job): Promise<void | Awaiting>;
  importItem?(ctx: ActionCtx, connector: Connector, payload: unknown, job: Job): Promise<void | Awaiting>;
  importPoll?(ctx: ActionCtx, connector: Connector, job: Job): Promise<void | Awaiting>;
  boardRefresh?(ctx: ActionCtx, connector: Connector, job: Job): Promise<void | Awaiting>;
};
