import { mutation } from "./_generated/server";
import { ensureUser } from "./_identity";

/**
 * Called by the web app once per authenticated page load. Provisioning the
 * `users` row on demand keeps Clerk as the only identity source without a
 * webhook endpoint to expose, verify, and make replay-safe.
 */
export const ensureCurrentUser = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await ensureUser(ctx);

    return { id: user._id };
  },
});
