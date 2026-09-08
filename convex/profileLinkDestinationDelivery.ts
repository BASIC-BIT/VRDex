"use node";

import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { resolveProfileLinkDestination } from "../workers/group-telemetry/profile-link-destination.mjs";

/** One request per minute globally, with provider-wide cooldown on failures. */
export const refreshDiscord = internalAction({
  args: {},
  handler: async (ctx): Promise<void> => {
    const claimed = await ctx.runMutation(internal.profileLinkDestinations.claimPending, {provider: "discord", limit: 1});
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
