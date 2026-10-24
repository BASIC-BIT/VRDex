import { v } from "convex/values";
import { mutation } from "./_generated/server";
import { requireActiveBrowserSessionSubject } from "./_browserSessionAuthority";
import { getMediaManageableEventBySlug, getOrCreateEventMediaProgram, recordEventMediaAuditEvent } from "./events";
import { videoPresetValidator } from "./_eventMediaControl";
import { parseMediaSettings } from "../workers/restream/broadcast-profiles.mjs";

export const configure = mutation({
  args: { currentSlug: v.string(), videoPreset: videoPresetValidator, audioBitrateKbps: v.union(v.literal(160), v.literal(320)) },
  handler: async (ctx, args) => {
    const { subject: actor } = await requireActiveBrowserSessionSubject(ctx);
    const { event } = await getMediaManageableEventBySlug(ctx, args.currentSlug, actor);
    const mediaSettings = parseMediaSettings(args);
    const now = Date.now();
    const programId = await getOrCreateEventMediaProgram(ctx.db, event, now);
    await ctx.db.patch(programId, { mediaSettings, updatedAt: now });
    await recordEventMediaAuditEvent(ctx.db, { programId, eventId: event._id, actor, action: "media_settings_configured", createdAt: now });
    return { programId, mediaSettings };
  },
});
