import assert from "node:assert/strict";
import { it } from "node:test";
import {
  contributionItemInputSchema,
  contributionBatchAppendSchema,
  contributionItemReviseSchema,
  localUploadRequestSchema,
} from "../src/index";
it("bounds collection metadata, rejects unknown decisions, and requires exact target mappings", () => {
  const input = {
    kind: "profile_links",
    itemKey: "one",
    source: { description: "Public page", publication: "public_allowed" },
    profileId: "profile",
    expectedUpdatedAt: 1,
    links: [],
  };
  assert.ok(contributionItemInputSchema.safeParse(input).success);
  assert.equal(
    contributionItemInputSchema.safeParse({ ...input, approved: true }).success,
    false,
  );
  assert.equal(
    contributionBatchAppendSchema.safeParse({
      batchId: "batch",
      items: Array.from({ length: 51 }, () => input),
    }).success,
    false,
  );
  assert.equal(
    contributionItemReviseSchema.safeParse({
      batchId: "batch",
      itemKey: "one",
      expectedRevision: 6,
      item: input,
    }).success,
    false,
  );
  const media = {
    kind: "media",
    itemKey: "media",
    source: input.source,
    transport: "local",
    placement: "primary_logo",
    credit: "Artist",
    contentType: "image/png",
    byteLength: 10,
    sha256: "a".repeat(64),
  };
  assert.equal(contributionItemInputSchema.safeParse(media).success, false);
  assert.ok(
    contributionItemInputSchema.safeParse({ ...media, dependsOnItemKey: "one" })
      .success,
  );
  assert.equal(
    contributionItemInputSchema.safeParse({
      ...media,
      dependsOnItemKey: "media",
    }).success,
    false,
  );
  assert.equal(
    contributionItemInputSchema.safeParse({ ...media, profileId: "profile" })
      .success,
    false,
  );
  assert.ok(
    localUploadRequestSchema.safeParse({
      mode: "contributor",
      profileId: "profile",
      expectedUpdatedAt: 1,
      placement: "primary_logo",
      credit: "Artist",
      contentType: "image/png",
      byteLength: 10,
      sha256: "a".repeat(64),
      batchId: "batch",
      itemKey: "media",
      expectedItemRevision: 1,
      idempotencyKey: "upload",
    }).success,
  );
});
