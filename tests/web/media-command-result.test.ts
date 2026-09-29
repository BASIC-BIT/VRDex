import assert from "node:assert/strict";
import { it } from "node:test";
import { safeCommandError } from "../../apps/web/src/lib/server/media-command-result";

it("reports an unadmitted refusal budget error without a durable operation ID", () => {
  const result = safeCommandError({ data: { code: "UPLOAD_REFUSAL_RECEIPT_LIMIT" } }, "caller-key");
  assert.equal(result.isError, true);
  assert.deepEqual(JSON.parse(result.content[0].text), { code: "UPLOAD_REFUSAL_RECEIPT_LIMIT" });
  assert.equal("structuredContent" in result, false);
  assert.equal(result.content[0].text.includes("caller-key"), false);
});
