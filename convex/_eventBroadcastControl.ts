import type { Doc, Id } from "./_generated/dataModel";
import type { DatabaseReader, DatabaseWriter } from "./_generated/server";
import type { AuthSubject } from "./_communityAuthority";
import type {
  CommittedIntent,
  ControlTarget,
  ControlResult,
  SanitizedEventMediaCommand,
} from "./_eventMediaControl";
import { allocateSessionCommandSequence } from "./_eventBroadcastInputs";
import {
  canManageEventMedia,
  eventMediaSourceProjectionAvailable,
} from "./_eventBroadcastAuthority";
import { eventMediaSourceWorkerDescriptor } from "./_eventBroadcastSources";
import { eventOutputIsAuthorized } from "./_eventOutputSetup";

type Session = Doc<"eventMediaSessions">;
type Command = Doc<"eventMediaCommands">;
export type ControlRequest = {
  eventId: Id<"events">;
  sessionId: Id<"eventMediaSessions">;
  workerId: string;
  epoch: number;
  protocolVersion?: number;
};
export const isControl = (type: string) =>
  [
    "switch_source",
    "switch_next",
    "switch_previous",
    "next_slot",
    "previous_slot",
    "hold_current",
    "switch_hold",
    "show_hold_scene",
    "set_automatic_mode",
  ].includes(type);
export const isCut = (type: string) =>
  type === "switch_hold" || type === "show_hold_scene";
export function assertWorkerProtocol(
  session: Session,
  args: { protocolVersion?: number },
) {
  if (session.controlProtocolVersion === 2 && args.protocolVersion !== 2)
    throw Error("Worker control protocol 2 is required.");
}
export const intentForTarget = (target: ControlTarget): CommittedIntent =>
  target.mode === "automatic"
    ? { kind: "automatic" }
    : target.kind === "slate"
      ? { kind: "slate" }
      : {
          kind: "manual",
          sourceId: target.source.sourceId,
          revision: target.source.revision,
        };
const stopped = (s: Session) =>
  s.stopRequestedAt !== undefined ||
  ["stopping", "ended", "error"].includes(s.status);
function requireControllable(session: Session | null, event: Doc<"events">) {
  if (!session || session.controlProtocolVersion !== 2)
    throw Error("An active protocol 2 session is required.");
  if (stopped(session) || event.eventStatus !== "scheduled")
    throw Error("Session is stopped or stopping.");
}
export async function availableSource(
  db: DatabaseReader,
  session: Pick<Session, "eventId" | "programId">,
  target: ControlTarget,
) {
  if (target.kind === "slate") return true;
  if (
    !Number.isSafeInteger(target.source.revision) ||
    target.source.revision < 1
  )
    return false;
  const source = await db.get(target.source.sourceId);
  if (
    !source ||
    source.eventId !== session.eventId ||
    source.programId !== session.programId ||
    source.state === "disabled" ||
    source.projectionAvailable === false ||
    (source.revision ?? 1) !== target.source.revision ||
    !eventMediaSourceWorkerDescriptor(source)
  )
    return false;
  const key = source.eventSlotId ?? `manual-${source._id}`;
  if (target.source.slotKey !== key) return false;
  if (source.eventSlotId) {
    const slot = await db.get(source.eventSlotId);
    if (!slot || slot.eventId !== session.eventId) return false;
  }
  return eventMediaSourceProjectionAvailable(db, source);
}

function sourceTarget(
  source: Doc<"eventMediaSources">,
  mode: "manual" | "automatic",
): ControlTarget {
  return {
    kind: "source",
    mode,
    source: {
      sourceId: source._id,
      revision: source.revision ?? 1,
      slotKey: source.eventSlotId ?? `manual-${source._id}`,
    },
  };
}

async function sourceForSlot(
  db: DatabaseReader,
  session: Session,
  slot: Doc<"eventSlots">,
) {
  // Match configuration's projection/manual distinction. A detached profile
  // projection must not hide the separate, authored manual source for a slot.
  const source = slot.personProfileId
    ? await db
        .query("eventMediaSources")
        .withIndex("by_programId_key", (q) =>
          q.eq("programId", session.programId).eq("key", `slot-${slot._id}`),
        )
        .first()
    : (
        await db
          .query("eventMediaSources")
          .withIndex("by_programId_eventSlotId", (q) =>
            q.eq("programId", session.programId).eq("eventSlotId", slot._id),
          )
          .take(65)
      ).find(
        (s) =>
          !s.profileProjection &&
          !(s.sourceProfileId && s.key === `slot-${slot._id}`) &&
          s.state !== "disabled" &&
          s.projectionAvailable !== false,
      );
  return source &&
    (await availableSource(db, session, sourceTarget(source, "automatic")))
    ? source
    : null;
}
export async function resolveControlTarget(
  db: DatabaseReader,
  session: Session,
  command: SanitizedEventMediaCommand,
): Promise<ControlTarget> {
  if (isCut(command.type)) {
    if (command.targetSceneKey) {
      const scene = await db
        .query("eventMediaScenes")
        .withIndex("by_programId_key", (q) =>
          q
            .eq("programId", session.programId)
            .eq("key", command.targetSceneKey!),
        )
        .unique();
      if (!scene || scene.type !== "hold_slate" || scene.sourceId)
        throw Error("Hold scene is unavailable.");
    }
    return { kind: "slate", mode: "slate" };
  }
  let source: Doc<"eventMediaSources"> | null = null;
  if (command.type === "switch_source")
    source = await db
      .query("eventMediaSources")
      .withIndex("by_programId_key", (q) =>
        q
          .eq("programId", session.programId)
          .eq("key", command.targetSourceKey!),
      )
      .unique();
  else if (command.type === "hold_current")
    source = session.currentSourceId
      ? await db.get(session.currentSourceId)
      : null;
  else {
    const slots = await db
      .query("eventSlots")
      .withIndex("by_eventId_startAt", (q) => q.eq("eventId", session.eventId))
      .take(65);
    if (slots.length > 64) throw Error("Event schedule exceeds worker limits.");
    const now = Date.now();
    const currentIndex = slots.findIndex(
      (s) => s._id === session.observedSlotKey,
    );
    if (
      command.type === "set_automatic_mode" ||
      (currentIndex < 0 &&
        !["switch_previous", "previous_slot"].includes(command.type))
    ) {
      const active = slots.filter(
        (s, i) =>
          s.startAt <= now &&
          now < (s.endAt ?? slots[i + 1]?.startAt ?? Infinity),
      );
      if (active.length === 1)
        source = await sourceForSlot(db, session, active[0]);
      if (command.type === "set_automatic_mode" && !source)
        return { kind: "slate", mode: "automatic" };
      if (!source)
        for (const future of slots.filter((s) => s.startAt > now)) {
          source = await sourceForSlot(db, session, future);
          if (source) break;
        }
    } else {
      const previous = ["switch_previous", "previous_slot"].includes(
        command.type,
      );
      const slot = slots[currentIndex + (previous ? -1 : 1)];
      if (slot) source = await sourceForSlot(db, session, slot);
    }
  }
  if (!source && command.type === "hold_current")
    return { kind: "slate", mode: "slate" };
  if (!source) throw Error("Event media source is unavailable.");
  const target = sourceTarget(
    source,
    command.type === "set_automatic_mode" ? "automatic" : "manual",
  );
  if (!(await availableSource(db, session, target)))
    throw Error("Event media source is unavailable.");
  if (
    command.type === "hold_current" &&
    session.observedSourceRevision !== (source.revision ?? 1)
  )
    throw Error("Observed source revision is unavailable.");
  return target;
}
const actorKey = (actor: AuthSubject) =>
  JSON.stringify([actor.issuer, actor.subject]);
export async function findControlRequest(
  db: DatabaseReader,
  session: Pick<Session, "eventId"> & { _id?: Id<"eventMediaSessions"> },
  actor: AuthSubject,
  key: string,
  payload: string,
) {
  if (!key.trim() || key.length > 128 || key !== key.trim())
    throw Error("Invalid idempotency key.");
  const receipt = await db
    .query("eventMediaControlRequests")
    .withIndex("by_scope_key", (q) =>
      q
        .eq("eventId", session.eventId)
        .eq("sessionId", session._id)
        .eq("actorKey", actorKey(actor))
        .eq("key", key),
    )
    .unique();
  if (receipt && receipt.payload !== payload)
    throw Error("Idempotency key was used for a different payload.");
  return receipt;
}
export async function recordControlRequest(
  db: DatabaseWriter,
  session: Pick<Session, "eventId"> & { _id?: Id<"eventMediaSessions"> },
  actor: AuthSubject,
  key: string,
  payload: string,
  commandId: Id<"eventMediaCommands">,
) {
  await db.insert("eventMediaControlRequests", {
    eventId: session.eventId,
    sessionId: session._id,
    actorKey: actorKey(actor),
    key,
    payload,
    commandId,
    createdAt: Date.now(),
  });
}
export async function settleControl(
  db: DatabaseWriter,
  session: Session,
  command: Command,
  result: Exclude<ControlResult, { kind: "fenced" } | { kind: "ok" }>,
) {
  const now = Date.now();
  await db.patch(command._id, {
    status: result.kind === "failed" ? "failed" : "cancelled",
    controlOutcome: result.kind,
    controlFailure: result.kind === "failed" ? result.reason : undefined,
    completedAt: now,
    updatedAt: now,
  });
  await db.insert("eventMediaAuditEvents", {
    programId: session.programId,
    eventId: session.eventId,
    sessionId: session._id,
    commandId: command._id,
    actor: command.actor,
    actorSurface: "system",
    action: `control_${result.kind}`,
    privateSummary: result.kind === "failed" ? result.reason : undefined,
    createdAt: now,
  });
  if (session.pendingControlCommandId === command._id)
    await db.patch(session._id, {
      pendingControlCommandId: undefined,
      updatedAt: now,
    });
  return result;
}
export async function supersedePending(db: DatabaseWriter, session: Session) {
  const c = session.pendingControlCommandId
    ? await db.get(session.pendingControlCommandId)
    : null;
  if (c && ["queued", "claimed"].includes(c.status))
    await settleControl(db, session, c, { kind: "superseded" });
  else if (session.pendingControlCommandId)
    await db.patch(session._id, { pendingControlCommandId: undefined });
}
export async function admitControlOperation(
  db: DatabaseWriter,
  event: Doc<"events">,
  session: Session | null,
  actor: AuthSubject,
  key: string,
  command: SanitizedEventMediaCommand,
) {
  requireControllable(session, event);
  const s = session!;
  if ((await db.get(s.programId))?.activeSessionId !== s._id)
    throw Error("An active protocol 2 session is required.");
  const payload = JSON.stringify(command);
  const retry = await findControlRequest(db, s, actor, key, payload);
  if (retry) return (await db.get(retry.commandId))!;
  if (s.pendingControlCommandId && !isCut(command.type))
    throw Error("An operation is already pending.");
  const target = await resolveControlTarget(db, s, command);
  const sequence = (await allocateSessionCommandSequence(db, s._id))!;
  const now = Date.now();
  if (isCut(command.type)) await supersedePending(db, s);
  const commandId = await db.insert("eventMediaCommands", {
    programId: s.programId,
    eventId: s.eventId,
    sessionId: s._id,
    sequence,
    commandType: command.type,
    status: "queued",
    actor,
    actorSurface: "web",
    idempotencyKey: key,
    targetSourceKey: command.targetSourceKey,
    targetSourceId:
      target.kind === "source" ? target.source.sourceId : undefined,
    targetSceneKey: command.targetSceneKey,
    publicFallbackLinks: command.publicFallbackLinks,
    note: command.note,
    controlTarget: target,
    priorIntent: s.committedIntent ?? { kind: "automatic" },
    priorIntentSequence: s.intentSequence ?? 0,
    controlPhase: isCut(command.type) ? "promoting" : "preparing",
    availableAt: now,
    createdAt: now,
    updatedAt: now,
  });
  await db.patch(s._id, {
    pendingControlCommandId: commandId,
    ...(isCut(command.type)
      ? {
          committedIntent: { kind: "slate" } as const,
          intentSequence: sequence,
        }
      : {}),
    updatedAt: now,
  });
  await recordControlRequest(db, s, actor, key, payload, commandId);
  await db.insert("eventMediaAuditEvents", {
    programId: s.programId,
    eventId: s.eventId,
    sessionId: s._id,
    commandId,
    actor,
    actorSurface: "web",
    action: isCut(command.type) ? "control_cut_committed" : "control_admitted",
    createdAt: now,
  });
  return (await db.get(commandId))!;
}
export async function cancelControlOperation(
  db: DatabaseWriter,
  event: Doc<"events">,
  session: Session,
  actor: AuthSubject,
  key: string,
  commandId: Id<"eventMediaCommands">,
): Promise<ControlResult> {
  requireControllable(session, event);
  const payload = JSON.stringify({ cancel: commandId });
  if (await findControlRequest(db, session, actor, key, payload))
    return { kind: "cancelled" };
  const c = await db.get(commandId);
  if (
    !c ||
    c.sessionId !== session._id ||
    c.eventId !== event._id ||
    !c.controlTarget
  )
    throw Error("Operation was not found.");
  if (
    c.controlOutcome !== "cancelled" &&
    (c.controlPhase !== "preparing" ||
      session.pendingControlCommandId !== c._id)
  )
    throw Error("Only a preparing operation can be cancelled.");
  if (c.controlOutcome !== "cancelled")
    await settleControl(db, session, c, { kind: "cancelled" });
  await recordControlRequest(db, session, actor, key, payload, c._id);
  return { kind: "cancelled" };
}
export async function controlFence(
  db: DatabaseReader,
  args: ControlRequest,
  allowTerminal = false,
): Promise<
  | {
      session: Session;
      event: Doc<"events">;
      program: Doc<"eventMediaPrograms">;
    }
  | { result: ControlResult }
> {
  const s = await db.get(args.sessionId);
  if (s) assertWorkerProtocol(s, args);
  if (
    !s ||
    s.eventId !== args.eventId ||
    s.workerId !== args.workerId ||
    s.epoch !== args.epoch ||
    (s.leaseExpiresAt ?? 0) <= Date.now()
  )
    return { result: { kind: "fenced", reason: "lease" } };
  const [event, program] = await Promise.all([
    db.get(s.eventId),
    db.get(s.programId),
  ]);
  if (!event || !program || program.activeSessionId !== s._id)
    return { result: { kind: "fenced", reason: "lease" } };
  if (!allowTerminal && (stopped(s) || event.eventStatus !== "scheduled"))
    return { result: { kind: "fenced", reason: "stopped" } };
  if (!allowTerminal && s.outputId) {
    const output = await db.get(s.outputId);
    if (
      !output ||
      output.programId !== s.programId ||
      !["ready", "active"].includes(output.state) ||
      !eventOutputIsAuthorized(event, output)
    )
      return { result: { kind: "fenced", reason: "destination" } };
  }
  return { session: s, event, program };
}
function settled(c: Command): ControlResult | undefined {
  if (c.controlOutcome === "failed")
    return { kind: "failed", reason: c.controlFailure! };
  if (c.controlOutcome === "cancelled" || c.controlOutcome === "superseded")
    return { kind: c.controlOutcome };
  return undefined;
}
async function loadOperation(
  db: DatabaseWriter,
  args: ControlRequest & {
    commandId: Id<"eventMediaCommands">;
    sequence: number;
  },
) {
  const found = await controlFence(db, args);
  if ("result" in found) return found;
  const c = await db.get(args.commandId);
  if (
    !c ||
    c.sessionId !== args.sessionId ||
    c.eventId !== args.eventId ||
    c.programId !== found.session.programId ||
    c.sequence !== args.sequence ||
    !c.controlTarget
  )
    return { result: { kind: "superseded" } as ControlResult };
  // A completed receipt cannot regain permission after a newer committed intent.
  if (
    c.controlPhase === "promoting" &&
    found.session.intentSequence !== c.sequence
  )
    return { result: { kind: "superseded" } as ControlResult };
  const result = settled(c);
  if (result) return { result };
  return { ...found, command: c };
}
async function checkPreparation(
  db: DatabaseWriter,
  session: Session,
  command: Command,
  event: Doc<"events">,
): Promise<ControlResult | undefined> {
  if (
    command.preparationExpiresAt !== undefined &&
    command.preparationExpiresAt <= Date.now()
  )
    return settleControl(db, session, command, {
      kind: "failed",
      reason: "expired",
    });
  if (command.controlPhase === "preparing") {
    const user = command.actor
      ? await db
          .query("users")
          .withIndex("clerkUserId", (q) =>
            q.eq("clerkUserId", command.actor!.subject),
          )
          .unique()
      : null;
    if (
      !command.actor ||
      !(await canManageEventMedia(db, event, command.actor, user?._id))
    )
      return settleControl(db, session, command, {
        kind: "failed",
        reason: "actor_revoked",
      });
    if (session.intentSequence !== command.priorIntentSequence)
      return settleControl(db, session, command, { kind: "superseded" });
  }
  if (!(await availableSource(db, session, command.controlTarget!)))
    return settleControl(db, session, command, {
      kind: "failed",
      reason: "source_unavailable",
    });
}
export async function beginControlPreparation(
  db: DatabaseWriter,
  args: ControlRequest & {
    commandId: Id<"eventMediaCommands">;
    sequence: number;
  },
): Promise<ControlResult> {
  const found = await loadOperation(db, args);
  if ("result" in found) return found.result;
  const { session, command, event } = found;
  if (session.pendingControlCommandId !== command._id)
    return { kind: "superseded" };
  const failed = await checkPreparation(db, session, command, event);
  if (failed) return failed;
  const preparationExpiresAt =
    command.preparationExpiresAt ?? Date.now() + 15000;
  await db.patch(command._id, {
    preparationExpiresAt,
    status: "claimed",
    claimedByWorkerId: args.workerId,
    claimedEpoch: args.epoch,
    updatedAt: Date.now(),
  });
  return {
    kind: "ok",
    intentSequence: session.intentSequence,
    preparationExpiresAt,
  };
}
export async function promoteControlOperation(
  db: DatabaseWriter,
  args: ControlRequest & {
    commandId: Id<"eventMediaCommands">;
    sequence: number;
    target: ControlTarget;
  },
): Promise<ControlResult> {
  const found = await loadOperation(db, args);
  if ("result" in found) return found.result;
  const { session, command, event } = found;
  if (
    session.pendingControlCommandId !== command._id ||
    !sameTarget(args.target, command.controlTarget!)
  )
    return { kind: "superseded" };
  if (command.preparationExpiresAt === undefined)
    throw Error("Preparation has not begun.");
  const failed = await checkPreparation(db, session, command, event);
  if (failed) return failed;
  if (command.controlPhase === "preparing") {
    await db.patch(command._id, {
      controlPhase: "promoting",
      updatedAt: Date.now(),
    });
    await db.patch(session._id, {
      committedIntent: intentForTarget(command.controlTarget!),
      intentSequence: command.sequence,
      updatedAt: Date.now(),
    });
  }
  return {
    kind: "ok",
    intentSequence: command.sequence,
    preparationExpiresAt: command.preparationExpiresAt,
  };
}
function sameTarget(a: ControlTarget, b: ControlTarget) {
  return (
    a.kind === b.kind &&
    a.mode === b.mode &&
    (a.kind === "slate" ||
      (b.kind === "source" &&
        a.source.sourceId === b.source.sourceId &&
        a.source.revision === b.source.revision &&
        a.source.slotKey === b.source.slotKey))
  );
}
// Policy mode is independent of rendered slate (automatic gaps/manual fallback).
export const broadcastModeForIntent = (intent: Session["committedIntent"]) =>
  intent?.kind === "slate" ? "hold" : intent?.kind;

export type RenderedEvidence = {
  mode?: Session["broadcastMode"];
  intentSequence?: number;
  outputMs?: number;
  sourceId?: Id<"eventMediaSources"> | null;
  sourceRevision?: number;
  slotKey?: string;
  outputId?: Id<"eventMediaOutputs"> | null;
  state?: string;
};
export async function coherentEvidence(
  db: DatabaseReader,
  session: Session,
  e: RenderedEvidence,
  target?: ControlTarget,
) {
  if (!["live", "hold", "fallback"].includes(e.state ?? "")) return false;
  if (
    e.outputMs === session.observedOutputMs &&
    ((e.sourceId !== session.currentSourceId &&
      !(e.sourceId == null && session.currentSourceId === undefined)) ||
      e.sourceRevision !== session.observedSourceRevision ||
      e.slotKey !== session.observedSlotKey)
  )
    return false;
  if (
    !Number.isSafeInteger(e.intentSequence) ||
    e.intentSequence !== session.intentSequence ||
    !Number.isFinite(e.outputMs) ||
    e.outputMs! <= 0 ||
    e.outputMs! < (session.observedOutputMs ?? 0) ||
    e.outputId !== session.outputId
  )
    return false;
  if (e.sourceId) {
    if (e.state !== "live" || e.sourceRevision === undefined || !e.slotKey)
      return false;
    const actual: ControlTarget = {
      kind: "source",
      mode: "manual",
      source: {
        sourceId: e.sourceId,
        revision: e.sourceRevision,
        slotKey: e.slotKey,
      },
    };
    if (!(await availableSource(db, session, actual))) return false;
    if (session.committedIntent?.kind === "slate") return false;
    if (
      session.committedIntent?.kind === "manual" &&
      (session.committedIntent.sourceId !== e.sourceId ||
        session.committedIntent.revision !== e.sourceRevision)
    )
      return false;
    if (
      target &&
      (target.kind !== "source" ||
        !sameTarget(
          { ...actual, mode: target.mode as "manual" | "automatic" },
          target,
        ))
    )
      return false;
  } else if (
    e.sourceRevision !== undefined ||
    e.slotKey !== undefined ||
    e.state === "live" ||
    target?.kind === "source"
  )
    return false;
  const mode = broadcastModeForIntent(session.committedIntent);
  return mode !== undefined && (e.mode === undefined || e.mode === mode);
}
export async function writeControlObservation(
  db: DatabaseWriter,
  session: Session,
  e: RenderedEvidence,
) {
  const now = Date.now();
  const state = e.state as "live" | "hold" | "fallback";
  await db.patch(session._id, {
    broadcastMode: broadcastModeForIntent(session.committedIntent),
    currentSourceId: e.sourceId ?? undefined,
    observedSourceRevision: e.sourceRevision,
    observedSlotKey: e.slotKey,
    observedOutputMs: e.outputMs,
    programObservedAt: now,
    status: state,
    health: { lastHeartbeatAt: now },
    updatedAt: now,
  });
  await db.patch(session.programId, {
    currentSourceId: e.sourceId ?? undefined,
    currentOutputId: session.outputId,
    state,
    updatedAt: now,
  });
  if (session.outputId && ["live", "hold"].includes(state)) {
    const output = await db.get(session.outputId);
    if (output?.state !== "active")
      await db.patch(session.outputId, { state: "active", updatedAt: now });
  }
}
export async function completeControlOperation(
  db: DatabaseWriter,
  args: ControlRequest & {
    commandId: Id<"eventMediaCommands">;
    sequence: number;
    outcome: "succeeded" | "failed";
    failureReason?: "expired" | "source_unavailable" | "actor_revoked";
  },
  e: RenderedEvidence,
): Promise<ControlResult> {
  const found = await loadOperation(db, args);
  if ("result" in found) return found.result;
  const { session, command } = found;
  const payload = JSON.stringify([
    args.outcome,
    args.failureReason ?? null,
    e.intentSequence ?? null,
    e.outputMs ?? null,
    e.sourceId ?? null,
    e.sourceRevision ?? null,
    e.slotKey ?? null,
    e.outputId ?? null,
    e.state ?? null,
  ]);
  if (command.controlOutcome === "ok")
    return command.completionPayload === payload
      ? { kind: "ok", duplicate: true }
      : { kind: "superseded" };
  if (session.pendingControlCommandId !== command._id)
    return { kind: "superseded" };
  if (
    command.preparationExpiresAt !== undefined &&
    command.preparationExpiresAt <= Date.now()
  )
    return settleControl(db, session, command, {
      kind: "failed",
      reason: "expired",
    });
  if (args.outcome === "failed")
    return settleControl(db, session, command, {
      kind: "failed",
      reason: args.failureReason ?? "source_unavailable",
    });
  if (
    command.controlPhase !== "promoting" ||
    command.preparationExpiresAt === undefined ||
    !(await coherentEvidence(db, session, e, command.controlTarget))
  )
    return { kind: "superseded" };
  await writeControlObservation(db, session, e);
  await db.patch(command._id, {
    status: "succeeded",
    controlOutcome: "ok",
    completionPayload: payload,
    acknowledgedEpoch: args.epoch,
    observedSourceId: e.sourceId ?? null,
    observedOutputId: e.outputId,
    observedState: e.state as "live" | "hold" | "fallback",
    completedAt: Date.now(),
    updatedAt: Date.now(),
  });
  await db.patch(session._id, {
    pendingControlCommandId: undefined,
    lastAcknowledgedSequence: Math.max(
      session.lastAcknowledgedSequence ?? 0,
      command.sequence!,
    ),
  });
  return { kind: "ok", duplicate: false };
}
export async function disableSourceControl(
  db: DatabaseWriter,
  source: Doc<"eventMediaSources">,
  program: Doc<"eventMediaPrograms">,
) {
  const s = program.activeSessionId
    ? await db.get(program.activeSessionId)
    : null;
  if (!s || stopped(s)) return;
  const pending = s.pendingControlCommandId
    ? await db.get(s.pendingControlCommandId)
    : null;
  const desired =
    s.committedIntent?.kind === "manual" &&
    s.committedIntent.sourceId === source._id;
  if (desired || s.currentSourceId === source._id) {
    await supersedePending(db, s);
    const sequence = await allocateSessionCommandSequence(db, s._id);
    await db.patch(s._id, {
      committedIntent: { kind: "slate" },
      intentSequence: sequence,
      pendingControlCommandId: undefined,
      updatedAt: Date.now(),
    });
  } else if (
    pending?.controlTarget?.kind === "source" &&
    pending.controlTarget.source.sourceId === source._id
  )
    await settleControl(db, s, pending, {
      kind: "failed",
      reason: "source_unavailable",
    });
}
