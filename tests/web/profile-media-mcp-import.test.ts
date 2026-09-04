import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { describe, it } from "node:test";

function runImportProbe(script: string) {
  return execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      TSX_TSCONFIG_PATH: "apps/web/tsconfig.json",
    },
  });
}

describe("hosted MCP profile media import cleanup", () => {
  it("deletes staged objects and releases the lease after definitive finalization rejection", () => {
    const output = runImportProbe(`
      import { ConvexError } from "convex/values";
      import { completeMcpProfileMediaImport } from "./apps/web/src/lib/server/profile-media-mcp-import.ts";

      let mutationCount = 0;
      let queryCount = 0;
      let released = false;
      const deleted = [];
      const written = [];
      let errorData = null;

      try {
        await completeMcpProfileMediaImport("intent_123", {
          isStorageConfigured: () => true,
          adminConvex: {
            mutation: async () => {
              mutationCount += 1;
              if (mutationCount === 1) {
                return {
                  status: "claimed",
                  intentId: "intent_123",
                  sourceUrl: "https://media.example.test/photo.png",
                  sourceStorageKey: "private/source.png",
                  downloadStorageKey: "private/download.png",
                  storageKey: "private/display.webp",
                };
              }
              if (mutationCount === 2) {
                throw new ConvexError({ code: "MCP_MEDIA_INVALID" });
              }
              released = true;
              return true;
            },
            query: async () => {
              queryCount += 1;
              return queryCount === 1 ? false : { state: "pending" };
            },
          },
          fetchSource: async () => ({
            body: new Uint8Array([1, 2, 3]),
            mimeType: "image/png",
          }),
          prepareAsset: async () => ({
            source: {
              body: new Uint8Array([1]),
              mimeType: "image/png",
              contentSha256: "source-hash",
            },
            download: {
              body: new Uint8Array([2]),
              mimeType: "image/png",
              contentSha256: "download-hash",
            },
            display: {
              body: new Uint8Array([3]),
              mimeType: "image/webp",
              width: 10,
              height: 10,
            },
          }),
          putObject: async (object) => { written.push(object.storageKey); },
          deleteObjects: async (storageKeys) => { deleted.push(...storageKeys); },
        });
      } catch (error) {
        errorData = typeof error === "object" && error !== null && "data" in error
          ? error.data
          : String(error);
      }

      console.log(JSON.stringify({ deleted, errorData, mutationCount, queryCount, released, written }));
    `);
    const result = JSON.parse(output) as {
      deleted: string[];
      errorData: { code?: string } | string | null;
      mutationCount: number;
      queryCount: number;
      released: boolean;
      written: string[];
    };

    assert.deepEqual(result.written, [
      "private/source.png",
      "private/download.png",
      "private/display.webp",
    ]);
    assert.deepEqual(result.deleted, result.written, JSON.stringify(result));
    assert.equal(result.released, true);
    assert.equal(result.mutationCount, 3);
    assert.equal(result.queryCount, 2);
    assert.deepEqual(result.errorData, { code: "MCP_MEDIA_INVALID" });
  });

  it("imports a contribution into the private submission lifecycle", () => {
    const output = runImportProbe(`
      import { completeMcpProfileMediaSubmissionImport } from "./apps/web/src/lib/server/profile-media-mcp-import.ts";

      let mutationCount = 0;
      const written = [];
      const result = await completeMcpProfileMediaSubmissionImport("intent_456", {
        isStorageConfigured: () => true,
        adminConvex: {
          mutation: async () => {
            mutationCount += 1;
            if (mutationCount === 1) return {
              status: "claimed",
              intentId: "intent_456",
              sourceUrl: "https://media.example.test/photo.png",
              sourceStorageKey: "private/source.png",
              downloadStorageKey: "private/download.png",
              storageKey: "private/display.webp",
            };
            return {
              submissionId: "submission_123",
              profileSlug: "community-dj",
              profileDisplayName: "Community DJ",
              requestedPlacement: "profile_image",
              status: "submitted",
              createdAt: 1,
              updatedAt: 2,
            };
          },
          query: async () => false,
        },
        fetchSource: async () => ({ body: new Uint8Array([1]), mimeType: "image/png" }),
        prepareAsset: async () => ({
          source: { body: new Uint8Array([1]), mimeType: "image/png", contentSha256: "source-hash" },
          download: { body: new Uint8Array([2]), mimeType: "image/png", contentSha256: "download-hash" },
          display: { body: new Uint8Array([3]), mimeType: "image/webp", width: 10, height: 10 },
        }),
        putObject: async (object) => { written.push(object.storageKey); },
        deleteObjects: async () => {},
      });

      console.log(JSON.stringify({ mutationCount, result, written }));
    `);
    const result = JSON.parse(output) as {
      mutationCount: number;
      result: { replayed: boolean; submission: { status: string; submissionId: string } };
      written: string[];
    };

    assert.equal(result.mutationCount, 2);
    assert.equal(result.result.replayed, false);
    assert.equal(result.result.submission.status, "submitted");
    assert.equal(result.result.submission.submissionId, "submission_123");
    assert.deepEqual(result.written, [
      "private/source.png",
      "private/download.png",
      "private/display.webp",
    ]);
  });

  it("recovers a committed submission after an uncertain finalization response", () => {
    const output = runImportProbe(`
      import { completeMcpProfileMediaSubmissionImport } from "./apps/web/src/lib/server/profile-media-mcp-import.ts";

      let mutationCount = 0;
      let deleted = false;
      const submission = {
        submissionId: "submission_123",
        profileSlug: "community-dj",
        profileDisplayName: "Community DJ",
        requestedPlacement: "profile_image",
        status: "submitted",
        createdAt: 1,
        updatedAt: 2,
      };
      const result = await completeMcpProfileMediaSubmissionImport("intent_789", {
        isStorageConfigured: () => true,
        adminConvex: {
          mutation: async () => {
            mutationCount += 1;
            if (mutationCount === 1) return {
              status: "claimed",
              intentId: "intent_789",
              sourceUrl: "https://media.example.test/photo.png",
              storageKey: "private/display.webp",
            };
            throw new Error("transport ended after commit");
          },
          query: async (_query, args) => "contentSha256" in args
            ? false
            : {
                intentState: "uploaded",
                leaseMatches: false,
                storageKey: "private/display.webp",
                submission,
              },
        },
        fetchSource: async () => ({ body: new Uint8Array([1]), mimeType: "image/png" }),
        prepareAsset: async () => ({
          source: { body: new Uint8Array([1]), mimeType: "image/png", contentSha256: "source-hash" },
          download: { body: new Uint8Array([2]), mimeType: "image/png", contentSha256: "download-hash" },
          display: { body: new Uint8Array([3]), mimeType: "image/webp", width: 10, height: 10 },
        }),
        putObject: async () => {},
        deleteObjects: async () => { deleted = true; },
      });
      console.log(JSON.stringify({ deleted, mutationCount, result }));
    `);
    const result = JSON.parse(output) as {
      deleted: boolean;
      mutationCount: number;
      result: { replayed: boolean; submission: { status: string; submissionId: string } };
    };

    assert.equal(result.mutationCount, 2);
    assert.equal(result.deleted, false);
    assert.equal(result.result.replayed, true);
    assert.equal(result.result.submission.status, "submitted");
    assert.equal(result.result.submission.submissionId, "submission_123");
  });

  it("keeps a live finalization lease indeterminate after a transport failure", () => {
    const output = runImportProbe(`
      import { completeMcpProfileMediaSubmissionImport } from "./apps/web/src/lib/server/profile-media-mcp-import.ts";

      let mutationCount = 0;
      let deleted = false;
      let outcome = null;
      try {
        await completeMcpProfileMediaSubmissionImport("intent_999", {
          isStorageConfigured: () => true,
          adminConvex: {
            mutation: async () => {
              mutationCount += 1;
              if (mutationCount === 1) return {
                status: "claimed",
                intentId: "intent_999",
                sourceUrl: "https://media.example.test/photo.png",
                storageKey: "private/display.webp",
              };
              throw new Error("transport ended after maybe committing");
            },
            query: async (_query, args) => {
              if ("contentSha256" in args) return false;
              return {
                intentState: "pending",
                leaseMatches: true,
                storageKey: "private/display.webp",
                submission: {
                  submissionId: "submission_123",
                  profileSlug: "community-dj",
                  profileDisplayName: "Community DJ",
                  requestedPlacement: "profile_image",
                  status: "upload_pending",
                  createdAt: 1,
                  updatedAt: 1,
                },
              };
            },
          },
          fetchSource: async () => ({ body: new Uint8Array([1]), mimeType: "image/png" }),
          prepareAsset: async () => ({
            source: { body: new Uint8Array([1]), mimeType: "image/png", contentSha256: "source-hash" },
            download: { body: new Uint8Array([2]), mimeType: "image/png", contentSha256: "download-hash" },
            display: { body: new Uint8Array([3]), mimeType: "image/webp", width: 10, height: 10 },
          }),
          putObject: async () => {},
          deleteObjects: async () => { deleted = true; },
        });
      } catch (error) {
        outcome = error?.outcome ?? null;
      }
      console.log(JSON.stringify({ deleted, mutationCount, outcome }));
    `);
    const result = JSON.parse(output) as {
      deleted: boolean;
      mutationCount: number;
      outcome: string | null;
    };

    assert.equal(result.mutationCount, 2);
    assert.equal(result.deleted, false);
    assert.equal(result.outcome, "indeterminate");
  });

  it("refuses cleanup and reports indeterminate after losing the processing lease", () => {
    const output = runImportProbe(`
      import { completeMcpProfileMediaSubmissionImport } from "./apps/web/src/lib/server/profile-media-mcp-import.ts";

      let mutationCount = 0;
      let deleteCalled = false;
      let failure = null;
      try {
        await completeMcpProfileMediaSubmissionImport("intent_lost_lease", {
          isStorageConfigured: () => true,
          adminConvex: {
            mutation: async () => {
              mutationCount += 1;
              if (mutationCount === 1) return {
                status: "claimed",
                intentId: "intent_lost_lease",
                sourceUrl: "https://media.example.test/photo.png",
                storageKey: "private/lost-lease/display.webp",
              };
              // A resumed worker holds the lease now, so the failure cannot be
              // recorded against this token.
              return false;
            },
            query: async () => false,
          },
          fetchSource: async () => ({ body: new Uint8Array([1]), mimeType: "image/png" }),
          prepareAsset: async () => {
            throw new Error("Profile media validation failed for the candidate image.");
          },
          putObject: async () => {},
          deleteObjects: async () => { deleteCalled = true; },
        });
      } catch (error) {
        failure = { code: error?.code ?? null, outcome: error?.outcome ?? null };
      }
      console.log(JSON.stringify({ deleteCalled, failure, mutationCount }));
    `);

    // The candidate objects now belong to whoever owns the lease. Deleting them
    // here would delete a live import's staged bytes.
    assert.deepEqual(JSON.parse(output), {
      deleteCalled: false,
      failure: { code: "MCP_MEDIA_IMPORT_REJECTED", outcome: "indeterminate" },
      mutationCount: 2,
    });
  });

  it("returns stage-specific source, validation, and storage refusal codes", () => {
    const output = runImportProbe(`
      import { completeMcpProfileMediaSubmissionImport } from "./apps/web/src/lib/server/profile-media-mcp-import.ts";

      const prepared = {
        source: { body: new Uint8Array([1]), mimeType: "image/png", contentSha256: "source-hash" },
        download: { body: new Uint8Array([2]), mimeType: "image/png", contentSha256: "download-hash" },
        display: { body: new Uint8Array([3]), mimeType: "image/webp", width: 10, height: 10 },
      };
      async function attempt(kind) {
        let mutationCount = 0;
        try {
          await completeMcpProfileMediaSubmissionImport("intent_" + kind, {
            isStorageConfigured: () => true,
            adminConvex: {
              mutation: async () => {
                mutationCount += 1;
                if (mutationCount === 1) return {
                  status: "claimed",
                  intentId: "intent_" + kind,
                  sourceUrl: "https://media.example.test/photo.png",
                  storageKey: "private/" + kind + "/display.webp",
                };
                return true;
              },
              query: async () => false,
            },
            fetchSource: async () => {
              if (kind === "source") throw new Error("getaddrinfo ENOTFOUND media.example.test");
              return { body: new Uint8Array([1]), mimeType: "image/png" };
            },
            prepareAsset: async () => {
              if (kind === "validation") throw new Error("SVG uploads must contain an SVG root element.");
              if (kind === "unsafe") throw new Error("SVG uploads cannot contain scripts or external references.");
              return prepared;
            },
            putObject: async () => {
              if (kind === "storage") throw new Error("fetch failed while writing object");
            },
            deleteObjects: async () => {},
          });
          return null;
        } catch (error) {
          return { code: error?.code ?? null, outcome: error?.outcome ?? null };
        }
      }
      console.log(JSON.stringify({
        source: await attempt("source"),
        storage: await attempt("storage"),
        unsafe: await attempt("unsafe"),
        validation: await attempt("validation"),
      }));
    `);
    const result = JSON.parse(output) as Record<string, { code: string; outcome: string }>;
    assert.deepEqual(result.source, { code: "MCP_MEDIA_IMPORT_UNREACHABLE", outcome: "rejected" });
    assert.deepEqual(result.validation, { code: "MCP_MEDIA_IMPORT_UNSUPPORTED", outcome: "rejected" });
    assert.deepEqual(result.unsafe, { code: "MCP_MEDIA_IMPORT_UNSAFE", outcome: "rejected" });
    assert.deepEqual(result.storage, { code: "MCP_MEDIA_STORAGE_WRITE_FAILED", outcome: "rejected" });
  });

  it("does not report or clean up a successor's terminal failure as recovered success", () => {
    const output = runImportProbe(`
      import { completeMcpProfileMediaSubmissionImport } from "./apps/web/src/lib/server/profile-media-mcp-import.ts";

      let mutationCount = 0;
      let deleted = false;
      let result = null;
      try {
        await completeMcpProfileMediaSubmissionImport("intent_failed", {
          isStorageConfigured: () => true,
          adminConvex: {
            mutation: async () => {
              mutationCount += 1;
              if (mutationCount === 1) return {
                status: "claimed",
                intentId: "intent_failed",
                sourceUrl: "https://media.example.test/photo.png",
                storageKey: "private/failed/display.webp",
              };
              throw new Error("transport ended after maybe committing");
            },
            query: async (_query, args) => "contentSha256" in args ? false : {
              failureCode: "MCP_MEDIA_IMPORT_DUPLICATE",
              intentState: "pending",
              leaseMatches: false,
              storageKey: "private/successor/display.webp",
              submission: {
                submissionId: "submission_123",
                profileSlug: "community-dj",
                profileDisplayName: "Community DJ",
                requestedPlacement: "profile_image",
                status: "withdrawn",
                createdAt: 1,
                updatedAt: 2,
              },
            },
          },
          fetchSource: async () => ({ body: new Uint8Array([1]), mimeType: "image/png" }),
          prepareAsset: async () => ({
            source: { body: new Uint8Array([1]), mimeType: "image/png", contentSha256: "source-hash" },
            download: { body: new Uint8Array([2]), mimeType: "image/png", contentSha256: "download-hash" },
            display: { body: new Uint8Array([3]), mimeType: "image/webp", width: 10, height: 10 },
          }),
          putObject: async () => {},
          deleteObjects: async () => { deleted = true; },
        });
      } catch (error) {
        result = { code: error?.code ?? null, outcome: error?.outcome ?? null };
      }
      console.log(JSON.stringify({ deleted, result }));
    `);
    assert.deepEqual(JSON.parse(output), {
      deleted: false,
      result: {
        code: "MCP_MEDIA_IMPORT_DUPLICATE",
        outcome: "rejected",
      },
    });
  });
});
