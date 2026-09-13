import assert from "node:assert/strict";
import { it } from "node:test";
import {
  reviewDecisionSchema,
  reviewPageRequestSchema,
} from "../src/media-review";
import { apiScopes } from "../src/auth";
import {
  dynamicMcpClientScopes,
  dynamicMcpResourceWriteScopes,
} from "../src/oauth";
it("bounds review decisions and rejects caller-selected identities and unknown fields", () => {
  const command = {
    submissionId: "submission",
    expectedReviewVersion: "version",
    decision: "approve",
    privateReason: "Verified",
    idempotencyKey: "receipt",
  };
  assert.equal(reviewDecisionSchema.safeParse(command).success, true);
  for (const invalid of [
    { ...command, actorUserId: "other" },
    { ...command, privateReason: "x".repeat(1001) },
    { ...command, idempotencyKey: "" },
    { ...command, expectedReviewVersion: "x".repeat(129) },
  ])
    assert.equal(reviewDecisionSchema.safeParse(invalid).success, false);
  assert.equal(
    reviewPageRequestSchema.safeParse({ cursor: null, limit: 40 }).success,
    true,
  );
  assert.equal(
    reviewPageRequestSchema.safeParse({ cursor: null, limit: 41 }).success,
    false,
  );
});
it("offers separate review read and decision delegation without contribution scope escalation", () => {
  assert.ok(apiScopes.includes("assets:review:read"));
  assert.ok(apiScopes.includes("assets:review:write"));
  assert.ok(dynamicMcpClientScopes.includes("assets:review:read"));
  assert.ok(dynamicMcpResourceWriteScopes.includes("assets:review:write"));
});
