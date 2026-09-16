import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";

/** Called in the event mutation transaction. Submitted writes are already committed
 * to execution and must never be disguised as cancelled or silently replayed. */
export async function syncClubEventOperations(
  ctx: MutationCtx,
  eventId: Id<"events">,
  forceCancel = false,
) {
  await syncClubEventOperationPage(ctx, { eventId, forceCancel, cursor: null }, true);
}
export async function syncClubEventOperationPage(
  ctx: MutationCtx,
  args: { eventId: Id<"events">; forceCancel: boolean; cursor: string | null },
  firstPass = false,
) {
  const event = await ctx.db.get(args.eventId);
  const now = Date.now();
  const query = ctx.db
    .query("clubOperations")
    .withIndex("by_event", (q) => q.eq("eventId", args.eventId));
  // Event import/fixture mutations can update several events. Each synchronous
  // hook uses a bounded read so it does not consume Convex's one pagination slot.
  // The continuation starts at the beginning and harmlessly revisits these rows.
  const initial = firstPass ? await query.take(101) : null;
  const page = initial
    ? { page: initial.slice(0, 100), isDone: initial.length <= 100, continueCursor: null }
    : await query.paginate({ numItems: 100, cursor: args.cursor });
  const hints = new Map<Id<"communityVrchatIntegrations">, number>();
  for (const job of page.page) {
    if (job.state !== "pending" && job.state !== "claimed") continue;
    if (
      args.forceCancel ||
      !event ||
      event.eventStatus === "cancelled" ||
      event.communityProfileId !== job.communityProfileId
    ) {
      await ctx.db.patch(job._id, {
        state: "cancelled",
        claim: undefined,
        code: !event ? "event_deleted" : "event_cancelled",
        completedAt: now,
        updatedAt: now,
      });
      continue;
    }
    if (job.schedule.kind !== "event_relative") continue;
    const dueAt = event.startAt + job.schedule.offsetMs;
    if (dueAt === job.dueAt) continue;
    // Clearing the claim invalidates any worker that fetched the old execution time.
    await ctx.db.patch(job._id, {
      state: "pending",
      claim: undefined,
      dueAt,
      readyAt: Math.max(dueAt, job.retryAt ?? 0),
      updatedAt: now,
    });
    hints.set(
      job.integrationId,
      Math.min(hints.get(job.integrationId) ?? dueAt, dueAt),
    );
  }
  for (const [id, dueAt] of hints) {
    const integration = await ctx.db.get(id);
    if (integration)
      await ctx.db.patch(id, {
        nextPollAt: Math.min(integration.nextPollAt ?? dueAt, dueAt),
      });
  }
  if (!page.isDone)
    await ctx.scheduler.runAfter(0, internal.clubOperations.syncEventSchedule, {
      ...args,
      cursor: page.continueCursor,
    });
}
