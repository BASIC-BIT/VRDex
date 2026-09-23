import { ClubProvider } from "./club-provider.mjs";
import { VrchatProviderError } from "./vrchat-client.mjs";
import { budgetedClubProvider } from "./club-request-budget.mjs";

export async function executeClubOperation({ assignment, provider, control, expectedUserId, accountBudget, integrationBudget, pause, shouldStop, clock = Date.now, deadline = clock() + 240_000 }) {
  const scope = { integrationId: assignment.integrationId, fencingToken: assignment.fencingToken, epochStartedAt: assignment.epochStartedAt };
  const job = await control.send("club_operation_claim", scope);
  if (!job) return { processed: false };
  const executionDeadline = Math.min(deadline, job.executeBefore ?? deadline);
  const claim = { ...scope, operationId: job.operationId, nonce: job.nonce };
  // Authenticate first, then reserve the grant read and all remaining checks
  // together with the write. No refresh loop can consume the write's slot.
  const freshRequestCount = job.payload.kind === "invite_to_instance" ? 4 : job.payload.kind === "close_instance" ? 3 : 2;
  if (Math.min(accountBudget.limit, integrationBudget.limit, assignment.requestsPerMinute ?? Infinity) < freshRequestCount) {
    await control.send("club_operation_reject", { ...claim, code: "operation_budget_too_low" });
    return { processed: true, status: "rejected", code: "operation_budget_too_low" };
  }
  let evidence, submitted = false, transportAttempted = false;
  // This wrapper runs only after all budget/deadline guards, immediately before
  // transport. Authorization alone does not mean a provider write was attempted.
  const transport = { request(path, options) {
    if (options?.method && options.method !== "GET") transportAttempted = true;
    return provider.request(path, options);
  } };
  const client = budgetedClubProvider({ provider: transport, control, assignment, accountBudget, integrationBudget, pause, shouldStop, clock, deadline: executionDeadline,
    reservationSize: path => path === `/groups/${encodeURIComponent(assignment.vrchatGroupId)}?includeRoles=true` ? freshRequestCount : 1,
    beforeRequest: async (_path, options) => {
      if (!options?.method || options.method === "GET") return;
      if (!evidence) throw new VrchatProviderError("Missing operation preflight.", { status: 403, category: "provider_authority" });
      // Slow provider reads may still age the evidence. Defer the untouched job
      // instead of performing refresh reads with its reserved write capacity.
      if (clock() - evidence.authority.observedAt > 30_000 || (job.payload.kind === "invite_to_instance" && clock() - (evidence.eligibilityObservedAt ?? 0) > 30_000)) {
        throw new VrchatProviderError("Club operation preflight expired.", { category: "rate_limit" });
      }
      const { groupId, userId, ownerUserId, membershipStatus, permissions, observedAt } = evidence.authority;
      const authorization = await control.send("club_operation_authorize", { ...claim,
        authority: { groupId, userId, ownerUserId, membershipStatus, permissions, observedAt },
        ...(evidence.friendship ? { friendship: evidence.friendship } : {}),
      });
      if (authorization?.authorized !== true) throw new VrchatProviderError("Operation authorization denied.", { status: 403, category: "operation_denied" });
      submitted = true;
    },
  });
  const adapter = new ClubProvider({ client, groupId: assignment.vrchatGroupId, expectedUserId, clock });
  let outcome = await adapter.execute(job.payload, { onPreflight: value => { evidence = value; } });
  // Keep bounded provider failure metadata for the collector after recording
  // the job outcome. It is not part of the control-plane completion payload.
  const failure = {
    ...(outcome.httpStatus ? { httpStatus: outcome.httpStatus } : {}),
    ...(Number.isFinite(outcome.retryAfterMs) ? { retryAfterMs: outcome.retryAfterMs } : {}),
  };
  if (!submitted) {
    if (["timeout", "network", "rate_limit", "transient"].includes(outcome.code)) {
      const deferred = await control.send("club_operation_defer", { ...claim, code: outcome.code, retryAfterMs: outcome.retryAfterMs ?? 60_000 });
      return { processed: true, status: deferred?.retryAt ? "pending" : "rejected", code: outcome.code, ...failure };
    }
    await control.send("club_operation_reject", { ...claim, code: outcome.code ?? "preflight_failed" });
    return { processed: true, status: "rejected", code: outcome.code, ...failure };
  }
  if (!transportAttempted) {
    outcome = { status: "rejected", code: "submission_not_attempted" };
  }
  const result = {};
  if (outcome.status === "succeeded") {
    if (job.payload.kind === "create_instance") { result.worldId = outcome.result.worldId; result.instanceId = outcome.result.instanceId; }
    if (job.payload.kind === "publish_post" || job.payload.kind === "edit_post") result.postId = outcome.result.id;
  }
  await control.send("club_operation_complete", { ...claim, status: outcome.status,
    ...(outcome.code ? { code: outcome.code } : {}), ...(Object.keys(result).length ? { result } : {}),
  });
  return { processed: true, status: outcome.status, code: outcome.code, ...failure };
}
