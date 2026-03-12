import { query } from "./_generated/server";

export const status = query({
  args: {},
  handler: async () => {
    return {
      backend: "convex",
      note: "Initial Convex backend bootstrap is active.",
      project: "vrdex",
      scope: "bootstrap",
      status: "ok",
    };
  },
});
