import type { DatabaseReader } from "./_generated/server";
export async function relayOperationState(db: DatabaseReader) {
  return db
    .query("mediaRelayOperations")
    .withIndex("by_key", (q) => q.eq("key", "global"))
    .unique();
}
export async function relayEnabled(db: DatabaseReader) {
  return (
    process.env.MEDIA_RELAY_ENABLED === "true" &&
    (await relayOperationState(db))?.enabled === true
  );
}
