import assert from "node:assert/strict";
import { Readable } from "node:stream";
import type { IncomingMessage } from "node:http";
import { fetchProfileAssetSourceUrl } from "../../apps/web/src/lib/server/profile-asset-source-import";
import { describe, it } from "node:test";

import {
  createMcpMediaReviewHandlers,
  type MediaReviewDependencies,
} from "../../apps/web/src/lib/server/mcp-media-review";

const version = "a".repeat(64);
it("current preview checks the selected snapshot before fetch and blocks private redirects without fetching donor URLs", async () => {
  for (const changed of [false, true]) {
    const fetched: string[] = [];
    const handlers = createMcpMediaReviewHandlers(
      dependencies({
        query: async (name) =>
          name === "current"
            ? {
                profileDisplayName: "Fixture",
                reviewVersion: changed ? "changed" : version,
                sourceKind: "legacy",
                sourceUrl: "https://current.example/image",
              }
            : detail({
                currentImage: {
                  kind: "legacy",
                  url: "https://current.example/image",
                },
              }),
        readRemoteImage: async ({ sourceUrl }) => {
          const result = await fetchProfileAssetSourceUrl(sourceUrl, {
            resolveHostname: async () => [{ address: "93.184.216.34" }],
            requestPinnedSource: async (url) => {
              fetched.push(url.toString());
              const response = Readable.from([]) as IncomingMessage;
              response.statusCode = 302;
              response.headers = { location: "https://127.0.0.1/private" };
              return response;
            },
          });
          return { body: result.body, contentType: result.mimeType };
        },
      }),
    );
    const result = await handlers.preview({
      submissionId: "submission-1",
      expectedReviewVersion: version,
      target: "current",
    });
    assert.equal(result.isError, true);
    assert.deepEqual(fetched, changed ? [] : ["https://current.example/image"]);
    assert.doesNotMatch(JSON.stringify(result), /127\.0\.0\.1|private/);
  }
});
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
    mutate: async () => ({
      operationId: "operation-1",
      operationState: "committed",
      resourceId: "submission-1",
    }),
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

    const input = {
      submissionId: "submission-1",
      expectedReviewVersion: version,
      idempotencyKey: "withdraw-key",
    };
    const result = await handlers.withdraw(input);
    assert.equal(result.structuredContent?.operationState, "committed");
    assert.deepEqual(await handlers.withdraw(input), result);
    assert.equal(verified, false);
  });
});
import sharp from "sharp";
import { validateAndPrepareProfileAsset } from "../../apps/web/src/lib/server/profile-asset-validation";
it("renders distinct current and real prepared candidate renditions without fetching donor URLs", async () => {
  const prepared = await validateAndPrepareProfileAsset(candidate, "image/png");
  assert.notEqual(
    prepared.display.contentSha256,
    prepared.download.contentSha256,
  );
  const current = await sharp({
    create: { width: 8, height: 8, channels: 3, background: "red" },
  })
    .png()
    .toBuffer();
  const currentHash = createHash("sha256").update(current).digest("hex");
  const d = detail({
    currentImage: {
      kind: "managed",
      assetId: "current",
      contentSha256: currentHash,
    },
  });
  d.candidate.contentSha256 = prepared.download.contentSha256;
  const handlers = createMcpMediaReviewHandlers(
    dependencies({
      query: async (name) =>
        name === "candidate"
          ? {
              storageKey: "download",
              mimeType: "image/png",
              profileDisplayName: "Fixture",
            }
          : name === "current"
            ? {
                storageKey: "current",
                mimeType: "image/png",
                profileDisplayName: "Fixture",
                reviewVersion: version,
              }
            : d,
      readStoredObject: async (key) => ({
        body: key === "current" ? current : prepared.download.body,
        contentType: "image/png",
      }),
    }),
  );
  const a = await handlers.preview({
    submissionId: "submission-1",
    expectedReviewVersion: version,
  });
  const b = await handlers.preview({
    submissionId: "submission-1",
    expectedReviewVersion: version,
    target: "current",
  });
  assert.equal(a.content[0]?.type, "image");
  assert.equal(b.content[0]?.type, "image");
  assert.notDeepEqual(a.content, b.content);
});
it("bounds remote current previews to server-selected artwork and refuses changed or unavailable snapshots", async () => {
  for (const kind of ["legacy", "automatic"] as const) {
    const d = detail({
      currentImage: {
        kind,
        url:
          kind === "legacy"
            ? "https://current.example/image"
            : "/api/profile-link-artwork/group?v=1",
      },
    });
    const seen: string[] = [];
    let details = 0;
    for (const outcome of ["ok", "changed", "blocked"]) {
      details = 0;
      const h = createMcpMediaReviewHandlers(
        dependencies({
          query: async (name) =>
            name === "current"
              ? {
                  profileDisplayName: "Fixture",
                  reviewVersion: version,
                  sourceKind: kind,
                  sourceUrl: "https://current.example/image",
                  ...(kind === "automatic"
                    ? { artworkKey: "group", artworkKind: "vrchat_group" }
                    : {}),
                }
              : {
                  ...d,
                  reviewVersion:
                    ++details > 1 && outcome === "changed"
                      ? "changed"
                      : version,
                },
          readRemoteImage: async (input) => {
            seen.push(input.sourceUrl);
            if (outcome === "blocked") throw Error("private redirect details");
            return { body: candidate, contentType: "image/png" };
          },
          readStoredObject: async () => {
            throw Error("unexpected stored fetch");
          },
        }),
      );
      const result = await h.preview({
        submissionId: "submission-1",
        expectedReviewVersion: version,
        target: "current",
      });
      assert.equal(result.isError, outcome === "ok" ? undefined : true);
      assert.doesNotMatch(JSON.stringify(result), /private redirect details/);
    }
    assert.deepEqual(seen, Array(3).fill("https://current.example/image"));
    const absent = createMcpMediaReviewHandlers(
      dependencies({
        query: async () => detail({ currentImage: null }),
        readRemoteImage: async () => {
          throw Error("must not fetch");
        },
      }),
    );
    assert.equal(
      (
        await absent.preview({
          submissionId: "submission-1",
          expectedReviewVersion: version,
          target: "current",
        })
      ).isError,
      true,
    );
  }
});
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
  const handlers = createMcpMediaReviewHandlers(
    dependencies({
      mutate: async (name, args) => {
        mutations.push({ name, args });
        return { operationId: "receipt", operationState: "committed" };
      },
    }),
  );
  await handlers.get({ submissionId: "submission-1" });
  await handlers.preview({
    submissionId: "submission-1",
    expectedReviewVersion: version,
  });
  assert.equal(mutations.length, 0);
  await assert.rejects(
    handlers.declare({
      submissionId: "submission-1",
      expectedReviewVersion: version,
      idempotencyKey: "declaration",
    }),
  );
  await handlers.declare({
    submissionId: "submission-1",
    expectedReviewVersion: version,
    idempotencyKey: "declaration",
    identityConfirmed: true,
    attributionConfirmed: true,
    publicationPermitted: true,
    noKnownRestrictions: true,
  });
  assert.equal(mutations[0]?.name, "declare");
  assert.equal(mutations.length, 1);
  await handlers.publish({
    submissionId: "submission-1",
    expectedReviewVersion: version,
    idempotencyKey: "publication",
  });
  assert.equal(mutations[1]?.name, "publish");
  assert.equal(mutations[1]?.args.actorUserId, "user-1");
  await assert.rejects(
    handlers.publish({
      submissionId: "submission-1",
      expectedReviewVersion: version,
      idempotencyKey: "publication",
      actorUserId: "other",
    }),
  );
});
