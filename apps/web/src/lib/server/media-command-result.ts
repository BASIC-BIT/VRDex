import {
  commandReceiptSchema,
  type CommandReceipt,
} from "@vrdex/api-contracts";

const codes = new Set([
  "BATCH_ACCOUNTING_INVALID",
  "BATCH_ALLOWANCE_ROWS",
  "BATCH_ALREADY_CREATED",
  "BATCH_APPEND_LIMIT",
  "BATCH_ATTEMPT_EXISTS",
  "BATCH_CAPACITY_EXCEEDED",
  "BATCH_DEPENDENCY_UNRESOLVED",
  "BATCH_INPUT_INVALID",
  "BATCH_ITEM_UNAVAILABLE",
  "BATCH_KIND_CHANGED",
  "BATCH_METADATA_LIMIT",
  "BATCH_PAGE_INVALID",
  "BATCH_REVISION_INVALID",
  "BATCH_REVISION_LIMIT",
  "BATCH_UNAVAILABLE",
  "CAPACITY_ALLOWANCE_CONFLICT",
  "UPLOAD_ACCOUNTING_INVALID",
  "UPLOAD_ACTOR_DENIED",
  "UPLOAD_BATCH_CONFLICT",
  "UPLOAD_BATCH_UNAVAILABLE",
  "UPLOAD_INPUT_INVALID",
  "UPLOAD_PROVENANCE_REQUIRED",

  "UPLOAD_DELEGATION_DENIED",
  "UPLOAD_CAPACITY_EXCEEDED",
  "CONTRIBUTION_CAPACITY_REVOKED",
  "CONTRIBUTION_INTAKE_PAUSED",
  "CONTRIBUTION_DEPLOYMENT_BYTES",
  "CONTRIBUTION_DEPLOYMENT_CONCURRENCY",
  "CONTRIBUTION_ACTOR_CONCURRENCY",
  "CONTRIBUTION_TARGET_CONCURRENCY",
  "PROFILE_CHANGED",
  "BATCH_TARGET_UNAVAILABLE",
  "UPLOAD_TARGET_DENIED",
  "UPLOAD_PLACEMENT_INVALID",
  "UPLOAD_DISABLED",
  "UPLOAD_COMPLETION_UNCERTAIN",
  "UPLOAD_ACQUISITION_RETRY",
  "UPLOAD_VALIDATION_FAILED",
  "UPLOAD_SOURCE_MISMATCH",
  "UPLOAD_TARGET_CHANGED",
  "UPLOAD_TARGET_UNAVAILABLE",
  "UPLOAD_EXPIRED",
  "UPLOAD_IDEMPOTENCY_CONFLICT",
  "UPLOAD_RESERVATION_EXCEEDED",
  "UPLOAD_UNAVAILABLE",
  "CONTRIBUTION_HOST_RATE",
  "CONTRIBUTION_ACTOR_OPEN_LIMIT",
  "CONTRIBUTION_TARGET_OPEN_LIMIT",
  "CONTRIBUTION_ROLLING_LIMIT",
  "CONTRIBUTION_BATCH_BYTES",
  "CONTRIBUTION_ACTOR_BYTES",
  "CONTRIBUTION_TARGET_BYTES",
  "CONTRIBUTION_GLOBAL_BYTES",
  "CONTRIBUTION_GLOBAL_PROCESSING",
  "CONTRIBUTION_ACTOR_PROCESSING",
  "CONTRIBUTION_TARGET_PROCESSING",
  "BATCH_CAPACITY",
  "BATCH_REVISION_CHANGED",
  "BATCH_TARGET_CHANGED",
  "BATCH_PAYLOAD_EXPIRED",
  "BATCH_ARCHIVED",
  "BATCH_DISABLED",
  "BATCH_DELEGATION_DENIED",
  "BATCH_ACTOR_DENIED",
  "MEDIA_DELEGATION_DENIED",
  "CONTRIBUTION_DELEGATION_DENIED",
  "BATCH_ATTEMPT_NOT_TERMINAL",
  "BATCH_CONFLICT",
  "SOURCE_PRIVATE",
  "SOURCE_UNSAFE",
  "NEEDS_REVIEW",
  "review_changed",
  "target_changed",
  "placement_changed",
  "idempotency_conflict",
  "independent_review_required",
  "already_decided",
  "expired",
  "target_unavailable",
  "decision_unavailable",
]);

export function actionableReceipt(receipt: CommandReceipt): CommandReceipt {
  if (receipt.operationState === "committed")
    return {
      ...receipt,
      retryable: false,
      retryCategory: "none",
      nextAction: "none",
    };
  if (receipt.operationState === "in_progress")
    return {
      ...receipt,
      retryable: true,
      retryCategory: "uncertain",
      nextAction: "retry_same_key",
      ...(receipt.code === "CONTRIBUTION_HOST_RATE"
        ? { retryAfterMs: 60000 }
        : {}),
    };
  const code = receipt.code ?? "";
  if (/DELEGATION|DENIED/.test(code))
    return {
      ...receipt,
      retryable: false,
      retryCategory: "authority",
      nextAction: "restore_access",
    };
  if (/LIMIT|CAPACITY|BYTES|PROCESSING|CONCURRENCY/.test(code))
    return {
      ...receipt,
      retryable: false,
      retryCategory: "capacity",
      nextAction: "wait_for_capacity",
    };
  if (/CHANGED|changed|already_decided/.test(code))
    return {
      ...receipt,
      retryable: false,
      retryCategory: "stale",
      nextAction: "inspect_current",
    };
  return {
    ...receipt,
    retryable: false,
    retryCategory: "validation",
    nextAction: "correct_input",
  };
}

export function safeCommandError(error: unknown, operationId: string) {
  const object = error && typeof error === "object" ? error : null;
  const data = object && "data" in object ? object.data : null;
  const raw =
    data && typeof data === "object" && "code" in data
      ? data.code
      : error instanceof Error
        ? error.message
        : undefined;
  const code =
    typeof raw === "string" && codes.has(raw) ? raw : "COMMAND_OUTCOME_UNKNOWN";
  const uncertain = [
    "COMMAND_OUTCOME_UNKNOWN",
    "UPLOAD_COMPLETION_UNCERTAIN",
    "UPLOAD_ACQUISITION_RETRY",
    "BATCH_ATTEMPT_NOT_TERMINAL",
    "decision_unavailable",
  ].includes(code);
  const result = actionableReceipt(
    commandReceiptSchema.parse({
      operationId: operationId.slice(0, 200) || "command",
      operationState: uncertain ? "in_progress" : "refused",
      code,
    }),
  );
  return {
    content: [{ type: "text" as const, text: JSON.stringify(result) }],
    structuredContent: result,
    isError: true as const,
  };
}
