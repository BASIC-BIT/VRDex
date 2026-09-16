import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canEditOperation,
  operationReason,
} from "../../apps/web/src/app/account/communities/[slug]/club-operation-model";

test("dependent instance invitations display the backend creation failure reason", () => {
  assert.equal(
    operationReason("instance_creation_failed"),
    "Instance creation failed",
  );
});

test("editing another scheduled action requires both its operation permission and schedule permission", () => {
  const payload = {
    kind: "publish_post" as const,
    title: "Night",
    text: "Doors open",
    visibility: "group" as const,
    sendNotification: false,
  };
  const actor = {
    kind: "staff",
    permissions: ["publish_posts"],
    subject: { tokenIdentifier: "staff" },
  };
  assert.equal(canEditOperation(actor, payload, "staff"), true);
  assert.equal(canEditOperation(actor, payload, "other"), false);
  assert.equal(
    canEditOperation(
      { ...actor, permissions: ["manage_scheduled_actions"] },
      payload,
      "other",
    ),
    false,
  );
  assert.equal(
    canEditOperation(
      { ...actor, permissions: ["publish_posts", "manage_scheduled_actions"] },
      payload,
      "other",
    ),
    true,
  );
  assert.equal(
    canEditOperation(
      { ...actor, kind: "owner", permissions: [] },
      payload,
      "other",
    ),
    true,
  );
});
