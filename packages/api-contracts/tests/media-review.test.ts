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
import {
  reviewRebaseSchema,
  selectedReviewDecisionsSchema,
} from "../src/media-review";
it("bounds explicit selected decisions and refuses caller-controlled authority or filter approval", () => {
  const decision = {
    submissionId: "submission",
    expectedReviewVersion: "version",
    decision: "approve",
    privateReason: "Examined",
    idempotencyKey: "key",
  };
  assert.equal(
    selectedReviewDecisionsSchema.safeParse({
      decisions: Array(20).fill(decision),
    }).success,
    true,
  );
  for (const input of [
    { decisions: [] },
    { decisions: Array(21).fill(decision) },
    { status: "submitted" },
    { decisions: [{ ...decision, actorUserId: "admin" }] },
    { decisions: [{ ...decision, superAdmin: true }] },
  ])
    assert.equal(selectedReviewDecisionsSchema.safeParse(input).success, false);
  assert.equal(
    reviewRebaseSchema.safeParse({
      submissionId: "submission",
      expectedReviewVersion: "version",
      idempotencyKey: "key",
      reviewerUserId: "admin",
    }).success,
    false,
  );
});
import { decideSelectedReviews } from "../src/media-review";
it("retains an indeterminate lost response and replays the original key without another commit", async () => {
  const input = {
    decisions: [
      {
        submissionId: "one",
        expectedReviewVersion: "v1",
        decision: "approve",
        privateReason: "Viewed",
        idempotencyKey: "stable",
      },
    ],
  };
  const saved = new Map<
    string,
    { operationId: string; operationState: "committed"; resourceId: string }
  >();
  let writes = 0;
  const decide = async (command: { idempotencyKey: string }) => {
    const old = saved.get(command.idempotencyKey);
    if (old) return old;
    writes++;
    saved.set(command.idempotencyKey, {
      operationId: "authoritative",
      operationState: "committed",
      resourceId: "one",
    });
    throw new Error("Response lost after commit");
  };
  const uncertain = await decideSelectedReviews(input, decide);
  assert.equal(uncertain.receipts[0]?.operationState, "in_progress");
  assert.equal(uncertain.receipts[0]?.code, "decision_unavailable");
  const replay = await decideSelectedReviews(input, decide);
  assert.deepEqual(replay.receipts[0], saved.get("stable"));
  assert.equal(writes, 1);
  assert.equal(input.decisions[0]?.idempotencyKey, "stable");
});
