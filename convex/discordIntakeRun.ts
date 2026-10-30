"use node";

import { v } from "convex/values";
import { internalAction } from "./_generated/server";

/** Runs one author's settled messages through the intake agent. Body lands with the run pipeline. */
export const runPending = internalAction({
  args: { runId: v.id("discordIntakeRuns") },
  returns: v.null(),
  handler: async () => null,
});
