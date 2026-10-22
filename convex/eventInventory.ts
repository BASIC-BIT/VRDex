import { paginationOptsValidator, type PaginationResult } from "convex/server";
import { v } from "convex/values";
import { query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireActiveBrowserSessionSubject } from "./_browserSessionAuthority";
import { managedCommunitiesForBrowser, canUpdateEvent } from "./events";
import { dateOnlyEventsEnabled } from "./_eventSchedule";
import { EventIntakePatchSchema } from "../packages/api-contracts/src/event-intake";
import { canReadProfile } from "./_profilePermissions";
import { canonicalInventoryRow, intakeInventoryRow, inventoryCriteria, inventoryPagination, matchesInventory, type InventoryRow, type InventorySource } from "./_eventInventory";

export const listPage = query({
  args: { view: v.union(v.literal("all"), v.literal("upcoming"), v.literal("drafts"), v.literal("past")), query: v.string(), timeZone: v.string(), asOf: v.number(), paginationOpts: paginationOptsValidator },
  handler: async (ctx, args): Promise<PaginationResult<InventoryRow>> => {
    const { user, subject } = await requireActiveBrowserSessionSubject(ctx);
    const criteria = inventoryCriteria(args);
    const communities = (await managedCommunitiesForBrowser(ctx, { includeNonPublic: true }))
      .sort((a, b) => a.profile._id < b.profile._id ? -1 : a.profile._id > b.profile._id ? 1 : 0);
    const sources: InventorySource[] = [
      { kind: "intake", key: "intake" },
      ...communities.map(({ profile }): InventorySource => ({ kind: "community", key: `community:${profile._id}`, profile })),
      { kind: "contributions", key: "contributions" },
    ];
    // This exact membership fingerprint is rebuilt from live authority, never from the cursor.
    const scope = JSON.stringify([user._id, subject, sources.map(source => source.key), criteria, dateOnlyEventsEnabled()]);
    const { source, native, wrap } = inventoryPagination(args.paginationOpts, scope, sources);
    if (source.kind === "intake") {
      const candidates = await ctx.db.query("eventIntakeDrafts")
        .withIndex("by_actor_updatedAt", q => q.eq("actorUserId", user._id)).order("desc").paginate(native);
      const page: InventoryRow[] = [];
      const now = Date.now();
      for (const draft of candidates.page) {
        if (draft.expiresAt <= now || draft.publishedReceiptId !== undefined) continue;
        const fields = EventIntakePatchSchema.parse(draft.fields);
        const profile = fields.communitySlug ? await ctx.db.query("profiles").withIndex("by_slug", q => q.eq("slug", fields.communitySlug ?? "")).unique() : null;
        const community = profile?.profileType === "community" && (canReadProfile("public", profile) || communities.some(entry => entry.profile._id === profile._id)) ? profile : null;
        const row = intakeInventoryRow(draft, community);
        if (matchesInventory(row, criteria)) page.push(row);
      }
      return wrap({ ...candidates, page });
    }
    const candidates = source.kind === "community"
      ? await ctx.db.query("events")
        .withIndex(dateOnlyEventsEnabled() ? "by_communityProfileId_sortAt" : "by_communityProfileId_startAt", q => q.eq("communityProfileId", source.profile._id)).order("desc").paginate(native)
      : await ctx.db.query("events").withIndex("by_contributorUserId", q => q.eq("contributorUserId", user._id)).order("desc").paginate(native);
    const page: InventoryRow[] = [];
    const managementByCommunity = new Map<Id<"profiles">, Promise<boolean>>();
    for (const event of candidates.page) {
      const communityId = event.communityProfileId;
      let managed = false;
      if (communityId && communities.some(entry => entry.profile._id === communityId)) {
        const permission = managementByCommunity.get(communityId) ?? canUpdateEvent(ctx.db, event, subject, user._id);
        managementByCommunity.set(communityId, permission);
        managed = await permission;
      }
      if (source.kind === "community" ? !managed : managed) continue;
      const community = source.kind === "community" ? source.profile : event.communityProfileId ? await ctx.db.get(event.communityProfileId) : null;
      const row = await canonicalInventoryRow({ db: ctx.db, event, community, managed });
      if (matchesInventory(row, criteria)) page.push(row);
    }
    return wrap({ ...candidates, page });
  },
});
