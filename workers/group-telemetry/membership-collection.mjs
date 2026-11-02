import { ClubProvider } from "./club-provider.mjs";
import { normalizeMembershipAuditPage } from "./membership-audit.mjs";

/** One durable audit page per leased poll, leaving other work a bounded request share. */
export async function collectMembershipPage({ assignment, authority, provider, control, expectedUserId, accountBudget, integrationBudget, requestBudgeted = false, clock = Date.now, shouldStop = () => false, deadline = clock() + 240_000, catchupEndAt = clock() - 60_000 }) {
  const now = clock();
  if (assignment.namedMembershipCollectionEnabled === false || !assignment.enabledFeatures?.includes("analytics") || !authority || authority.groupId !== assignment.vrchatGroupId ||
      authority.userId !== expectedUserId || authority.membershipStatus !== "member" ||
      now < authority.observedAt || now - authority.observedAt > 60_000 ||
      !authority.permissions.some(value => value === "*" || value === "group-audit-view")) return { collected: false };
  const stopped = () => shouldStop() || clock() >= deadline || clock() < authority.observedAt || clock() - authority.observedAt > 60_000;
  if (stopped()) return { collected: false };
  const scope = { integrationId: assignment.integrationId, fencingToken: assignment.fencingToken, epochStartedAt: assignment.epochStartedAt, groupId: assignment.vrchatGroupId };
  let scan = await control.send("membership_scan_resume", scope);
  if (stopped()) return { collected: false };
  if (!scan || scan.complete) {
    const startAt = Math.max(assignment.epochStartedAt, scan ? scan.endAt - 5 * 60_000 : assignment.epochStartedAt);
    const endAt = Math.min(catchupEndAt, startAt + 31 * 86400_000);
    if (endAt <= startAt || (scan && endAt <= scan.endAt)) return { collected: false };
    await control.send("membership_scan_begin", { ...scope, startAt, endAt });
    scan = await control.send("membership_scan_resume", scope);
  }
  if (!scan || scan.complete || stopped()) return { collected: false };
  if (scan.phase === "finalize") {
    await control.send("membership_scan_finalize", { ...scope, scanId: scan.scanId, pageNumber: scan.nextPage });
    return { collected: true };
  }
  if (!requestBudgeted) {
    const reservedAt = clock();
    const retryAfterMs = Math.max(accountBudget.retryAfterMs(1, reservedAt), integrationBudget.retryAfterMs(1, reservedAt));
    if (retryAfterMs > 0) return { collected: false, retryAt: reservedAt + retryAfterMs };
    const reservation = await control.send("budget", { integrationId: assignment.integrationId, fencingToken: assignment.fencingToken, requestCount: 1, now: reservedAt });
    if (!reservation?.granted) return { collected: false, ...(reservation?.reason !== "unavailable" && Number.isFinite(reservation?.retryAt) ? { retryAt: reservation.retryAt } : {}) };
    const sentAt = clock();
    if (stopped() || Math.floor(sentAt / 60_000) !== Math.floor(reservedAt / 60_000) ||
        !accountBudget.tryConsume(1, sentAt) || !integrationBudget.tryConsume(1, sentAt)) return { collected: false };
  }
  if (stopped()) return { collected: false };
  const result = await new ClubProvider({ client: provider, groupId: assignment.vrchatGroupId, expectedUserId, clock }).readPage("audit", {
    n: 100, offset: scan.nextOffset, startDate: new Date(scan.startAt).toISOString(), endDate: new Date(scan.endAt).toISOString(),
  });
  const events = normalizeMembershipAuditPage(result.items, { groupId: scope.groupId, startAt: scan.startAt, endAt: scan.endAt });
  await control.send("membership_scan_page", { ...scope, scanId: scan.scanId, pageNumber: scan.nextPage, phase: scan.phase, events, rawAuditIds: result.items.map(item => item.id), sourceCount: result.items.length, exhausted: result.nextOffset === null });
  return { collected: true };
}
