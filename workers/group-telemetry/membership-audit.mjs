import { VrchatProviderError } from "./vrchat-client.mjs";

// https://raw.githubusercontent.com/vrchatapi/specification/main/openapi/components/schemas/GroupAuditLogEntry.yaml
// actorDisplayName identifies the actor, not necessarily the membership target.
export function normalizeMembershipAuditPage(items, { groupId, startAt, endAt }) {
  const invalid = () => { throw new VrchatProviderError("Malformed membership audit page.", { category: "schema_drift" }); };
  if (!Array.isArray(items) || items.length > 100 || !Number.isSafeInteger(startAt) || !Number.isSafeInteger(endAt) || endAt <= startAt) invalid();
  return items.flatMap(item => {
    if (!item || item.groupId !== groupId || typeof item.id !== "string" || !item.id || item.id.length > 200 ||
        typeof item.eventType !== "string" || !item.eventType || item.eventType.length > 200 || typeof item.created_at !== "string") invalid();
    const occurredAt = Date.parse(item.created_at);
    if (!Number.isSafeInteger(occurredAt)) invalid();
    // The provider's date filters may include the upper boundary; storage uses half-open ranges.
    if (occurredAt < startAt || occurredAt >= endAt) return [];
    return [{ auditId: item.id, eventType: item.eventType, occurredAt,
      ...(typeof item.targetId === "string" && /^usr_[0-9a-f-]{36}$/i.test(item.targetId) ? { targetUserId: item.targetId } : {}),
    }];
  });
}
