import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createMcpMediaReviewHandlers,
  type MediaReviewDependencies,
} from "../../apps/web/src/lib/server/mcp-media-review";

const version = "a".repeat(64);
const candidate = new Uint8Array(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  ),
);

function detail(overrides: Record<string, unknown> = {}) {
  return {
    submissionId: "submission-1",
    profileId: "profile-1",
    profileSlug: "fixture",
    profileDisplayName: "Fixture",
    profileIsPublic: true,
    profileType: "person",
    requestedPlacement: "profile_image",
    status: "submitted",
    sourceUrl: "https://source.example/image.png",
    credit: "Fixture creator",
    expiresAt: Date.now() + 60_000,
    targetProfileUpdatedAt: 1,
    currentProfileUpdatedAt: 1,
    createdAt: 1,
    updatedAt: 1,
    priorProposalCount: 0,
    priorProposalCountTruncated: false,
    canViewCandidate: true,
    canSuppress: false,
    reviewVersion: version,
    currentPlacement: null,
    currentAvatarImageUrl: null,
    currentAutomaticImageUrl: null,
    candidate: {
      rendition: { submissionId: "submission-1", kind: "stored_candidate" },
      sourceUrl: "https://source.example/image.png",
      credit: "Fixture creator",
      contentSha256:
        "431ced6916a2a21a156e38701afe55bbd7f88969fbbfc56d7fe099d47f265460",
    },
    ...overrides,
  };
}

function dependencies(
  overrides: Partial<MediaReviewDependencies> = {},
): MediaReviewDependencies {
  return {
    actorUserId: "user-1",
    now: () => 2_000,
    verifyContributorEmail: async () => true,
    query: async (name) => {
      if (name === "list")
        return { page: [detail()], continueCursor: "next", isDone: false };
      if (name === "candidate") {
        return {
          storageKey: "private/candidate.png",
          mimeType: "image/png",
          profileDisplayName: "Fixture",
        };
      }
      return detail();
    },
    mutate: async (name) =>
      name === "withdraw"
        ? true
        : {
            operationId: "operation-1",
            operationState: "committed",
            resourceId: "submission-1",
          },
    readStoredObject: async () => ({
      body: candidate,
      contentType: "image/png",
      contentLength: candidate.byteLength,
    }),
    ...overrides,
  };
}

describe("MCP media review handlers", () => {
  it("reauthorizes protected reads and never trusts verification input", async () => {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    let verifications = 0;
    const handlers = createMcpMediaReviewHandlers(
      dependencies({
        verifyContributorEmail: async () => {
          verifications += 1;
          return true;
        },
        query: async (name, args) => {
          calls.push({ name, args });
          return name === "candidate"
            ? {
                storageKey: "private/candidate.png",
                mimeType: "image/png",
                profileDisplayName: "Fixture",
              }
            : detail();
        },
      }),
    );

    await handlers.get({ submissionId: "submission-1" });
    await handlers.preview({
      submissionId: "submission-1",
      expectedReviewVersion: version,
    });

    assert.equal(verifications, 2);
    assert.equal(
      calls.every(
        ({ args }) =>
          args.emailVerified === true &&
          args.emailVerificationAttestedAt === 2_000,
      ),
      true,
    );
    assert.equal(
      calls.every(
        ({ args }) => !("actorUserId" in args) || args.actorUserId === "user-1",
      ),
      true,
    );
  });

  it("returns native bounded image content tied to the requested review version", async () => {
    const handlers = createMcpMediaReviewHandlers(dependencies());
    const result = await handlers.preview({
      submissionId: "submission-1",
      expectedReviewVersion: version,
    });

    assert.equal(result.isError, undefined);
    assert.equal(result.content[0]?.type, "image");
    assert.equal(
      result.content[0]?.type === "image" ? result.content[0].mimeType : null,
      "image/png",
    );
    assert.deepEqual(result.structuredContent, {
      submissionId: "submission-1",
      reviewVersion: version,
      profileDisplayName: "Fixture",
      mimeType: "image/png",
      byteLength:
        result.content[0]?.type === "image"
          ? Buffer.from(result.content[0].data, "base64").byteLength
          : 0,
    });
  });

  it("refuses a stale preview without reading stored bytes", async () => {
    let reads = 0;
    const handlers = createMcpMediaReviewHandlers(
      dependencies({
        readStoredObject: async () => {
          reads += 1;
          return null;
        },
      }),
    );
    const result = await handlers.preview({
      submissionId: "submission-1",
      expectedReviewVersion: "b".repeat(64),
    });

    assert.equal(result.isError, true);
    assert.equal(reads, 0);
    assert.match(
      result.content[0]?.type === "text" ? result.content[0].text : "",
      /changed/i,
    );
  });

  it("does not read stored bytes when detail or preview authority is denied", async () => {
    let reads = 0;
    const handlers = createMcpMediaReviewHandlers(
      dependencies({
        query: async () => {
          throw new Error("MEDIA_REVIEW_ACCESS_REQUIRED");
        },
        readStoredObject: async () => {
          reads += 1;
          return null;
        },
      }),
    );

    await assert.rejects(
      handlers.get({ submissionId: "submission-1" }),
      /MEDIA_REVIEW_ACCESS_REQUIRED/,
    );
    await assert.rejects(
      handlers.preview({
        submissionId: "submission-1",
        expectedReviewVersion: version,
      }),
      /MEDIA_REVIEW_ACCESS_REQUIRED/,
    );
    assert.equal(reads, 0);
  });

  it("does not emit bytes when the stored content hash differs from inspected detail", async () => {
    const handlers = createMcpMediaReviewHandlers(
      dependencies({
        readStoredObject: async () => ({
          body: new Uint8Array([1, 2, 3]),
          contentType: "image/png",
          contentLength: 3,
        }),
      }),
    );
    const result = await handlers.preview({
      submissionId: "submission-1",
      expectedReviewVersion: version,
    });

    assert.equal(result.isError, true);
    assert.equal(
      result.content.some((item) => item.type === "image"),
      false,
    );
  });

  it("passes durable decision keys through unchanged on replay", async () => {
    const mutations: Record<string, unknown>[] = [];
    const receipt = {
      operationId: "operation-1",
      operationState: "committed" as const,
      resourceId: "submission-1",
    };
    const handlers = createMcpMediaReviewHandlers(
      dependencies({
        mutate: async (_name, args) => {
          mutations.push(args);
          return receipt;
        },
      }),
    );
    const input = {
      submissionId: "submission-1",
      expectedReviewVersion: version,
      decision: "approve" as const,
      privateReason: "Source confirmed",
      idempotencyKey: "decision-key-1",
    };

    assert.deepEqual(
      await handlers.decide(input),
      await handlers.decide(input),
    );
    assert.equal(mutations.length, 2);
    assert.equal(mutations[0]?.idempotencyKey, "decision-key-1");
    assert.equal(mutations[1]?.idempotencyKey, "decision-key-1");
  });

  it("keeps own withdrawal independent from reviewer email attestation", async () => {
    let verified = false;
    const handlers = createMcpMediaReviewHandlers(
      dependencies({
        verifyContributorEmail: async () => {
          verified = true;
          return false;
        },
      }),
    );

    assert.deepEqual(
      await handlers.withdraw({ submissionId: "submission-1" }),
      {
        structuredContent: { withdrawn: true, submissionId: "submission-1" },
        content: [
          {
            type: "text",
            text: JSON.stringify(
              { withdrawn: true, submissionId: "submission-1" },
              null,
              2,
            ),
          },
        ],
      },
    );
    assert.equal(verified, false);
  });
});
import sharp from "sharp";
import { randomBytes, createHash } from "node:crypto";
it("adapts a high-entropy 2048-square stored JPEG to bounded PNG", async () => {
  const jpeg = await sharp(randomBytes(2048 * 2048 * 3), {
    raw: { width: 2048, height: 2048, channels: 3 },
  })
    .jpeg({ quality: 92 })
    .toBuffer();
  const hash = createHash("sha256").update(jpeg).digest("hex");
  assert.ok((await sharp(jpeg).png().toBuffer()).byteLength > 4 * 1024 * 1024);
  const d = detail();
  d.candidate.contentSha256 = hash;
  const handlers = createMcpMediaReviewHandlers(
    dependencies({
      query: async (name) =>
        name === "candidate"
          ? {
              storageKey: "quarantine/test.jpg",
              mimeType: "image/jpeg",
              profileDisplayName: "Fixture",
            }
          : d,
      readStoredObject: async () => ({ body: jpeg, contentType: "image/jpeg" }),
    }),
  );
  const result = await handlers.preview({
    submissionId: "submission-1",
    expectedReviewVersion: version,
  });
  assert.equal(result.isError, undefined);
  assert.equal(result.content[0]?.type, "image");
  const img = result.content[0];
  assert.ok(img?.type === "image");
  const bytes = Buffer.from(img.data, "base64");
  assert.ok(bytes.byteLength <= 4 * 1024 * 1024);
  const metadata = await sharp(bytes).metadata();
  assert.equal(metadata.format, "png");
  assert.ok(metadata.width! < 2048);
});
it("selected decisions transact separately, preserve order and snapshot only explicit inputs", async () => {
  const calls: string[] = [];
  const handlers = createMcpMediaReviewHandlers(
    dependencies({
      mutate: async (_name, args) => {
        calls.push(String(args.submissionId));
        if (args.submissionId === "bad") throw new Error("no access");
        return {
          operationId: String(args.idempotencyKey),
          operationState: "committed",
          resourceId: String(args.submissionId),
        };
      },
    }),
  );
  const one = {
    submissionId: "one",
    expectedReviewVersion: version,
    decision: "approve",
    privateReason: "Examined",
    idempotencyKey: "one",
  };
  const input = {
    decisions: [one, { ...one, submissionId: "bad", idempotencyKey: "bad" }],
  };
  const pending = handlers.decideSelected(input);
  input.decisions.push({ ...one, submissionId: "appended" });
  const result = await pending;
  assert.deepEqual(calls, ["one", "bad"]);
  assert.deepEqual(
    (
      result.structuredContent?.receipts as Array<{ operationState: string }>
    ).map((x) => x.operationState),
    ["committed", "in_progress"],
  );
  await assert.rejects(handlers.decideSelected({ decisions: [] }));
  await assert.rejects(
    handlers.decideSelected({ decisions: Array(21).fill(one) }),
  );
  await assert.rejects(handlers.decideSelected({ status: "submitted" }));
});

it("declares evidence and publishes only through separate explicit commands", async () => {
  const mutations: Array<{ name: string; args: Record<string, unknown> }> = [];
  const handlers = createMcpMediaReviewHandlers(dependencies({ mutate: async (name, args) => {
    mutations.push({ name, args }); return { operationId: "receipt", operationState: "committed" };
  } }));
  await handlers.get({ submissionId: "submission-1" });
  await handlers.preview({ submissionId: "submission-1", expectedReviewVersion: version });
  assert.equal(mutations.length, 0);
  await assert.rejects(handlers.declare({ submissionId: "submission-1", expectedReviewVersion: version, idempotencyKey: "declaration" }));
  await handlers.declare({ submissionId: "submission-1", expectedReviewVersion: version, idempotencyKey: "declaration",
    identityConfirmed: true, attributionConfirmed: true, publicationPermitted: true, noKnownRestrictions: true });
  assert.equal(mutations[0]?.name, "declare"); assert.equal(mutations.length, 1);
  await handlers.publish({ submissionId: "submission-1", expectedReviewVersion: version, idempotencyKey: "publication" });
  assert.equal(mutations[1]?.name, "publish"); assert.equal(mutations[1]?.args.actorUserId, "user-1");
  await assert.rejects(handlers.publish({ submissionId: "submission-1", expectedReviewVersion: version, idempotencyKey: "publication", actorUserId: "other" }));
});
