import type { Id } from "./_generated/dataModel";
import type { DatabaseWriter } from "./_generated/server";

/** Queue a product analytics event; the outbox cron delivers it to PostHog. */
export async function enqueueProductAnalytics(
  db: DatabaseWriter,
  row: { event: string; distinctId: string; properties: Record<string, unknown> },
): Promise<Id<"productAnalyticsOutbox">> {
  const now = Date.now();
  return await db.insert("productAnalyticsOutbox", {
    ...row,
    createdAt: now,
    attemptCount: 0,
    nextAttemptAt: now,
  });
}
