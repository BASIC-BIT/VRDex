import { recordResourceSnapshot, computeRuntimeValidator, trustedComputeRuntime } from "./_eventBroadcastResources";
import {assertWorkerProtocol,beginControlPreparation,promoteControlOperation,completeControlOperation,controlFence,coherentEvidence,writeControlObservation,isCut,isControl,settleControl} from "./_eventBroadcastControl";
import {controlTargetValidator,controlResultValidator,controlFailureValidator} from "./_eventMediaControl";
import { parseMediaSettings, resolveDestinationProfile } from "../workers/restream/broadcast-profiles.mjs";
import { eventProfileBroadcastInputChoices, resolveBroadcastInput, broadcastInputPublicUrl, eventMediaSourceWorkerDescriptor } from "./_eventBroadcastSources";
import { outputHealthValidator, eventOutputIsAuthorized } from './_eventOutputSetup';
import { canReadProfile } from "./_profilePermissions";
import { v } from "convex/values";
import { mutation, type MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { settleTerminalSessionCommands, effectiveBroadcastPolicy, allocateSessionCommandSequence, EVENT_BROADCAST_STOP_GRACE_MS, EVENT_BROADCAST_COMMAND_BATCH, EVENT_BROADCAST_LEASE_MS, EVENT_BROADCAST_MAX_SOURCES, EVENT_BROADCAST_MAX_SCENES, EVENT_BROADCAST_MAX_OUTPUTS, EVENT_BROADCAST_RENEW_AFTER_MS, requireEventMediaBridgeToken, observedBroadcastStateValidator, workerSessionArgs, } from "./_eventBroadcastInputs";
type Request = {
    protocolVersion?:number;
    bridgeToken: string;
    eventId: Id<"events">;
    sessionId: Id<"eventMediaSessions">;
    workerId: string;
    epoch: number;
};
function authenticate(args: Request) {
    requireEventMediaBridgeToken(args.bridgeToken);
    if (!args.workerId.trim() || args.workerId.length > 128 || args.workerId !== args.workerId.trim()) {
        throw new Error("Worker id must contain 1 to 128 characters without surrounding whitespace.");
    }
    if (!Number.isSafeInteger(args.epoch) || args.epoch < 0)
        throw new Error("Worker epoch must be a nonnegative integer.");
}
async function records(ctx: MutationCtx, args: Request, allowTerminal = false, allowRevokedDestination = false) {
    const session = await ctx.db.get(args.sessionId);
    if (session === null || session.eventId !== args.eventId)
        return null;
    assertWorkerProtocol(session,args);
    const program = await ctx.db.get(session.programId);
    const event = await ctx.db.get(args.eventId);
    const terminal = ["ended", "error"].includes(session.status);
    if (program === null || event === null || program.eventId !== args.eventId || (program.activeSessionId !== session._id && !(allowTerminal && terminal)))
        return null;
    if (terminal && !allowTerminal)
        return null;
    if (!allowRevokedDestination && session.outputId) {
        const selectedOutput = await ctx.db.get(session.outputId);
        if (!selectedOutput || !eventOutputIsAuthorized(event, selectedOutput)) return null;
    }
    return { session, program, event };
}
async function selectedObservationOutput(ctx: MutationCtx, found: NonNullable<Awaited<ReturnType<typeof records>>>, observedId: Id<"eventMediaOutputs"> | null | undefined, state: string | undefined) {
    if (observedId != null && observedId !== found.session.outputId) return false;
    const output = found.session.outputId ? await ctx.db.get(found.session.outputId) : null;
    if (found.session.outputId && (!output || output.programId !== found.program._id || output.eventId !== found.event._id)) return false;
    if (output && ["live", "hold"].includes(state ?? "") && (!eventOutputIsAuthorized(found.event, output) || !["ready", "active"].includes(output.state))) return false;
    return output;
}
async function updateObservedOutput(ctx: MutationCtx, event: Doc<"events">, output: Doc<"eventMediaOutputs"> | null, state: string | undefined, now: number) {
    if (!output || !eventOutputIsAuthorized(event, output) || !["ready", "active"].includes(output.state)) return;
    const next = state === "live" || state === "hold" ? "active" : state === "ended" || state === "error" ? "ready" : undefined;
    if (next && output.state !== next) await ctx.db.patch(output._id, { state: next, updatedAt: now });
}
async function reject(ctx: MutationCtx, args: Request, reason: string) {
    // Persist rejection instead of throwing, which would roll back the audit write.
    const session = await ctx.db.get(args.sessionId);
    if (session !== null) {
        await ctx.db.insert("eventMediaAuditEvents", {
            programId: session.programId, eventId: session.eventId, sessionId: session._id,
            actorSurface: "worker", action: "worker_request_rejected", privateSummary: reason, createdAt: Date.now(),
        });
    }
    return { granted: false as const, reason };
}
function owns(session: Doc<"eventMediaSessions">, args: Request, now: number) {
    return session.workerId === args.workerId && session.epoch === args.epoch && (session.leaseExpiresAt ?? 0) > now;
}
function lease(session: Doc<"eventMediaSessions">, epoch: number, acquiredAt: number, expiresAt: number) {
    return { granted: true as const, sessionId: session._id, epoch, acquiredAt, expiresAt, serverNow: Date.now(), renewAfterMs: EVENT_BROADCAST_RENEW_AFTER_MS };
}
export const acquireSession = mutation({
    args: workerSessionArgs,
    handler: async (ctx, args) => {
        authenticate(args);
        const found = await records(ctx, args);
        if (found === null)
            return reject(ctx, args, "Session is not the active event session.");
        const { session, program, event } = found;
        const now = Date.now();
        if (event.eventStatus !== "scheduled" || session.stopRequestedAt !== undefined || session.status === "stopping") {
            return reject(ctx, args, "Session is stopping or the event is cancelled.");
        }
        if ((session.scheduledStartAt ?? 0) > now)
            return reject(ctx, args, "Session has not reached its scheduled start.");
        const currentEpoch = session.epoch ?? 0;
        const active = (session.leaseExpiresAt ?? 0) > now;
        if (active && !(session.workerId === args.workerId && session.epoch !== undefined && (args.epoch === currentEpoch || args.epoch === currentEpoch - 1))) {
            return reject(ctx, args, "Session already has an unexpired owner.");
        }
        if (!active && args.epoch !== currentEpoch)
            return reject(ctx, args, "Session epoch is stale.");
        const epoch = active ? currentEpoch : currentEpoch + 1;
        const acquiredAt = active ? session.acquiredAt ?? now : now;
        const expiresAt = active ? session.leaseExpiresAt! : now + EVENT_BROADCAST_LEASE_MS;
        if (!active) {
            // Check even inconsistent legacy activeSessionId records before granting publication authority.
            const siblings = (await Promise.all((["scheduled", "starting", "live", "hold", "fallback", "stopping"] as const).map(status =>
                ctx.db.query("eventMediaSessions").withIndex("by_eventId_status_leaseExpiresAt", q => q.eq("eventId", args.eventId).eq("status", status).gt("leaseExpiresAt", now)).take(2)))).flat();
            if (siblings.some(s => s._id !== session._id)) {
                return reject(ctx, args, "Another event session has an unexpired owner.");
            }
            await ctx.db.patch(session._id, { workerId: args.workerId, epoch, acquiredAt, leaseExpiresAt: expiresAt, status: "starting", resourceSnapshot:undefined, resourceObservedAt:undefined, programObservedAt:undefined, observedOutputMs:undefined, observedSourceRevision:undefined, observedSlotKey:undefined, outputHealthObservedAt:undefined, outputHealth:[], updatedAt: now });
            await ctx.db.insert("eventMediaAuditEvents", { programId: program._id, eventId: args.eventId, sessionId: session._id, actorSurface: "worker", action: "worker_session_acquired", privateSummary: `Epoch ${epoch}.`, createdAt: now });
        }
        return { ...lease(session, epoch, acquiredAt, expiresAt), configuration: await configuration(ctx, {...found,session:(await ctx.db.get(session._id))!}) };
    },
});
export const renewSession = mutation({
    // Parse optional telemetry inside the handler so malformed samples cannot deny a valid lease.
    args: { ...workerSessionArgs, sample: v.optional(v.any()) },
    handler: async (ctx, args) => {
        authenticate(args);
        const found = await records(ctx, args);
        const now = Date.now();
        if (found === null || !owns(found.session, args, now))
            return reject(ctx, args, "Session ownership is stale or expired.");
        const stopDeadline = found.session.stopRequestedAt === undefined ? Infinity : found.session.stopRequestedAt + EVENT_BROADCAST_STOP_GRACE_MS;
        if (stopDeadline <= now)
            return reject(ctx, args, "Session stop grace period has expired.");
        const expiresAt = Math.min(now + EVENT_BROADCAST_LEASE_MS, stopDeadline);
        await recordResourceSnapshot(ctx, { ...args, sample: args.sample });
        await ctx.db.patch(args.sessionId, { leaseExpiresAt: expiresAt, updatedAt: now });
        return lease(found.session, args.epoch, found.session.acquiredAt ?? now, expiresAt);
    },
});
export const claimCommands = mutation({
  args: workerSessionArgs,
  handler: async (ctx, args) => {
    authenticate(args);
    const found = await records(ctx, args);
    const now = Date.now();
    if (found === null || !owns(found.session, args, now))
      return reject(ctx, args, "Session ownership is stale or expired.");
    // Number any legacy commands without consuming an unused sequence.
    await allocateSessionCommandSequence(ctx.db, args.sessionId, false);
    const batches = await Promise.all(
      (["queued", "claimed"] as const).map((status) =>
        ctx.db
          .query("eventMediaCommands")
          .withIndex("by_session_scope_status_sequence", (q) =>
            q
              .eq("sessionId", args.sessionId)
              .eq("eventId", args.eventId)
              .eq("programId", found.program._id)
              .eq("status", status)
              .gt("sequence", undefined),
          )
          .take(EVENT_BROADCAST_COMMAND_BATCH),
      ),
    );
    // Emergency controls must remain reachable even behind a full ordinary
    // batch. The pointer and indexed Stop lookups keep these reads bounded.
    const emergency = await Promise.all([
      found.session.pendingControlCommandId
        ? ctx.db.get(found.session.pendingControlCommandId)
        : null,
      ...(["queued", "claimed"] as const).map((status) =>
        ctx.db
          .query("eventMediaCommands")
          .withIndex("by_sessionId_commandType_status", (q) =>
            q
              .eq("sessionId", args.sessionId)
              .eq("commandType", "stop_program")
              .eq("status", status),
          )
          .first(),
      ),
    ]);
    const pending = [
      ...new Map(
        [
          ...batches.flat(),
          ...emergency.filter(
            (command) =>
              command !== null &&
              command.eventId === args.eventId &&
              command.programId === found.program._id &&
              command.sessionId === args.sessionId &&
              command.sequence !== undefined &&
              (command.status === "queued" || command.status === "claimed"),
          ),
        ].map((command) => [command!._id, command!]),
      ).values(),
    ].sort((a, b) =>
      a.commandType === "stop_program"
        ? -1
        : b.commandType === "stop_program"
          ? 1
          : isCut(a.commandType)
            ? -1
            : isCut(b.commandType)
              ? 1
              : a.sequence! - b.sequence!,
    );
    const commands = [];
    for (const command of pending.slice(0, EVENT_BROADCAST_COMMAND_BATCH)) {
      // An earlier future command must become eligible before later intent
      // can execute; otherwise its acknowledgement would be out of order.
      if (
        found.session.stopRequestedAt !== undefined &&
        command.commandType !== "stop_program"
      )
        continue;
      if (
        found.session.controlProtocolVersion === 2 &&
        isControl(command.commandType) &&
        !command.controlTarget
      )
        continue;
      if (
        command.controlTarget &&
        command._id !== found.session.pendingControlCommandId
      )
        continue;
      if ((command.availableAt ?? command.createdAt) > now) break;
      commands.push(command);
    }
    for (const command of commands) {
      await ctx.db.patch(command._id, {
        status: "claimed",
        claimedByWorkerId: args.workerId,
        claimedEpoch: args.epoch,
        claimedAt: now,
        updatedAt: now,
      });
    }
    return {
      granted: true as const,
      epoch: args.epoch,
      commands: commands.map((c) => ({
        ...c,
        status: "claimed" as const,
        claimedEpoch: args.epoch,
        claimedByWorkerId: args.workerId,
      })),
    };
  },
});
export const beginPreparation = mutation({
  args: {
    ...workerSessionArgs,
    commandId: v.id("eventMediaCommands"),
    sequence: v.number(),
  },
  returns: controlResultValidator,
  handler: async (ctx, args) => {
    authenticate(args);
    return beginControlPreparation(ctx.db, args);
  },
});
export const promoteOperation = mutation({
  args: {
    ...workerSessionArgs,
    commandId: v.id("eventMediaCommands"),
    sequence: v.number(),
    target: controlTargetValidator,
  },
  returns: controlResultValidator,
  handler: async (ctx, args) => {
    authenticate(args);
    return promoteControlOperation(ctx.db, args);
  },
});
export const acknowledgeCommand = mutation({
    args: {
        ...workerSessionArgs, commandId: v.id("eventMediaCommands"), sequence: v.number(),
        intentSequence:v.optional(v.number()),outputMs:v.optional(v.number()),sourceRevision:v.optional(v.number()),slotKey:v.optional(v.string()),failureReason:v.optional(controlFailureValidator),
        outcome: v.union(v.literal("succeeded"), v.literal("failed")),
        observedSourceId: v.optional(v.union(v.id("eventMediaSources"), v.null())),
        observedSceneId: v.optional(v.union(v.id("eventMediaScenes"), v.null())),
        observedOutputId: v.optional(v.union(v.id("eventMediaOutputs"), v.null())),
        observedState: v.optional(observedBroadcastStateValidator),
    },
    handler: async (ctx, args) => {
        authenticate(args);
        const controlCommand=await ctx.db.get(args.commandId);
        if(controlCommand?.controlTarget) return completeControlOperation(ctx.db,args,{intentSequence:args.intentSequence,outputMs:args.outputMs,sourceId:args.observedSourceId,sourceRevision:args.sourceRevision,slotKey:args.slotKey,outputId:args.observedOutputId,state:args.observedState});
        const denied = async (reason: string) => ({ ...await reject(ctx, args, reason), accepted: false as const });
        if (!Number.isSafeInteger(args.sequence) || args.sequence < 1)
            return denied("Command sequence is invalid.");
        const found = await records(ctx, args, true, ["ended","error"].includes(args.observedState ?? ""));
        const now = Date.now();
        if (found === null || !owns(found.session, args, now))
            return denied("Session ownership is stale or expired.");
        const command = await ctx.db.get(args.commandId);
        if(found.session.controlProtocolVersion===2 && command && isControl(command.commandType))return {kind:"superseded" as const};
        if (args.outcome === "succeeded" && !["ended","error"].includes(args.observedState ?? "") && found.session.outputId) {
            const selectedOutput = await ctx.db.get(found.session.outputId);
            if (!selectedOutput || !eventOutputIsAuthorized(found.event, selectedOutput)) return denied("Destination authority was revoked.");
        }
        if (command === null || command.sessionId !== args.sessionId || command.eventId !== args.eventId || command.programId !== found.program._id || command.sequence !== args.sequence) {
            return denied("Command does not belong to this session and sequence.");
        }
        const completionPayload=JSON.stringify([args.outcome,args.intentSequence??null,args.outputMs??null,args.sourceRevision??null,args.slotKey??null,args.observedSourceId??null,args.observedSceneId??null,args.observedOutputId??null,args.observedState??null]);
        if (command.completionPayload!==undefined && command.status===args.outcome && command.completionPayload!==completionPayload)return {kind:"superseded" as const};
        if (command.status === args.outcome && command.acknowledgedEpoch === args.epoch && command.observedSourceId === args.observedSourceId && command.observedSceneId === args.observedSceneId && command.observedOutputId === args.observedOutputId && command.observedState === args.observedState) {
            return { accepted: true as const, duplicate: true };
        }
        if (["ended", "error"].includes(found.session.status))
            return denied("Session has already ended.");
        const obsoleteReceipt = found.session.controlProtocolVersion === 2 &&
            command.commandType !== "stop_program" && args.sequence <= (found.session.lastAcknowledgedSequence ?? 0);
        if (obsoleteReceipt) {
            // A prioritized control can finish before an older Start/admin receipt.
            // Retire that receipt without applying its evidence or fencing a healthy
            // publisher. Authority loss still wins, including on duplicate retries.
            const authority = await controlFence(ctx.db, args);
            if ("result" in authority) return authority.result;
            if (command.status === "cancelled" && command.controlOutcome === "superseded")
                return { kind: "superseded" as const };
        }
        if (command.status !== "claimed" || command.claimedByWorkerId !== args.workerId || command.claimedEpoch !== args.epoch)
            return denied("Command was not claimed by this owner.");
        if (args.sequence <= (found.session.lastAcknowledgedSequence ?? 0)) {
            if (obsoleteReceipt) return settleControl(ctx.db, found.session, command, { kind: "superseded" });
            return denied("Command sequence has already been superseded.");
        }
        const earlier = await Promise.all((["queued", "claimed"] as const).map(status =>
            ctx.db.query("eventMediaCommands").withIndex("by_session_scope_status_sequence", q => q.eq("sessionId", args.sessionId).eq("eventId", args.eventId).eq("programId", found.program._id).eq("status", status).gt("sequence", undefined).lt("sequence", args.sequence)).first()));
        if (command.commandType!=="stop_program" && earlier.some(c=>c && !(found.session.controlProtocolVersion===2 && isControl(c.commandType) && !c.controlTarget)))
            return denied("An earlier command is still pending.");
        const selectedOutput = await selectedObservationOutput(ctx, found, args.observedOutputId, args.outcome === "succeeded" ? args.observedState : undefined);
        if (selectedOutput === false) return denied("Observed output is unavailable.");
        for (const [id, table] of [[args.observedSourceId, "source"], [args.observedSceneId, "scene"]] as const) {
            if (id === undefined || id === null)
                continue;
            const record = await ctx.db.get(id);
            if (record === null || record.programId !== found.program._id || record.eventId !== args.eventId || ("state" in record && record.state === "disabled") || ("projectionAvailable" in record && record.projectionAvailable === false)) {
                return denied(`Observed ${table} does not belong to this event program.`);
            }
        }
        if (args.outcome === "succeeded" && command.commandType === "switch_source" && args.observedSourceId == null) {
            return denied("A successful source switch requires the actual observed source.");
        }
        const hasV2Observation=found.session.controlProtocolVersion===2 && args.outcome==="succeeded" && !["ended","error"].includes(args.observedState??"") && (args.observedState!==undefined || args.observedSourceId!==undefined);
        if(hasV2Observation && !await coherentEvidence(ctx.db,found.session,{intentSequence:args.intentSequence,outputMs:args.outputMs,sourceId:args.observedSourceId,sourceRevision:args.sourceRevision,slotKey:args.slotKey,outputId:args.observedOutputId,state:args.observedState}))return {kind:"superseded" as const};
        await ctx.db.patch(command._id, { completionPayload, status: args.outcome, acknowledgedEpoch: args.epoch, observedSourceId: args.observedSourceId, observedSceneId: args.observedSceneId, observedOutputId: args.observedOutputId, observedState: args.observedState, completedAt: now, updatedAt: now });
        const observed = args.outcome === "succeeded" ? {
            ...(args.observedSourceId === undefined ? {} : { currentSourceId: args.observedSourceId ?? undefined }),
            ...(args.observedSceneId === undefined ? {} : { currentSceneId: args.observedSceneId ?? undefined }),
        } : {};
        const observedState = args.outcome === "succeeded" ? args.observedState : undefined;
        const mode = command.commandType === "set_automatic_mode" ? "automatic" : ["switch_hold", "show_hold_scene"].includes(command.commandType) ? "hold" : ["hold_current", "switch_source", "switch_next", "next_slot", "switch_previous", "previous_slot"].includes(command.commandType) ? "manual" : undefined;
        await ctx.db.patch(args.sessionId, { ...(hasV2Observation?{observedOutputMs:args.outputMs,observedSourceRevision:args.sourceRevision,observedSlotKey:args.slotKey}:{}), ...(args.outcome === "succeeded" && mode ? { broadcastMode: mode } : {}), ...observed, ...(args.outcome === "succeeded" && (mode || observedState || args.observedSourceId !== undefined) ? {programObservedAt:now} : {}), ...(observedState === undefined ? {} : { status: observedState }), lastAcknowledgedSequence: args.sequence, updatedAt: now });
        if (args.outcome === "succeeded")
            await ctx.db.patch(found.program._id, { ...observed, ...(args.observedOutputId === undefined ? {} : { currentOutputId: args.observedOutputId ?? undefined }), ...(observedState === undefined ? {} : { state: observedState }), ...(["ended", "error"].includes(observedState ?? "") ? { activeSessionId: undefined } : {}), updatedAt: now });
        await updateObservedOutput(ctx, found.event, selectedOutput, observedState, now);
        if (observedState === "ended" || observedState === "error")
            await settleTerminalSessionCommands(ctx.db, args.sessionId, observedState, now);
        await ctx.db.insert("eventMediaAuditEvents", { programId: found.program._id, eventId: args.eventId, sessionId: args.sessionId, commandId: command._id, actorSurface: "worker", action: "worker_command_acknowledged", privateSummary: `Sequence ${args.sequence}: ${args.outcome}.`, createdAt: now });
        return { accepted: true as const, duplicate: false };
    },
});
async function configuration(ctx: MutationCtx, { session, program, event }: NonNullable<Awaited<ReturnType<typeof records>>>) {
    const authored = await ctx.db.query("eventSlots").withIndex("by_eventId_startAt", q => q.eq("eventId", event._id)).take(65);
    if (authored.length > 64)
        throw new Error("Event schedule exceeds worker limits.");
    const slots = [];
    for (const slot of authored) {
        let source = await ctx.db.query("eventMediaSources").withIndex("by_programId_key", q => q.eq("programId", program._id).eq("key", `slot-${slot._id}`)).first();
        if (slot.personProfileId) {
            const profile = await ctx.db.get(slot.personProfileId);
            const input = profile && canReadProfile("public", profile) ? resolveBroadcastInput({ choices: eventProfileBroadcastInputChoices(profile), explicitInput: slot.broadcastInput, legacySelectedStreamId: slot.selectedStreamId }) : undefined;
            const publicUrl = input ? broadcastInputPublicUrl(input) : undefined;
            if (input && !source) {
                const id = await ctx.db.insert("eventMediaSources", { programId: program._id, eventId: event._id, key: `slot-${slot._id}`, position: slot.position, type: input.kind === "vrcdn" ? "vrcdn_link" : "twitch_watch", input, revision: 1, purpose: "program", state: "ready", label: slot.displayLabel, eventSlotId: slot._id, sourceProfileId: slot.personProfileId, profileProjection: true, projectionAvailable: true, publicUrl, createdAt: Date.now(), updatedAt: Date.now() });
                source = await ctx.db.get(id);
            }
            else if (source && (source.publicUrl !== publicUrl || source.profileProjection !== true || source.projectionAvailable !== !!input || source.sourceProfileId !== slot.personProfileId)) {
                await ctx.db.patch(source._id, { publicUrl, input, revision: (source.revision ?? 1) + 1, ...(input ? { type: input.kind === "vrcdn" ? "vrcdn_link" as const : "twitch_watch" as const } : {}), profileProjection: true, projectionAvailable: !!input, sourceProfileId: slot.personProfileId, updatedAt: Date.now() });
                source = await ctx.db.get(source._id);
            }
        }
        else if (source && (source.profileProjection || source.sourceProfileId)) {
            if (source.profileProjection !== true || source.projectionAvailable !== false || source.publicUrl !== undefined)
                await ctx.db.patch(source._id, { profileProjection: true, projectionAvailable: false, publicUrl: undefined, input: undefined, revision: (source.revision ?? 1) + 1, updatedAt: Date.now() });
            source = null;
        }
        if (!source && !slot.personProfileId)
            source = (await ctx.db.query("eventMediaSources").withIndex("by_programId_eventSlotId", q => q.eq("programId", program._id).eq("eventSlotId", slot._id)).take(EVENT_BROADCAST_MAX_SOURCES + 1)).find(s => s.eventSlotId === slot._id && !s.profileProjection && !(s.sourceProfileId && s.key === `slot-${slot._id}`)) ?? null;
        slots.push({ slotKey: slot._id, sourceId: source?._id, startAt: slot.startAt, endAt: slot.endAt, available: source !== null && source.state !== "disabled" && source.projectionAvailable !== false && eventMediaSourceWorkerDescriptor(source) !== undefined });
    }
    // Index each current slot plus unbound manual sources. Detached projections
    // cannot consume the bound or hide later authored/manual sources.
    const sources = [];
    for (const slotId of [undefined, ...authored.map(slot => slot._id)]) {
        const eligible = await ctx.db.query("eventMediaSources")
            .withIndex("by_programId_eventSlotId", q => q.eq("programId", program._id).eq("eventSlotId", slotId))
            .filter(q => q.and(q.eq(q.field("eventId"), event._id), q.neq(q.field("state"), "disabled"), q.neq(q.field("projectionAvailable"), false)))
            .take(EVENT_BROADCAST_MAX_SOURCES + 1 - sources.length);
        sources.push(...eligible);
        if (sources.length > EVENT_BROADCAST_MAX_SOURCES)
            throw new Error("Event broadcast configuration exceeds worker limits.");
    }
    const [scenes, outputs] = await Promise.all([
        ctx.db.query("eventMediaScenes").withIndex("by_programId_position", q => q.eq("programId", program._id)).take(EVENT_BROADCAST_MAX_SCENES + 1),
        ctx.db.query("eventMediaOutputs").withIndex("by_programId_key", q => q.eq("programId", program._id)).take(EVENT_BROADCAST_MAX_OUTPUTS + 1),
    ]);
    if (sources.length > EVENT_BROADCAST_MAX_SOURCES || scenes.length > EVENT_BROADCAST_MAX_SCENES || outputs.length > EVENT_BROADCAST_MAX_OUTPUTS) {
        throw new Error("Event broadcast configuration exceeds worker limits.");
    }
    const deadline = session.runtimeDeadlineAt ?? Date.now() + 43200000;
    if (session.runtimeDeadlineAt === undefined)
        await ctx.db.patch(session._id, { runtimeDeadlineAt: deadline });
    return {
        programId: program._id, eventId: event._id, outputId: session.outputId,
        committedIntent:session.committedIntent,intentSequence:session.intentSequence,
        pendingOperation:session.pendingControlCommandId?await ctx.db.get(session.pendingControlCommandId):null,
        allocation: session.allocation, destinationProfiles: session.destinationProfiles,
        mediaSettings: parseMediaSettings(session.mediaSettings), controlProtocolVersion: session.controlProtocolVersion,
        currentSourceId: session.currentSourceId ?? program.currentSourceId,
        currentSceneId: session.currentSceneId ?? program.currentSceneId,
        sessionDeadline: deadline, stopped: event.eventStatus !== "scheduled" || session.stopRequestedAt !== undefined,
        mode: session.committedIntent ? session.committedIntent.kind === "slate" ? "hold" : session.committedIntent.kind : session.broadcastMode ?? "automatic", policy: effectiveBroadcastPolicy(program.broadcastPolicy), slots,
        sources: sources.filter(s => s.eventId === event._id && s.state !== "disabled" && s.projectionAvailable !== false && (!s.eventSlotId || authored.some(slot => slot._id === s.eventSlotId))).flatMap(source => { const descriptor = eventMediaSourceWorkerDescriptor(source); return descriptor ? [descriptor] : []; }),
        scenes: scenes.filter(s => s.eventId === event._id).map(s => ({ id: s._id, key: s.key, type: s.type, sourceId: s.sourceId })),
        outputs: outputs.filter(o => o.eventId === event._id && eventOutputIsAuthorized(event, o) && ["ready", "active"].includes(o.state) && (!session.destinationProfiles || session.destinationProfiles.some(d => d.outputId === o._id))).map(o => ({ id: o._id, key: o.key, type: o.type, credential: o.credential, vrcdnSetup: o.vrcdnSetup, twitchSetup: o.twitchSetup, profile: session.destinationProfiles?.find(d => d.outputId === o._id)?.profile ?? resolveDestinationProfile({settings:session.mediaSettings,destination:o.type === "vrcdn" ? "vrcdn" : "twitch"}), simulcastEnabled: session.destinationProfiles ? o._id !== session.outputId : o.simulcastEnabled ?? false, compliance: o.compliance })),
    };
}
export const refreshConfiguration = mutation({ args: workerSessionArgs, handler: async (ctx, args) => {
        authenticate(args);
        const found = await records(ctx, args);
        if (!found || !owns(found.session, args, Date.now()))
            return reject(ctx, args, "Session ownership is stale or expired.");
        return { granted: true as const, serverNow: Date.now(), configuration: await configuration(ctx, found) };
    } });
export const observeProgram = mutation({ args: { ...workerSessionArgs, intentSequence:v.optional(v.number()),sourceRevision:v.optional(v.number()),slotKey:v.optional(v.string()), state: observedBroadcastStateValidator, outputMs: v.number(), publishing: v.boolean(), outputId: v.optional(v.id("eventMediaOutputs")), sourceId: v.optional(v.id("eventMediaSources")), mode: v.optional(v.union(v.literal("automatic"), v.literal("manual"), v.literal("hold"))) }, handler: async (ctx, args) => {
        authenticate(args);
        const session=await ctx.db.get(args.sessionId);
        if(session?.controlProtocolVersion===2 && !["ended","error"].includes(args.state)) {
          const found=await controlFence(ctx.db,args);if("result" in found)return found.result;
          if(["live","hold"].includes(args.state) && (!args.publishing || !Number.isFinite(args.outputMs) || args.outputMs<=0))throw Error("Publishing progress is required.");
          const evidence={...args,state:args.state};
          if(!args.publishing || !await coherentEvidence(ctx.db,found.session,evidence))return {kind:"superseded" as const};
          await writeControlObservation(ctx.db,found.session,evidence);return {kind:"ok" as const};
        }
        const found = await records(ctx, args, false, ["ended","error"].includes(args.state));
        if (!found || !owns(found.session, args, Date.now()))
            return { ...await reject(ctx, args, "Session ownership is stale or expired."), accepted: false };
        if (["live", "hold"].includes(args.state) && (!args.publishing || !Number.isFinite(args.outputMs) || args.outputMs <= 0))
            throw new Error("Publishing progress is required.");
        if (args.sourceId) {
            const source = await ctx.db.get(args.sourceId);
            if (!source || source.eventId !== args.eventId || source.programId !== found.program._id || source.state === "disabled" || source.projectionAvailable === false)
                return { ...await reject(ctx, args, "Observed source is unavailable."), accepted: false };
        }
        const selectedOutput = await selectedObservationOutput(ctx, found, args.outputId, args.state);
        if (selectedOutput === false)
            return { ...await reject(ctx, args, "Observed output is unavailable."), accepted: false };
        const terminal = ["ended", "error"].includes(args.state);
        if (args.state === "ended" || args.state === "error")
            await settleTerminalSessionCommands(ctx.db, args.sessionId, args.state, Date.now());
        if (found.session.status !== args.state || found.session.currentSourceId !== args.sourceId)
            await ctx.db.insert("eventMediaAuditEvents", { programId: found.program._id, eventId: args.eventId, sessionId: args.sessionId, actorSurface: "worker", action: "worker_program_observed", privateSummary: `${args.state}; encoded output ${args.outputMs}ms.`, createdAt: Date.now() });
        await updateObservedOutput(ctx, found.event, selectedOutput, args.state, Date.now());
        await ctx.db.patch(args.sessionId, { status: args.state, programObservedAt:Date.now(), currentSourceId: args.sourceId, broadcastMode: args.mode ?? found.session.broadcastMode, health: { lastHeartbeatAt: Date.now() }, updatedAt: Date.now() });
        await ctx.db.patch(found.program._id, { state: args.state, currentSourceId: args.sourceId, ...(terminal ? { activeSessionId: undefined } : {}), updatedAt: Date.now() });
        return { accepted: true };
    } });
/** Reserve capacity transactionally before any ECS call. Ambiguous dispatches retain
 * capacity until an operator confirms the task stopped; never expire into duplicates. */
export const admitDispatch = mutation({ args: { bridgeToken: v.string(), eventId: v.id("events"), sessionId: v.id("eventMediaSessions"), dispatchId: v.string(), launchProtocol: v.optional(v.literal("fenced-v1")) }, handler: async (ctx, args) => {
        requireEventMediaBridgeToken(args.bridgeToken);
        const session = await ctx.db.get(args.sessionId);
        const program = session ? await ctx.db.get(session.programId) : null;
        if (!session || session.eventId !== args.eventId || program?.activeSessionId !== session._id || session.stopRequestedAt !== undefined || ["ended", "error"].includes(session.status))
            return { granted: false };
        const event = await ctx.db.get(args.eventId);
        const selectedOutput = session.outputId ? await ctx.db.get(session.outputId) : null;
        if (!event || (session.outputId !== undefined && (!selectedOutput || !eventOutputIsAuthorized(event, selectedOutput)))) return { granted:false };
        if (session.dispatchStopConfirmedAt !== undefined)
            return { granted: false };
        if (session.dispatchId)
            return { granted: session.dispatchId === args.dispatchId };
        if (!args.dispatchId || args.dispatchId.length > 128)
            throw new Error("Invalid dispatch identity.");
        const cap = Number(process.env.VRDEX_EVENT_BROADCAST_MAX_CONCURRENT ?? 1);
        if (!Number.isSafeInteger(cap) || cap < 1 || cap > 100)
            throw new Error("Invalid broadcast concurrency limit.");
        const managed = await ctx.db.query("eventMediaSessions").withIndex("by_dispatchStopConfirmedAt_dispatchId", q => q.eq("dispatchStopConfirmedAt", undefined).gt("dispatchId", undefined)).take(101);
        if (managed.length > 100)
            return { granted: false };
        const legacy = await ctx.db.query("eventMediaSessions").withIndex("by_workerTaskStatus", q => q.eq("workerTaskStatus", undefined)).filter(q => q.or(q.neq(q.field("workerTaskId"), undefined), q.neq(q.field("dispatchId"), undefined))).take(101);
        if (legacy.length > 100)
            return { granted: false };
        let count = managed.length + legacy.filter(s => s.dispatchId === undefined).length;
        for (const status of ["starting", "running", "stopping"] as const) {
            const sessions = await ctx.db.query("eventMediaSessions").withIndex("by_workerTaskStatus", q => q.eq("workerTaskStatus", status)).take(101);
            if (sessions.length > 100)
                return { granted: false };
            count += sessions.filter(s => s.dispatchId === undefined && (s.workerTaskId !== undefined || s.epoch !== undefined)).length;
        }
        if (count >= cap)
            return { granted: false };
        await ctx.db.patch(session._id, { dispatchId: args.dispatchId, launchProtocol: args.launchProtocol, workerTaskStatus: "starting", updatedAt: Date.now() });
        return { granted: true };
    } });
const prelaunchArgs = { bridgeToken: v.string(), eventId: v.id("events"), sessionId: v.id("eventMediaSessions"), dispatchId: v.string(), commandId: v.id("eventMediaCommands"), workerId: v.string() };
async function unlaunchedReservation(ctx: MutationCtx, args: { eventId: Id<"events">; sessionId: Id<"eventMediaSessions">; dispatchId: string; commandId: Id<"eventMediaCommands">; workerId: string }) {
    const session = await ctx.db.get(args.sessionId);
    if (!session || session.eventId !== args.eventId || session.dispatchId !== args.dispatchId || session.launchProtocol !== "fenced-v1" || session.launchAttemptedAt !== undefined || session.epoch !== undefined || session.workerTaskId !== undefined || session.dispatchStopConfirmedAt !== undefined || !["scheduled", "starting", "stopping"].includes(session.status)) return null;
    const [program, command] = await Promise.all([ctx.db.get(session.programId), ctx.db.get(args.commandId)]);
    if (program?.eventId !== args.eventId || program.activeSessionId !== session._id || command?.eventId !== args.eventId || command.programId !== session.programId || command.sessionId !== session._id || command.commandType !== "start_program" || command.status !== "claimed" || command.claimedByWorkerId !== args.workerId) return null;
    return { session, program };
}
/** One durable winner before RunTask. Ambiguous marker responses retain capacity. */
export const markLaunchAttempt = mutation({ args: { ...prelaunchArgs, taskDefinitionArn: v.string() }, handler: async (ctx, args) => {
    requireEventMediaBridgeToken(args.bridgeToken);
    const found = await unlaunchedReservation(ctx, args);
    if (!found || found.session.stopRequestedAt !== undefined || !args.taskDefinitionArn || args.taskDefinitionArn.length > 512) {
        const session = await ctx.db.get(args.sessionId);
        return { accepted: false, cleanupUnused: !!session && session.workerTaskDefinitionArn !== args.taskDefinitionArn };
    }
    await ctx.db.patch(found.session._id, { launchAttemptedAt: Date.now(), workerTaskDefinitionArn: args.taskDefinitionArn, updatedAt: Date.now() });
    return { accepted: true };
} });
/** Atomic proof of no launch. Never used for a RunTask attempt or legacy reservation. */
export const releaseUnlaunchedDispatch = mutation({ args: { ...prelaunchArgs, taskDefinitionArn: v.optional(v.string()) }, handler: async (ctx, args) => {
    requireEventMediaBridgeToken(args.bridgeToken);
    const found = await unlaunchedReservation(ctx, args);
    if (!found || (args.taskDefinitionArn !== undefined && (!args.taskDefinitionArn || args.taskDefinitionArn.length > 512))) return { accepted: false };
    const now = Date.now();
    await settleTerminalSessionCommands(ctx.db, found.session._id, "error", now);
    await ctx.db.patch(found.session._id, { dispatchId: undefined, launchProtocol: undefined, status: "error", workerTaskStatus: "failed", leaseExpiresAt: now, ...(args.taskDefinitionArn ? { workerTaskDefinitionArn: args.taskDefinitionArn, workerTaskCleanupPending: true } : {}), updatedAt: now });
    await ctx.db.patch(found.program._id, { activeSessionId: undefined, state: "error", updatedAt: now });
    await ctx.db.insert("eventMediaAuditEvents", { eventId: args.eventId, programId: found.program._id, sessionId: args.sessionId, commandId: args.commandId, actorSurface: "worker", action: "worker_dispatch_unlaunched_released", createdAt: now });
    return { accepted: true };
} });
/** A losing registration can only record bounded private cleanup evidence. */
export const recordUnusedDefinitionCleanup = mutation({ args: { bridgeToken: v.string(), sessionId: v.id("eventMediaSessions"), taskDefinitionArn: v.string() }, handler: async (ctx, args) => {
    requireEventMediaBridgeToken(args.bridgeToken);
    const session = await ctx.db.get(args.sessionId);
    if (!session || args.taskDefinitionArn.length > 512 || !/^arn:(aws|aws-us-gov|aws-cn):ecs:[a-z0-9-]+:\d{12}:task-definition\/[A-Za-z0-9_-]+:\d+$/.test(args.taskDefinitionArn) || session.workerTaskDefinitionArn === args.taskDefinitionArn) return { accepted: false };
    await ctx.db.insert("eventMediaAuditEvents", { eventId: session.eventId, programId: session.programId, sessionId: session._id, actorSurface: "worker", action: "worker_unused_definition_manual_cleanup", privateSummary: args.taskDefinitionArn, createdAt: Date.now() });
    return { accepted: true };
} });
export const completeUnlaunchedCleanup = mutation({ args: { bridgeToken: v.string(), sessionId: v.id("eventMediaSessions"), taskDefinitionArn: v.string() }, handler: async (ctx, args) => {
    requireEventMediaBridgeToken(args.bridgeToken);
    const session = await ctx.db.get(args.sessionId);
    if (!session || session.dispatchId || session.epoch !== undefined || session.workerTaskId || session.launchAttemptedAt !== undefined || session.workerTaskDefinitionArn !== args.taskDefinitionArn || !["ended", "error"].includes(session.status)) return { accepted: false };
    await ctx.db.patch(session._id, { workerTaskCleanupPending: false, updatedAt: Date.now() });
    return { accepted: true };
} });
export const recordDispatchedTask = mutation({ args: { bridgeToken: v.string(), sessionId: v.id("eventMediaSessions"), dispatchId: v.string(), taskArn: v.string(), taskDefinitionArn: v.string(), computeRuntime: v.optional(computeRuntimeValidator) }, handler: async (ctx, args) => {
        requireEventMediaBridgeToken(args.bridgeToken);
        const session = await ctx.db.get(args.sessionId);
        if (!session || session.dispatchId !== args.dispatchId || (session.launchProtocol === "fenced-v1" && (session.launchAttemptedAt === undefined || session.workerTaskDefinitionArn !== args.taskDefinitionArn)))
            return { accepted: false };
        if (session.workerTaskId && session.workerTaskId !== args.taskArn)
            return { accepted: false };
        if (session.dispatchStopConfirmedAt !== undefined)
            return { accepted: true };
        await ctx.db.patch(session._id, { computeRuntime: trustedComputeRuntime(args.computeRuntime, args.taskArn, args.taskDefinitionArn) ?? session.computeRuntime, workerProvider: "aws_ecs", workerRuntime: "ecs-fargate", workerTaskId: args.taskArn, workerTaskDefinitionArn: args.taskDefinitionArn, workerTaskStatus: "starting", updatedAt: Date.now() });
        return { accepted: true };
    } });
export const recordProcessStatus = mutation({ args: { bridgeToken: v.string(), sessionId: v.id("eventMediaSessions"), taskArn: v.string(), stopped: v.boolean() }, handler: async (ctx, args) => {
        requireEventMediaBridgeToken(args.bridgeToken);
        const session = await ctx.db.get(args.sessionId);
        if (!session || session.workerTaskId !== args.taskArn)
            return { accepted: false };
        if (args.stopped)
            await settleTerminalSessionCommands(ctx.db, session._id, session.status === "ended" ? "ended" : "error", Date.now());
        if (session.dispatchStopConfirmedAt !== undefined || (!session.dispatchId && session.workerTaskStatus === "stopped" && session.workerTaskCleanupPending !== undefined))
            return { accepted: args.stopped };
        await ctx.db.patch(session._id, { ...(args.stopped ? { workerTaskCleanupPending: true, ...(session.dispatchId ? { dispatchStopConfirmedAt: Date.now() } : {}) } : {}), workerTaskStatus: args.stopped ? "stopped" : session.stopRequestedAt === undefined ? "running" : "stopping", ...(args.stopped && !['ended', 'error'].includes(session.status) ? { status: "error" as const, leaseExpiresAt: Date.now() } : {}), updatedAt: Date.now() });
        if (args.stopped) {
            const program = await ctx.db.get(session.programId);
            // Terminal media reports may already have cleared this pointer. A
            // different active session owns its destination even if this old
            // process has only now reached STOPPED.
            const ownsPublication = program?.activeSessionId === session._id ||
                (program?.activeSessionId === undefined && ['ended', 'error'].includes(session.status));
            if (program?.eventId === session.eventId && ownsPublication && session.outputId) {
                const [event, output] = await Promise.all([ctx.db.get(session.eventId), ctx.db.get(session.outputId)]);
                if (event && output?.programId === program._id && output.eventId === session.eventId)
                    await updateObservedOutput(ctx, event, output, session.status === 'ended' ? 'ended' : 'error', Date.now());
            }
            if (program?.activeSessionId === session._id)
                await ctx.db.patch(program._id, { activeSessionId: undefined, state: session.status === 'ended' ? 'ended' : 'error', updatedAt: Date.now() });
        }
        return { accepted: true };
    } });
/** Cleanup acknowledgement is separate from capacity release at confirmed STOPPED. */
export const completeTaskCleanup = mutation({ args: { bridgeToken: v.string(), sessionId: v.id("eventMediaSessions"), taskArn: v.string() }, handler: async (ctx, args) => {
        requireEventMediaBridgeToken(args.bridgeToken);
        const session = await ctx.db.get(args.sessionId);
        if (!session || session.workerTaskId !== args.taskArn || (session.dispatchId ? session.dispatchStopConfirmedAt === undefined : session.workerTaskStatus !== "stopped"))
            return { accepted: false };
        await ctx.db.patch(session._id, { workerTaskCleanupPending: false, updatedAt: Date.now() });
        return { accepted: true };
    } });

export const observeOutputs = mutation({args:{...workerSessionArgs,destinations:v.array(outputHealthValidator)},handler:async(ctx,args)=>{
 authenticate(args); const found=await records(ctx,args);
 if(!found || !owns(found.session,args,Date.now())) return {accepted:false};
 if(args.destinations.length>2 || new Set(args.destinations.map(d=>d.outputId)).size!==args.destinations.length) throw Error('Invalid output health.');
 for(const d of args.destinations){
  if(!Number.isFinite(d.outputMs)||d.outputMs<0||!Number.isSafeInteger(d.queueBytes)||d.queueBytes<0||d.queueBytes>524288||!Number.isSafeInteger(d.restarts)||d.restarts<0) throw Error('Invalid output health.');
  const o=await ctx.db.get(d.outputId);
  if(!o||!eventOutputIsAuthorized(found.event,o)||o.eventId!==args.eventId||o.programId!==found.program._id||!["ready","active"].includes(o.state)||(found.session.destinationProfiles ? !found.session.destinationProfiles.some(profile=>profile.outputId===o._id && profile.destination===d.destination) : (o._id!==found.session.outputId&&!o.simulcastEnabled))||(d.destination==='twitch'?(o.type!=='external_rtmp'||!o.twitchSetup):(o.type!=='vrcdn'||!!o.twitchSetup))) return {accepted:false};
 }
 await ctx.db.patch(args.sessionId,{outputHealth:args.destinations,outputHealthObservedAt:Date.now()}); return {accepted:true};
}});

/** ECS Stop request is process intent, never an observation or capacity release. */
export const recordTaskStopRequested = mutation({ args: { bridgeToken: v.string(), sessionId: v.id("eventMediaSessions"), taskArn: v.string() }, handler: async (ctx, args) => {
    requireEventMediaBridgeToken(args.bridgeToken);
    const session = await ctx.db.get(args.sessionId);
    if (!session || session.workerTaskId !== args.taskArn || session.stopRequestedAt === undefined) return { accepted: false };
    if (session.dispatchStopConfirmedAt === undefined && session.workerTaskStatus !== "stopped")
        await ctx.db.patch(session._id, { workerTaskStatus: "stopping", updatedAt: Date.now() });
    return { accepted: true };
} });
