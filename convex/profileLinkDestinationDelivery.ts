"use node";

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { resolveProfileLinkDestination } from "../workers/group-telemetry/profile-link-destination.mjs";

/** One request per minute globally, with provider-wide cooldown on failures. */
export const refreshDiscord = internalAction({
  args: {dispatcherToken:v.optional(v.string())},
  handler: async (ctx, args): Promise<void> => {
    const claimed = await ctx.runMutation(internal.profileLinkDestinations.claimPending, {provider: "discord", limit: 1, dispatcherToken:args.dispatcherToken});
    for (const job of claimed.jobs) {
      const result = await resolveProfileLinkDestination(job);
      const status = result.status;
      if (status !== "resolved" && status !== "invalid" && status !== "inaccessible" && status !== "transient") continue;
      await ctx.runMutation(internal.profileLinkDestinations.recordResult, {
        key: job.key, leaseToken: job.leaseToken,
        result,
      });
    }
  },
});
