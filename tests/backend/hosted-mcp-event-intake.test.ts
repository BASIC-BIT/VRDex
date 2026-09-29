import assert from "node:assert/strict";
import { it } from "node:test";
import { convexTest } from "convex-test";
import schemaModule from "../../convex/schema";
import { internal } from "../../convex/_generated/api";
import { normalizeApiTokenScopes } from "../../convex/_apiTokens";

const schema = (schemaModule as unknown as { default?: typeof schemaModule }).default ?? schemaModule;
it("mints a contribution-only personal token for an unverified account", async () => {
  assert.deepEqual(normalizeApiTokenScopes(["events:contribute"] as never), ["events:contribute"]);
  const t = convexTest({ schema, modules: {
    "../../convex/_generated/api.ts": () => import("../../convex/_generated/api"),
    "../../convex/apiTokens.ts": () => import("../../convex/apiTokens"),
  } });
  const ownerUserId = await t.run(ctx => ctx.db.insert("users", { clerkUserId: "intake-unverified" }));
  const result = await t.mutation(internal.apiTokens.createDeveloperTokenForApiOwner, {
    ownerUserId, label: "Event intake", tokenPrefix: "vrdx_" + "a".repeat(24), verifierHash: "b".repeat(64), scopes: ["events:contribute"] as never,
  });
  assert.ok(result);
  const token = await t.run(ctx => ctx.db.query("apiTokens").first());
  assert.deepEqual(token?.scopes, ["events:contribute"]);
});
