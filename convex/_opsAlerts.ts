import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import type { ActionCtx, DatabaseWriter, MutationCtx } from "./_generated/server";

export const OPS_ALERT_DEDUPE_MS = 6 * 3_600_000;
const DEFAULT_OPS_ALERT_EMAIL = "basic@basicbit.net";

const findAlert = (db: DatabaseWriter, key: string) => db.query("opsAlerts").withIndex("by_key", q => q.eq("key", key)).unique();
// A key is alerting from its last send until a resolution at or after that send.
const isAlerting = (row: Doc<"opsAlerts">) => row.resolvedAt === undefined || row.resolvedAt < row.lastSentAt;

/** True when an alert for `key` should send now: not alerting, or alerting for at least the dedupe window. */
export async function reserveOpsAlert(db: DatabaseWriter, key: string, now: number): Promise<boolean> {
  const row = await findAlert(db, key);
  if (row && isAlerting(row) && now - row.lastSentAt < OPS_ALERT_DEDUPE_MS) return false;
  if (row) await db.patch(row._id, { lastSentAt: now, resolvedAt: undefined });
  else await db.insert("opsAlerts", { key, lastSentAt: now });
  return true;
}

/** True when `key` was alerting and is now resolved. */
export async function markOpsResolved(db: DatabaseWriter, key: string, now: number): Promise<boolean> {
  const row = await findAlert(db, key);
  if (!row || !isAlerting(row)) return false;
  await db.patch(row._id, { resolvedAt: now });
  return true;
}

// A mutation cannot send email, so both paths reserve here and schedule the Node send; in a mutation the two commit with the caller.
async function scheduleSend(ctx: MutationCtx | ActionCtx, subject: string, body: string) {
  await ctx.scheduler.runAfter(0, internal.opsAlertEmail.send, {
    to: process.env.VRDEX_OPS_ALERT_EMAIL || DEFAULT_OPS_ALERT_EMAIL, subject: "[VRDex ops] " + subject, body,
  });
}

export async function notifyOps(ctx: MutationCtx | ActionCtx, alert: { key: string; subject: string; body: string }): Promise<void> {
  const reserved = "db" in ctx
    ? await reserveOpsAlert(ctx.db, alert.key, Date.now())
    : await ctx.runMutation(internal.opsAlerts.reserve, { key: alert.key });
  if (reserved) await scheduleSend(ctx, alert.subject, alert.body);
}

export async function resolveOps(ctx: MutationCtx | ActionCtx, key: string): Promise<void> {
  const now = Date.now();
  const resolved = "db" in ctx
    ? await markOpsResolved(ctx.db, key, now)
    : await ctx.runMutation(internal.opsAlerts.resolve, { key });
  if (resolved) await scheduleSend(ctx, "Resolved: " + key, `${key} resolved at ${new Date(now).toISOString()}.`);
}
