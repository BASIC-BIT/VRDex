import assert from "node:assert/strict";
import { it } from "node:test";
import { actionableReceipt, safeCommandError } from "../../apps/web/src/lib/server/media-command-result";

it("reports an unadmitted refusal budget error without a durable operation ID", () => {
  const result = safeCommandError({ data: { code: "UPLOAD_REFUSAL_RECEIPT_LIMIT" } }, "caller-key");
  assert.equal(result.isError, true);
  assert.deepEqual(JSON.parse(result.content[0].text), { code: "UPLOAD_REFUSAL_RECEIPT_LIMIT" });
  assert.equal("structuredContent" in result, false);
  assert.equal(result.content[0].text.includes("caller-key"), false);
});

it("preserves exact operation identity for uncertain retry and separates stale contribution decisions", () => {
  const unknown = actionableReceipt({ operationId: "saved-key", operationState: "in_progress", resourceId: "submission" });
  assert.equal(unknown.operationId, "saved-key");
  assert.equal(unknown.nextAction, "retry_same_key");
  assert.equal(unknown.retryCategory, "uncertain");
  for (const code of ["contribution_changed", "selection_changed"]) {
    const refused = actionableReceipt({ operationId: "refused-operation", operationState: "refused", code });
    assert.equal(refused.nextAction, "inspect_current");
    assert.equal(refused.retryable, false);
  }
});
