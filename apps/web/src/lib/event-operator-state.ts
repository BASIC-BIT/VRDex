import type { OperatorStatus } from "../app/_components/event-operator-view";
import { eventBroadcastObservationFresh } from "./event-broadcast-observation";
export type OperatorSession = OperatorStatus["sessions"][number];
export type OperatorSource = OperatorStatus["sources"][number];
export function operatorViewState(
  status: OperatorStatus,
  elapsedMs: number,
  submitting = false,
  stopping = false,
) {
  const session = status.program?.activeSessionId
    ? status.sessions.find(
        (row) => row.sessionId === status.program?.activeSessionId,
      )
    : status.sessions.find((row) => ["ended", "error"].includes(row.status));
  const active = Boolean(
    session && !["ended", "error"].includes(session.status),
  );
  const stopPending = stopping || session?.status === "stopping";
  const observationFresh = eventBroadcastObservationFresh({
    serverNow: status.serverNow,
    elapsedMs,
    leaseExpiresAt: session?.leaseExpiresAt,
    observedAt: session?.programObservedAt,
    status: session?.status,
  });
  const encoded =
    observationFresh &&
    session?.observedOutputMs !== undefined &&
    (session.currentSourceId
      ? session.observedSourceRevision !== undefined &&
        session.observedSlotKey !== undefined
      : session.status === "hold");
  const sourceLabel = (id?: string, revision?: number) => {
    const source = status.sources.find((row) => row.sourceId === id);
    return source
      ? `${source.label}${revision === undefined ? "" : ` · r${revision}`}`
      : id
        ? `Unknown · ${id}${revision === undefined ? "" : ` · r${revision}`}`
        : "Slate";
  };
  const intent = session?.committedIntent;
  const pending = session?.pendingOperation;
  const canOperate = status.canControl && active && !stopPending;
  return {
    session,
    active,
    observationFresh,
    pending,
    actual: encoded
      ? sourceLabel(session?.currentSourceId, session?.observedSourceRevision)
      : "Unknown",
    desired:
      intent?.kind === "manual"
        ? sourceLabel(intent.sourceId, intent.revision)
        : intent?.kind === "automatic"
          ? "Automatic"
          : intent?.kind === "slate"
            ? "Slate"
            : "Unknown",
    pendingLabel:
      pending?.target?.kind === "source"
        ? sourceLabel(
            pending.target.source.sourceId,
            pending.target.source.revision,
          )
        : pending?.target?.kind === "slate"
          ? "Slate"
          : "None",
    canTake: canOperate && !submitting && !pending,
    canCancel: canOperate && pending?.phase === "preparing",
    canCut: canOperate,
    canStop: canOperate,
  };
}
export function resourceFresh(
  session: OperatorSession | undefined,
  now: number,
) {
  const resources = session?.resources;
  return Boolean(
    resources?.fresh &&
    resources.observedAt !== undefined &&
    now >= resources.observedAt &&
    now - resources.observedAt < resources.staleAfterMs,
  );
}
export function operatorStatusWindow(
  status: OperatorStatus,
  preview: OperatorSource | undefined,
  visible: readonly OperatorSource[],
) {
  const session = status.sessions.find(
    (row) => row.sessionId === status.program?.activeSessionId,
  );
  const current =
    status.sources.find((row) => row.sourceId === session?.currentSourceId) ??
    (status.currentSlot
      ? status.sources.find(
          (row) => row.eventSlotId === status.currentSlot?.slotId,
        )
      : undefined);
  const next = status.nextSlot
    ? status.sources.find((row) => row.eventSlotId === status.nextSlot?.slotId)
    : undefined;
  return [
    ...new Map(
      [current, next, preview, ...visible]
        .filter((row): row is OperatorSource =>
          Boolean(row?.input && row.publicUrl && row.hasPublicUrl),
        )
        .map((row) => [row.sourceId, row]),
    ).values(),
  ].slice(0, 4);
}
