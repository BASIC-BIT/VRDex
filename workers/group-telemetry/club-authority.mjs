import { ClubProvider } from "./club-provider.mjs";

/** Refresh connection readiness within the current integration lease and shared request budget. */
export async function refreshClubAuthority({ assignment, provider, control, expectedUserId, accountBudget, integrationBudget, clock = Date.now }) {
  if (assignment.state !== "active" || !Number.isFinite(assignment.epochStartedAt)) return { refreshed: false };
  const now = clock();
  if (accountBudget.retryAfterMs(2, now) > 0 || integrationBudget.retryAfterMs(2, now) > 0) return { refreshed: false };
  const lease = { integrationId: assignment.integrationId, fencingToken: assignment.fencingToken };
  const reservation = await control.send("budget", { ...lease, requestCount: 2, now });
  if (!reservation?.granted) return { refreshed: false };
  accountBudget.tryConsume(2, now);
  integrationBudget.tryConsume(2, now);
  const snapshot = await new ClubProvider({ client: provider, groupId: assignment.vrchatGroupId, expectedUserId, clock }).readAuthority();
  const { groupId, userId, ownerUserId, membershipStatus, permissions, observedAt } = snapshot;
  const recorded = await control.send("club_authority", {
    ...lease, epochStartedAt: assignment.epochStartedAt,
    authority: { groupId, userId, ownerUserId, membershipStatus, permissions, observedAt },
  });
  if (recorded?.recorded !== true) return { refreshed: false };
  return { refreshed: true, authority: { groupId, userId, ownerUserId, membershipStatus, permissions, observedAt } };
}
