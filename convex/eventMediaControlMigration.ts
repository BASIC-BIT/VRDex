import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { eventMediaSourceBroadcastInput } from "./_eventBroadcastSources";
import { availableSource, isControl } from "./_eventBroadcastControl";
import type { CommittedIntent } from "./_eventMediaControl";
const phases = [
  "eventMediaSources",
  "eventMediaSessions",
  "eventMediaCommands",
] as const;
const phaseValidator = v.union(...phases.map((p) => v.literal(p)));
/** Run with starts held and all provider tasks confirmed stopped. Each page
 * independently proves quiescence; retrying a page never revives old work. */
export const backfill = internalMutation({
  args: {
    phase: v.optional(phaseValidator),
    cursor: v.optional(v.union(v.string(), v.null())),
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    for (const status of [
      "scheduled",
      "starting",
      "live",
      "hold",
      "fallback",
      "stopping",
    ] as const) {
      if (
        await ctx.db
          .query("eventMediaSessions")
          .withIndex("by_status_updatedAt", (q) => q.eq("status", status))
          .first()
      )
        throw Error("Control migration requires no open sessions.");
    }
    if (
      await ctx.db
        .query("eventMediaSessions")
        .withIndex("by_dispatchStopConfirmedAt_dispatchId", (q) =>
          q
            .eq("dispatchStopConfirmedAt", undefined)
            .gt("dispatchId", undefined),
        )
        .first()
    )
      throw Error("Provider task stop must be confirmed before migration.");
    for (const status of ["starting", "running", "stopping"] as const)
      if (
        await ctx.db
          .query("eventMediaSessions")
          .withIndex("by_workerTaskStatus_stopConfirmation_task", (q) =>
            q
              .eq("workerTaskStatus", status)
              .eq("dispatchStopConfirmedAt", undefined),
          )
          .first()
      )
        throw Error("Provider task stop must be confirmed before migration.");
    for (const status of [undefined, "queued", "failed"] as const)
      if (
        await ctx.db
          .query("eventMediaSessions")
          .withIndex("by_workerTaskStatus_stopConfirmation_task", (q) =>
            q
              .eq("workerTaskStatus", status)
              .eq("dispatchStopConfirmedAt", undefined)
              .gt("workerTaskId", undefined),
          )
          .first()
      )
        throw Error("Provider task stop must be confirmed before migration.");
    const phase = args.phase ?? phases[0],
      batchSize = args.batchSize ?? 100;
    if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 100)
      throw Error("Migration batch size must be between 1 and 100.");
    const page = await ctx.db
      .query(phase)
      .paginate({ cursor: args.cursor ?? null, numItems: batchSize });
    for (const row of page.page) {
      if (phase === "eventMediaSources") {
        const source = await ctx.db.get(row._id as Id<"eventMediaSources">);
        if (!source) continue;
        const input = eventMediaSourceBroadcastInput(source);
        // Projection availability is deliberately not refreshed: removed links stay removed.
        if (input)
          await ctx.db.patch(source._id, {
            input,
            revision:
              Number.isSafeInteger(source.revision) && source.revision! > 0
                ? source.revision
                : 1,
          });
      } else if (phase === "eventMediaSessions") {
        const session = await ctx.db.get(row._id as Id<"eventMediaSessions">);
        if (!session || session.committedIntent) continue;
        let intent: CommittedIntent = { kind: "automatic" };
        if (session.broadcastMode === "hold") intent = { kind: "slate" };
        if (session.broadcastMode === "manual") {
          intent = { kind: "slate" };
          const source = session.currentSourceId
            ? await ctx.db.get(session.currentSourceId)
            : null;
          // Legacy revision 1 has not changed identity. Later revisions require recorded evidence.
          const revision =
            session.observedSourceRevision ??
            ((source?.revision ?? 1) === 1 ? 1 : undefined);
          if (
            source &&
            revision !== undefined &&
            (await availableSource(ctx.db, session, {
              kind: "source",
              mode: "manual",
              source: {
                sourceId: source._id,
                revision: revision!,
                slotKey: source.eventSlotId ?? `manual-${source._id}`,
              },
            }))
          )
            intent = {
              kind: "manual",
              sourceId: source._id,
              revision: revision!,
            };
        }
        await ctx.db.patch(session._id, {
          committedIntent: intent,
          intentSequence:
            session.intentSequence ?? session.lastAcknowledgedSequence ?? 0,
          pendingControlCommandId: undefined,
        });
      } else {
        const command = await ctx.db.get(row._id as Id<"eventMediaCommands">);
        if (
          command &&
          ["queued", "claimed"].includes(command.status) &&
          (isControl(command.commandType) ||
            command.commandType === "preview_source")
        )
          await ctx.db.patch(command._id, {
            status: "cancelled",
            controlOutcome: "superseded",
            completedAt: Date.now(),
            updatedAt: Date.now(),
          });
      }
    }
    const next = phases[phases.indexOf(phase) + 1];
    return {
      phase: page.isDone ? (next ?? phase) : phase,
      cursor: page.isDone ? null : page.continueCursor,
      done: page.isDone && !next,
      processed: page.page.length,
    };
  },
});
