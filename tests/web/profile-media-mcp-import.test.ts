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
});
