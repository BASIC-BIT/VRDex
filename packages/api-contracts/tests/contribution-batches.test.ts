import assert from "node:assert/strict";
import { it } from "node:test";
import {
  contributionItemInputSchema,
  contributionBatchAppendSchema,
  contributionItemReviseSchema,
  localUploadRequestSchema,
  localUploadTargetSchema,
} from "../src/index";
it("bounds upload transfer capability fields and expiration", () => {
  const target = {
    intentId: "intent",
    expiresAt: Date.now() + 600000,
    transfer: {
      method: "POST",
      url: "https://bucket.example.test",
      fileField: "file",
      fields: { key: "quarantine" },
    },
  };
  assert.ok(localUploadTargetSchema.safeParse(target).success);
  for (const extra of [
    { expiresAt: Infinity },
    { expiresAt: -1 },
    { expiresAt: 1.5 },
    {
      transfer: {
        ...target.transfer,
        url: "https://example.test/" + "a".repeat(17000),
      },
    },
    {
      transfer: {
        ...target.transfer,
        fields: Object.fromEntries(
          Array.from({ length: 65 }, (_, i) => [String(i), "x"]),
        ),
      },
    },
    { transfer: { ...target.transfer, fields: { key: "x".repeat(33000) } } },
  ])
    assert.equal(
      localUploadTargetSchema.safeParse({ ...target, ...extra }).success,
      false,
    );
});
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
      sourceDescription: "Artist supplied original",
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

it("requires source URL or description for a local upload", () => {
  const input = {
    mode: "contributor" as const,
    profileId: "profile",
    expectedUpdatedAt: 1,
    placement: "profile_image" as const,
    contentType: "image/png" as const,
    byteLength: 1,
    sha256: "a".repeat(64),
    credit: "Artist",
    idempotencyKey: "upload",
  };
  assert.equal(localUploadRequestSchema.safeParse(input).success, false);
  assert.equal(localUploadRequestSchema.safeParse({ ...input, sourceUrl: "   " }).success, false);
  assert.equal(localUploadRequestSchema.safeParse({ ...input, sourceUrl: "https://artist.example/source" }).success, true);
  assert.equal(localUploadRequestSchema.safeParse({ ...input, sourceDescription: "Artist original" }).success, true);
  assert.equal(localUploadRequestSchema.safeParse({ ...input, sourceUrl: "", sourceDescription: "Artist original" }).success, true);
});
