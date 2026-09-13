import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createMcpMediaReviewHandlers,
  type MediaReviewDependencies,
} from "../../apps/web/src/lib/server/mcp-media-review";

const version = "a".repeat(64);
const candidate = new Uint8Array(Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
));

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
      contentSha256: "431ced6916a2a21a156e38701afe55bbd7f88969fbbfc56d7fe099d47f265460",
    },
    ...overrides,
  };
}

function dependencies(overrides: Partial<MediaReviewDependencies> = {}): MediaReviewDependencies {
  return {
    actorUserId: "user-1",
    now: () => 2_000,
    verifyContributorEmail: async () => true,
    query: async (name) => {
      if (name === "list") return { page: [detail()], continueCursor: "next", isDone: false };
      if (name === "candidate") {
        return { storageKey: "private/candidate.png", mimeType: "image/png", profileDisplayName: "Fixture" };
      }
      return detail();
    },
    mutate: async (name) => name === "withdraw"
      ? true
      : { operationId: "operation-1", operationState: "committed", resourceId: "submission-1" },
    readStoredObject: async () => ({ body: candidate, contentType: "image/png", contentLength: candidate.byteLength }),
    ...overrides,
  };
}

describe("MCP media review handlers", () => {
  it("reauthorizes protected reads and never trusts verification input", async () => {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    let verifications = 0;
    const handlers = createMcpMediaReviewHandlers(dependencies({
      verifyContributorEmail: async () => { verifications += 1; return true; },
      query: async (name, args) => { calls.push({ name, args }); return name === "candidate"
        ? { storageKey: "private/candidate.png", mimeType: "image/png", profileDisplayName: "Fixture" }
        : detail(); },
    }));

    await handlers.get({ submissionId: "submission-1" });
    await handlers.preview({ submissionId: "submission-1", expectedReviewVersion: version });

    assert.equal(verifications, 2);
    assert.equal(calls.every(({ args }) => args.emailVerified === true && args.emailVerificationAttestedAt === 2_000), true);
    assert.equal(calls.every(({ args }) => !("actorUserId" in args) || args.actorUserId === "user-1"), true);
  });

  it("returns native bounded image content tied to the requested review version", async () => {
    const handlers = createMcpMediaReviewHandlers(dependencies());
    const result = await handlers.preview({ submissionId: "submission-1", expectedReviewVersion: version });

    assert.equal(result.isError, undefined);
    assert.equal(result.content[0]?.type, "image");
    assert.equal(result.content[0]?.type === "image" ? result.content[0].mimeType : null, "image/png");
    assert.deepEqual(result.structuredContent, {
      submissionId: "submission-1",
      reviewVersion: version,
      profileDisplayName: "Fixture",
      mimeType: "image/png",
      byteLength: result.content[0]?.type === "image" ? Buffer.from(result.content[0].data, "base64").byteLength : 0,
    });
  });

  it("refuses a stale preview without reading stored bytes", async () => {
    let reads = 0;
    const handlers = createMcpMediaReviewHandlers(dependencies({
      readStoredObject: async () => { reads += 1; return null; },
    }));
    const result = await handlers.preview({ submissionId: "submission-1", expectedReviewVersion: "b".repeat(64) });

    assert.equal(result.isError, true);
    assert.equal(reads, 0);
    assert.match(result.content[0]?.type === "text" ? result.content[0].text : "", /changed/i);
  });

  it("does not emit bytes when the stored content hash differs from inspected detail", async () => {
    const handlers = createMcpMediaReviewHandlers(dependencies({
      readStoredObject: async () => ({ body: new Uint8Array([1, 2, 3]), contentType: "image/png", contentLength: 3 }),
    }));
    const result = await handlers.preview({ submissionId: "submission-1", expectedReviewVersion: version });

    assert.equal(result.isError, true);
    assert.equal(result.content.some((item) => item.type === "image"), false);
  });

  it("passes durable decision keys through unchanged on replay", async () => {
    const mutations: Record<string, unknown>[] = [];
    const receipt = { operationId: "operation-1", operationState: "committed" as const, resourceId: "submission-1" };
    const handlers = createMcpMediaReviewHandlers(dependencies({
      mutate: async (_name, args) => { mutations.push(args); return receipt; },
    }));
    const input = {
      submissionId: "submission-1",
      expectedReviewVersion: version,
      decision: "approve" as const,
      privateReason: "Source confirmed",
      idempotencyKey: "decision-key-1",
    };

    assert.deepEqual(await handlers.decide(input), await handlers.decide(input));
    assert.equal(mutations.length, 2);
    assert.equal(mutations[0]?.idempotencyKey, "decision-key-1");
    assert.equal(mutations[1]?.idempotencyKey, "decision-key-1");
  });

  it("keeps own withdrawal independent from reviewer email attestation", async () => {
    let verified = false;
    const handlers = createMcpMediaReviewHandlers(dependencies({
      verifyContributorEmail: async () => { verified = true; return false; },
    }));

    assert.deepEqual(await handlers.withdraw({ submissionId: "submission-1" }), {
      structuredContent: { withdrawn: true, submissionId: "submission-1" },
      content: [{ type: "text", text: JSON.stringify({ withdrawn: true, submissionId: "submission-1" }, null, 2) }],
    });
    assert.equal(verified, false);
  });
});
