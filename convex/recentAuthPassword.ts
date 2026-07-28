import { retrieveAccount } from "@convex-dev/auth/server";
import { v } from "convex/values";

import { internal } from "./_generated/api";
import { action } from "./_generated/server";
import {
  generateRecentAuthProof,
  hashRecentAuthProof,
} from "./_recentAuthProof";

export const verify = action({
  args: {
    challengeId: v.string(),
    email: v.string(),
    password: v.string(),
  },
  handler: async (ctx, args) => {
    const email = args.email.trim().toLowerCase();
    if (!email || !args.password || !args.challengeId) {
      throw new Error("Recent authentication details are required.");
    }
    const caller = await ctx.runQuery(
      internal.recentAuthChallenges.validatePasswordVerification,
      { challengeId: args.challengeId },
    );
    if (caller.state !== "valid") {
      throw new Error("Recent authentication challenge is invalid.");
    }
    const { user } = await retrieveAccount(ctx, {
      provider: "password",
      account: { id: email, secret: args.password },
    });
    const proof = generateRecentAuthProof();
    if (user._id !== caller.userId) {
      throw new Error("Recent authentication challenge is invalid.");
    }
    const verified = await ctx.runMutation(
      internal.recentAuthChallenges.verifyPassword,
      {
        challengeId: args.challengeId,
        proofHash: await hashRecentAuthProof(proof),
        userId: user._id,
      },
    );
    if (verified.state !== "verified") {
      throw new Error("Recent authentication challenge is invalid.");
    }
    return { proof };
  },
});
