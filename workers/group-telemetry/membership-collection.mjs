import { ClubProvider } from "./club-provider.mjs";
import { normalizeMembershipAuditPage } from "./membership-audit.mjs";

/** One durable audit page per leased poll, leaving other work a bounded request share. */
export async function collectMembershipPage({ assignment, authority, provider, control, expectedUserId, accountBudget, integrationBudget, requestBudgeted = false, clock = Date.now }) {
  const now = clock();
  if (!assignment.enabledFeatures?.includes("analytics") || !authority || authority.groupId !== assignment.vrchatGroupId ||
      authority.userId !== expectedUserId || authority.membershipStatus !== "member" ||
      now < authority.observedAt || now - authority.observedAt > 60_000 ||
      !authority.permissions.some(value => value === "*" || value === "group-audit-view")) return { collected: false };
  const scope = { integrationId: assignment.integrationId, fencingToken: assignment.fencingToken, epochStartedAt: assignment.epochStartedAt, groupId: assignment.vrchatGroupId };
  let scan = await control.send("membership_scan_resume", scope);
  if (!scan || scan.complete) {
    const startAt = Math.max(assignment.epochStartedAt, scan ? scan.endAt - 5 * 60_000 : assignment.epochStartedAt);
    const endAt = Math.min(now - 60_000, startAt + 86400_000);
    if (endAt <= startAt || (scan && endAt <= scan.endAt)) return { collected: false };
    await control.send("membership_scan_begin", { ...scope, startAt, endAt });
    scan = await control.send("membership_scan_resume", scope);
  }
  if (!scan || scan.complete) return { collected: false };
  if (!requestBudgeted) {
    if (accountBudget.retryAfterMs(1, now) > 0 || integrationBudget.retryAfterMs(1, now) > 0) return { collected: false };
    if (!(await control.send("budget", { integrationId: assignment.integrationId, fencingToken: assignment.fencingToken, requestCount: 1, now }))?.granted) return { collected: false };
    accountBudget.tryConsume(1, now);
    integrationBudget.tryConsume(1, now);
  }
  const result = await new ClubProvider({ client: provider, groupId: assignment.vrchatGroupId, expectedUserId, clock }).readPage("audit", {
    n: 100, offset: scan.nextOffset, startDate: new Date(scan.startAt).toISOString(), endDate: new Date(scan.endAt).toISOString(),
  });
  const events = normalizeMembershipAuditPage(result.items, { groupId: scope.groupId, startAt: scan.startAt, endAt: scan.endAt });
  await control.send("membership_scan_page", { ...scope, scanId: scan.scanId, pageNumber: scan.nextPage, events, sourceCount: result.items.length, exhausted: result.nextOffset === null });
  return { collected: true };
}
