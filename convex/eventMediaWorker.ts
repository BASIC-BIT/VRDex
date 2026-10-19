import { outputHealthValidator } from './_eventOutputSetup';
import { eventProfileStreamChoices, resolveEventStream } from "./_eventPlayback";
import { canReadProfile } from "./_profilePermissions";
import { v } from "convex/values";
import { mutation, type MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { validateBroadcastPolicy, allocateSessionCommandSequence, attachPendingProgramCommands, EVENT_BROADCAST_STOP_GRACE_MS, EVENT_BROADCAST_COMMAND_BATCH, EVENT_BROADCAST_LEASE_MS, EVENT_BROADCAST_MAX_SOURCES, EVENT_BROADCAST_MAX_SCENES, EVENT_BROADCAST_MAX_OUTPUTS, EVENT_BROADCAST_RENEW_AFTER_MS, requireEventMediaBridgeToken, observedBroadcastStateValidator, workerSessionArgs, } from "./_eventBroadcastInputs";
type Request = {
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
async function records(ctx: MutationCtx, args: Request, allowTerminal = false) {
    const session = await ctx.db.get(args.sessionId);
    if (session === null || session.eventId !== args.eventId)
        return null;
    const program = await ctx.db.get(session.programId);
    const event = await ctx.db.get(args.eventId);
    const terminal = ["ended", "error"].includes(session.status);
    if (program === null || event === null || program.eventId !== args.eventId || (program.activeSessionId !== session._id && !(allowTerminal && terminal)))
        return null;
    if (terminal && !allowTerminal)
        return null;
    return { session, program, event };
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
            const siblings = await ctx.db.query("eventMediaSessions").withIndex("by_eventId_status", q => q.eq("eventId", args.eventId)).collect();
            if (siblings.some(s => s._id !== session._id && !["ended", "error"].includes(s.status) && (s.leaseExpiresAt ?? 0) > now)) {
                return reject(ctx, args, "Another event session has an unexpired owner.");
            }
            await ctx.db.patch(session._id, { workerId: args.workerId, epoch, acquiredAt, leaseExpiresAt: expiresAt, status: "starting", updatedAt: now });
            await ctx.db.insert("eventMediaAuditEvents", { programId: program._id, eventId: args.eventId, sessionId: session._id, actorSurface: "worker", action: "worker_session_acquired", privateSummary: `Epoch ${epoch}.`, createdAt: now });
        }
        return { ...lease(session, epoch, acquiredAt, expiresAt), configuration: await configuration(ctx, found) };
    },
});
export const renewSession = mutation({
    args: workerSessionArgs,
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
        await attachPendingProgramCommands(ctx.db, args.sessionId);
        // Number any legacy commands without consuming an unused sequence.
        await allocateSessionCommandSequence(ctx.db, args.sessionId, false);
        const pending = await ctx.db.query("eventMediaCommands").withIndex("by_sessionId_sequence", q => q.eq("sessionId", args.sessionId)).collect();
        const commands = pending.filter(c => c.eventId === args.eventId && c.programId === found.program._id && ["queued", "claimed"].includes(c.status) && (c.availableAt ?? c.createdAt) <= now)
            .slice(0, EVENT_BROADCAST_COMMAND_BATCH);
        for (const command of commands) {
            await ctx.db.patch(command._id, { status: "claimed", claimedByWorkerId: args.workerId, claimedEpoch: args.epoch, claimedAt: now, updatedAt: now });
        }
        return { granted: true as const, epoch: args.epoch, commands: commands.map(c => ({ ...c, status: "claimed" as const, claimedEpoch: args.epoch, claimedByWorkerId: args.workerId })) };
    },
});
export const acknowledgeCommand = mutation({
    args: {
        ...workerSessionArgs, commandId: v.id("eventMediaCommands"), sequence: v.number(),
        outcome: v.union(v.literal("succeeded"), v.literal("failed")),
        observedSourceId: v.optional(v.union(v.id("eventMediaSources"), v.null())),
        observedSceneId: v.optional(v.union(v.id("eventMediaScenes"), v.null())),
        observedOutputId: v.optional(v.union(v.id("eventMediaOutputs"), v.null())),
        observedState: v.optional(observedBroadcastStateValidator),
    },
    handler: async (ctx, args) => {
        authenticate(args);
        const denied = async (reason: string) => ({ ...await reject(ctx, args, reason), accepted: false as const });
        if (!Number.isSafeInteger(args.sequence) || args.sequence < 1)
            return denied("Command sequence is invalid.");
        const found = await records(ctx, args, true);
        const now = Date.now();
        if (found === null || !owns(found.session, args, now))
            return denied("Session ownership is stale or expired.");
        const command = await ctx.db.get(args.commandId);
        if (command === null || command.sessionId !== args.sessionId || command.eventId !== args.eventId || command.programId !== found.program._id || command.sequence !== args.sequence) {
            return denied("Command does not belong to this session and sequence.");
        }
        if (command.status === args.outcome && command.acknowledgedEpoch === args.epoch && command.observedSourceId === args.observedSourceId && command.observedSceneId === args.observedSceneId && command.observedOutputId === args.observedOutputId && command.observedState === args.observedState) {
            return { accepted: true as const, duplicate: true };
        }
        if (["ended", "error"].includes(found.session.status))
            return denied("Session has already ended.");
        if (command.status !== "claimed" || command.claimedByWorkerId !== args.workerId || command.claimedEpoch !== args.epoch)
            return denied("Command was not claimed by this owner.");
        if (args.sequence <= (found.session.lastAcknowledgedSequence ?? 0))
            return denied("Command sequence has already been superseded.");
        const earlier = await ctx.db.query("eventMediaCommands").withIndex("by_sessionId_sequence", q => q.eq("sessionId", args.sessionId).lt("sequence", args.sequence)).collect();
        if (earlier.some(c => c.status === "claimed" || c.status === "queued"))
            return denied("An earlier command is still pending.");
        for (const [id, table] of [[args.observedSourceId, "source"], [args.observedSceneId, "scene"], [args.observedOutputId, "output"]] as const) {
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
        await ctx.db.patch(command._id, { status: args.outcome, acknowledgedEpoch: args.epoch, observedSourceId: args.observedSourceId, observedSceneId: args.observedSceneId, observedOutputId: args.observedOutputId, observedState: args.observedState, completedAt: now, updatedAt: now });
        const observed = args.outcome === "succeeded" ? {
            ...(args.observedSourceId === undefined ? {} : { currentSourceId: args.observedSourceId ?? undefined }),
            ...(args.observedSceneId === undefined ? {} : { currentSceneId: args.observedSceneId ?? undefined }),
        } : {};
        const observedState = args.outcome === "succeeded" ? args.observedState : undefined;
        const mode = command.commandType === "set_automatic_mode" ? "automatic" : ["switch_hold", "show_hold_scene"].includes(command.commandType) ? "hold" : ["hold_current", "switch_source", "switch_next", "next_slot", "switch_previous", "previous_slot"].includes(command.commandType) ? "manual" : undefined;
        await ctx.db.patch(args.sessionId, { ...(args.outcome === "succeeded" && mode ? { broadcastMode: mode } : {}), ...observed, ...(observedState === undefined ? {} : { status: observedState }), lastAcknowledgedSequence: args.sequence, updatedAt: now });
        if (args.outcome === "succeeded")
            await ctx.db.patch(found.program._id, { ...observed, ...(args.observedOutputId === undefined ? {} : { currentOutputId: args.observedOutputId ?? undefined }), ...(observedState === undefined ? {} : { state: observedState }), ...(["ended", "error"].includes(observedState ?? "") ? { activeSessionId: undefined } : {}), updatedAt: now });
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
            const stream = profile && canReadProfile("public", profile) ? resolveEventStream(eventProfileStreamChoices(profile), slot.selectedStreamId) : undefined;
            if (stream && !source) {
                const id = await ctx.db.insert("eventMediaSources", { programId: program._id, eventId: event._id, key: `slot-${slot._id}`, position: slot.position, type: "vrcdn_link", purpose: "program", state: "ready", label: slot.displayLabel, eventSlotId: slot._id, sourceProfileId: slot.personProfileId, profileProjection: true, projectionAvailable: true, publicUrl: stream.questUrl, createdAt: Date.now(), updatedAt: Date.now() });
                source = await ctx.db.get(id);
            }
            else if (source) {
                await ctx.db.patch(source._id, { publicUrl: stream?.questUrl, profileProjection: true, projectionAvailable: !!stream, sourceProfileId: slot.personProfileId, updatedAt: Date.now() });
                source = await ctx.db.get(source._id);
            }
        }
        else if (source && (source.profileProjection || source.sourceProfileId)) {
            await ctx.db.patch(source._id, { profileProjection: true, projectionAvailable: false, publicUrl: undefined, updatedAt: Date.now() });
            source = null;
        }
        if (!source && !slot.personProfileId)
            source = (await ctx.db.query("eventMediaSources").withIndex("by_programId_position", q => q.eq("programId", program._id)).take(65)).find(s => s.eventSlotId === slot._id && !s.profileProjection && !(s.sourceProfileId && s.key === `slot-${slot._id}`)) ?? null;
        slots.push({ slotKey: slot._id, sourceId: source?._id, startAt: slot.startAt, endAt: slot.endAt, available: source !== null && source.state !== "disabled" && source.projectionAvailable !== false && !!source.publicUrl });
    }
    const [sources, scenes, outputs] = await Promise.all([
        ctx.db.query("eventMediaSources").withIndex("by_programId_position", q => q.eq("programId", program._id)).take(EVENT_BROADCAST_MAX_SOURCES + 1),
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
        currentSourceId: session.currentSourceId ?? program.currentSourceId,
        currentSceneId: session.currentSceneId ?? program.currentSceneId,
        sessionDeadline: deadline, stopped: event.eventStatus !== "scheduled" || session.stopRequestedAt !== undefined,
        mode: session.broadcastMode ?? "automatic", policy: validateBroadcastPolicy({ ...program.broadcastPolicy, ...(process.env.VRDEX_EVENT_BROADCAST_SILENCE_CALIBRATED !== "true" ? { silence: undefined } : {}) }), slots,
        sources: sources.filter(s => s.eventId === event._id && s.state !== "disabled" && s.projectionAvailable !== false && (!s.eventSlotId || authored.some(slot => slot._id === s.eventSlotId))).map(s => ({ id: s._id, key: s.key, type: s.type, eventSlotId: s.eventSlotId, publicUrl: s.publicUrl, privateConfigRef: s.privateConfigRef })),
        scenes: scenes.filter(s => s.eventId === event._id).map(s => ({ id: s._id, key: s.key, type: s.type, sourceId: s.sourceId })),
        outputs: outputs.filter(o => o.eventId === event._id && ["ready", "active"].includes(o.state)).map(o => ({ id: o._id, key: o.key, type: o.type, credential: o.credential, vrcdnSetup: o.vrcdnSetup, twitchSetup:o.twitchSetup, simulcastEnabled:o.simulcastEnabled ?? false, compliance: o.compliance })),
    };
}
export const refreshConfiguration = mutation({ args: workerSessionArgs, handler: async (ctx, args) => {
        authenticate(args);
        const found = await records(ctx, args);
        if (!found || !owns(found.session, args, Date.now()))
            return reject(ctx, args, "Session ownership is stale or expired.");
        return { granted: true as const, serverNow: Date.now(), configuration: await configuration(ctx, found) };
    } });
export const observeProgram = mutation({ args: { ...workerSessionArgs, state: observedBroadcastStateValidator, outputMs: v.number(), publishing: v.boolean(), outputId: v.optional(v.id("eventMediaOutputs")), sourceId: v.optional(v.id("eventMediaSources")), mode: v.optional(v.union(v.literal("automatic"), v.literal("manual"), v.literal("hold"))) }, handler: async (ctx, args) => {
        authenticate(args);
        const found = await records(ctx, args);
        if (!found || !owns(found.session, args, Date.now()))
            return { ...await reject(ctx, args, "Session ownership is stale or expired."), accepted: false };
        if (["live", "hold"].includes(args.state) && (!args.publishing || !Number.isFinite(args.outputMs) || args.outputMs <= 0))
            throw new Error("Publishing progress is required.");
        if (args.sourceId) {
            const source = await ctx.db.get(args.sourceId);
            if (!source || source.eventId !== args.eventId || source.programId !== found.program._id || source.state === "disabled" || source.projectionAvailable === false)
                return { ...await reject(ctx, args, "Observed source is unavailable."), accepted: false };
        }
        if (args.outputId) {
            const output = await ctx.db.get(args.outputId);
            if (!output || output._id !== found.session.outputId || output.eventId !== args.eventId || !["ready", "active"].includes(output.state))
                return { ...await reject(ctx, args, "Observed output is unavailable."), accepted: false };
        }
        const terminal = ["ended", "error"].includes(args.state);
        if (found.session.status !== args.state || found.session.currentSourceId !== args.sourceId)
            await ctx.db.insert("eventMediaAuditEvents", { programId: found.program._id, eventId: args.eventId, sessionId: args.sessionId, actorSurface: "worker", action: "worker_program_observed", privateSummary: `${args.state}; encoded output ${args.outputMs}ms.`, createdAt: Date.now() });
        await ctx.db.patch(args.sessionId, { status: args.state, currentSourceId: args.sourceId, broadcastMode: args.mode ?? found.session.broadcastMode, health: { lastHeartbeatAt: Date.now() }, updatedAt: Date.now() });
        await ctx.db.patch(found.program._id, { state: args.state, currentSourceId: args.sourceId, ...(terminal ? { activeSessionId: undefined } : {}), updatedAt: Date.now() });
        return { accepted: true };
    } });
/** Reserve capacity transactionally before any ECS call. Ambiguous dispatches retain
 * capacity until an operator confirms the task stopped; never expire into duplicates. */
export const admitDispatch = mutation({ args: { bridgeToken: v.string(), eventId: v.id("events"), sessionId: v.id("eventMediaSessions"), dispatchId: v.string() }, handler: async (ctx, args) => {
        requireEventMediaBridgeToken(args.bridgeToken);
        const session = await ctx.db.get(args.sessionId);
        const program = session ? await ctx.db.get(session.programId) : null;
        if (!session || session.eventId !== args.eventId || program?.activeSessionId !== session._id || session.stopRequestedAt !== undefined || ["ended", "error"].includes(session.status))
            return { granted: false };
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
        await ctx.db.patch(session._id, { dispatchId: args.dispatchId, workerTaskStatus: "starting", updatedAt: Date.now() });
        return { granted: true };
    } });
export const recordDispatchedTask = mutation({ args: { bridgeToken: v.string(), sessionId: v.id("eventMediaSessions"), dispatchId: v.string(), taskArn: v.string(), taskDefinitionArn: v.string() }, handler: async (ctx, args) => {
        requireEventMediaBridgeToken(args.bridgeToken);
        const session = await ctx.db.get(args.sessionId);
        if (!session || session.dispatchId !== args.dispatchId)
            return { accepted: false };
        if (session.workerTaskId && session.workerTaskId !== args.taskArn)
            return { accepted: false };
        if (session.dispatchStopConfirmedAt !== undefined)
            return { accepted: true };
        await ctx.db.patch(session._id, { workerProvider: "aws_ecs", workerRuntime: "ecs-fargate", workerTaskId: args.taskArn, workerTaskDefinitionArn: args.taskDefinitionArn, workerTaskStatus: "starting", updatedAt: Date.now() });
        return { accepted: true };
    } });
export const recordProcessStatus = mutation({ args: { bridgeToken: v.string(), sessionId: v.id("eventMediaSessions"), taskArn: v.string(), stopped: v.boolean() }, handler: async (ctx, args) => {
        requireEventMediaBridgeToken(args.bridgeToken);
        const session = await ctx.db.get(args.sessionId);
        if (!session || session.workerTaskId !== args.taskArn)
            return { accepted: false };
        if (session.dispatchStopConfirmedAt !== undefined || (!session.dispatchId && session.workerTaskStatus === "stopped"))
            return { accepted: args.stopped };
        await ctx.db.patch(session._id, { ...(args.stopped ? { workerTaskCleanupPending: true, ...(session.dispatchId ? { dispatchStopConfirmedAt: Date.now() } : {}) } : {}), workerTaskStatus: args.stopped ? "stopped" : "running", ...(args.stopped && !['ended', 'error'].includes(session.status) ? { status: "error" as const, leaseExpiresAt: Date.now() } : {}), updatedAt: Date.now() });
        if (args.stopped) {
            const program = await ctx.db.get(session.programId);
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
  if(!o||o.eventId!==args.eventId||o.programId!==found.program._id||!["ready","active"].includes(o.state)||(o._id!==found.session.outputId&&!o.simulcastEnabled)||(d.destination==='twitch'?(o.type!=='external_rtmp'||!o.twitchSetup):(o.type!=='vrcdn'||!!o.twitchSetup))) return {accepted:false};
 }
 await ctx.db.patch(args.sessionId,{outputHealth:args.destinations,outputHealthObservedAt:Date.now()}); return {accepted:true};
}});
