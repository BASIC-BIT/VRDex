import { VrchatProviderError } from "./vrchat-client.mjs";

/** Reserve shared capacity, optionally for a bounded preflight, and charge each local request. */
export function budgetedClubProvider({ provider, control, assignment, accountBudget, integrationBudget, pause, beforeRequest, reservationSize = () => 1, shouldStop = () => false, clock = Date.now, deadline = clock() + 240_000 }) {
  let prepaid = 0, prepaidAt = 0;
  return { async request(path, options) {
    while (!shouldStop() && clock() < deadline) {
      const now = clock();
      if (prepaid && Math.floor(now / 60_000) !== Math.floor(prepaidAt / 60_000)) {
        throw new VrchatProviderError("Club preflight reservation expired.", { category: "rate_limit" });
      }
      const count = prepaid ? 1 : reservationSize(path, options);
      if (!Number.isInteger(count) || count < 1 || count > Math.min(accountBudget.limit, integrationBudget.limit)) {
        throw new VrchatProviderError("Club operation exceeds the configured request budget.", { category: "operation_budget_too_low" });
      }
      const localDelay = Math.max(accountBudget.retryAfterMs(count, now), integrationBudget.retryAfterMs(count, now));
      if (localDelay > 0) { await pause(Math.min(localDelay, deadline - now)); continue; }
      const reservation = prepaid ? { granted: true } : await control.send("budget", { integrationId: assignment.integrationId, fencingToken: assignment.fencingToken, requestCount: count, now });
      if (!reservation?.granted) {
        if (reservation?.reason === "unavailable") throw new VrchatProviderError("Collector unavailable.", { category: "rate_limit" });
        const delay = Number.isFinite(reservation?.retryAt) ? Math.max(1, reservation.retryAt - now) : 60_000;
        await pause(Math.min(delay, deadline - now));
        continue;
      }
      if (!prepaid) { prepaid = count; prepaidAt = now; }
      prepaid--;
      // Charge local sliding windows at each actual request, not at the earlier
      // shared reservation. Unused shared slots stay charged on failure.
      if (beforeRequest && (await beforeRequest(path, options, now))?.reservationExpired) continue;
      if (Math.floor(clock() / 60_000) !== Math.floor(prepaidAt / 60_000) || clock() >= deadline || shouldStop()) {
        throw new VrchatProviderError("Club request reservation expired before submission.", { category: "rate_limit" });
      }
      const sentAt = clock();
      if (!accountBudget.tryConsume(1, sentAt) || !integrationBudget.tryConsume(1, sentAt)) {
        throw new VrchatProviderError("Local request capacity changed before submission.", { category: "rate_limit" });
      }
      return provider.request(path, options);
    }
    throw new VrchatProviderError("Club request budget deadline elapsed.", { category: "rate_limit" });
  } };
}
