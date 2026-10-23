import { v } from "convex/values";
import { mutation, type MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireActiveBrowserSessionSubject } from "./_browserSessionAuthority";
import { getMediaManageableEventBySlug, getOrCreateEventMediaProgram, recordEventMediaAuditEvent } from "./events";
import { EVENT_BROADCAST_MAX_SOURCES } from "./_eventBroadcastInputs";
import { parseBroadcastInputUrl, broadcastInputPublicUrl } from "./_eventBroadcastSources";
import { normalizeProfileInlineText } from "./_profileSubmissions";

function sourceLabel(value: string): string {
  const label = normalizeProfileInlineText(value);
  if (label.length < 1 || label.length > 120) throw new Error("Source label must be 1 to 120 characters.");
  return label;
}

async function sourceAuthority(ctx: MutationCtx, currentSlug: string, sourceId: Id<"eventMediaSources">) {
  const { subject: actor } = await requireActiveBrowserSessionSubject(ctx);
  const { event } = await getMediaManageableEventBySlug(ctx, currentSlug, actor);
  const source = await ctx.db.get(sourceId);
  if (!source || source.eventId !== event._id) throw new Error("Event source was not found.");
  const program = await ctx.db.get(source.programId);
  if (!program || program.eventId !== event._id || source.profileProjection || source.sourceProfileId || source.eventSlotId) throw new Error("Only custom event sources can be edited.");
  return { actor, event, source, program };
}

async function insertSource(ctx: MutationCtx, args: { currentSlug: string; label: string; url: string; sourceId?: Id<"eventMediaSources"> }) {
  const { subject: actor } = await requireActiveBrowserSessionSubject(ctx);
  const { event } = await getMediaManageableEventBySlug(ctx, args.currentSlug, actor);
  const input = parseBroadcastInputUrl(args.url);
  const label = sourceLabel(args.label);
  const previous = args.sourceId === undefined ? undefined : (await sourceAuthority(ctx, args.currentSlug, args.sourceId)).source;
  if (previous?.state === "disabled") throw new Error("Event source is disabled.");
  const now = Date.now();
  const programId = await getOrCreateEventMediaProgram(ctx.db, event, now);
  if (previous && previous.programId !== programId) throw new Error("Event source belongs to an old program.");
  const sources = await ctx.db.query("eventMediaSources").withIndex("by_programId_position", q => q.eq("programId", programId)).filter(q => q.neq(q.field("state"), "disabled")).take(EVENT_BROADCAST_MAX_SOURCES + 1);
  if (sources.length >= EVENT_BROADCAST_MAX_SOURCES) throw new Error("Event broadcast source limit reached.");
  const revision = (previous?.revision ?? (previous ? 1 : 0)) + 1;
  const sourceId = await ctx.db.insert("eventMediaSources", {
    programId, eventId: event._id, key: `custom-${crypto.randomUUID()}`, position: sources.reduce((max, source) => Math.max(max, source.position + 1), 0),
    type: input.kind === "vrcdn" ? "vrcdn_link" : "twitch_watch", purpose: "program", state: "ready", label, input, revision,
    publicUrl: broadcastInputPublicUrl(input), createdAt: now, updatedAt: now,
  });
  await recordEventMediaAuditEvent(ctx.db, { programId, eventId: event._id, sourceId, actor, action: previous ? "source_replaced" : "source_created", privateSummary: previous ? `Replaces ${previous._id}.` : undefined, createdAt: now });
  return { sourceId, revision };
}

export const create = mutation({ args: { currentSlug: v.string(), label: v.string(), url: v.string() }, handler: insertSource });
export const replace = mutation({ args: { currentSlug: v.string(), sourceId: v.id("eventMediaSources"), label: v.string(), url: v.string() }, handler: insertSource });
export const rename = mutation({
  args: { currentSlug: v.string(), sourceId: v.id("eventMediaSources"), label: v.string() },
  handler: async (ctx, args) => {
    const { actor, event, source } = await sourceAuthority(ctx, args.currentSlug, args.sourceId);
    if (source.state === "disabled") throw new Error("Event source is disabled.");
    const now = Date.now();
    await ctx.db.patch(source._id, { label: sourceLabel(args.label), updatedAt: now });
    await recordEventMediaAuditEvent(ctx.db, { programId: source.programId, eventId: event._id, sourceId: source._id, actor, action: "source_renamed", createdAt: now });
  },
});

export const remove = mutation({
  args: { currentSlug: v.string(), sourceId: v.id("eventMediaSources") },
  handler: async (ctx, args) => {
    const { actor, event, source, program } = await sourceAuthority(ctx, args.currentSlug, args.sourceId);
    if (source.state === "disabled") return;
    // Task 3 replaces this staging guard with atomic pending cancellation/active slate.
    const activeSession = await ctx.db.query("eventMediaSessions")
      .withIndex("by_programId_status", q => q.eq("programId", program._id))
      .filter(q => q.and(q.eq(q.field("currentSourceId"), source._id),
        q.neq(q.field("status"), "ended"), q.neq(q.field("status"), "error"), q.neq(q.field("status"), "cancelled")))
      .first();
    const pending = await Promise.all((["queued", "claimed"] as const).map(status => ctx.db.query("eventMediaCommands")
      .withIndex("by_programId_status_createdAt", q => q.eq("programId", program._id).eq("status", status))
      .filter(q => q.or(q.eq(q.field("targetSourceId"), source._id), q.eq(q.field("targetSourceKey"), source.key)))
      .first()));
    const programIsActive = ["starting", "live", "hold", "fallback", "stopping"].includes(program.state);
    if ((programIsActive && program.currentSourceId === source._id) || activeSession || pending.some(command => command !== null)) {
      throw new Error("Active or pending sources cannot be removed yet.");
    }
    const now = Date.now();
    await ctx.db.patch(source._id, { state: "disabled", updatedAt: now });
    await recordEventMediaAuditEvent(ctx.db, { programId: source.programId, eventId: event._id, sourceId: source._id, actor, action: "source_removed", createdAt: now });
  },
});
