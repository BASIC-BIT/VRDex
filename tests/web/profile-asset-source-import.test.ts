import assert from "node:assert/strict";
import type { IncomingMessage } from "node:http";
import { describe, it } from "node:test";
import { Readable } from "node:stream";

import { fetchProfileAssetSourceUrl } from "../../apps/web/src/lib/server/profile-asset-source-import";

function sourceResponse(input: {
  body?: Uint8Array;
  headers?: Record<string, string>;
  statusCode: number;
}) {
  const response = Readable.from(input.body === undefined ? [] : [input.body]) as IncomingMessage;
  response.statusCode = input.statusCode;
  response.headers = input.headers ?? {};
  return response;
}

describe("profile asset source imports", () => {
  it("preserves query bytes through public cross-host redirects", async () => {
    const sources = [
      "https://images.example.test/photo?width=512&format=webp",
      "https://storage.example.test/photo.png?signature=Ab%2fCd%2B&expires=1&",
    ];
    const requested: string[] = [];
    const resolved: string[] = [];
    const result = await fetchProfileAssetSourceUrl(sources[0]!, {
      resolveHostname: async (host) => { resolved.push(host); return [{ address: "93.184.216.34" }]; },
      requestPinnedSource: async (url, address) => {
        assert.equal(address, "93.184.216.34");
        requested.push(url.toString());
        return requested.length === 1
          ? sourceResponse({ statusCode: 302, headers: { location: sources[1]! } })
          : sourceResponse({ statusCode: 200, headers: { "content-type": "image/png" }, body: new Uint8Array([1]) });
      },
    });
    assert.deepEqual(requested, sources);
    assert.deepEqual(resolved, ["images.example.test", "storage.example.test"]);
    assert.equal(result.mimeType, "image/png");
  });

  it("rejects non-HTTPS and credential-bearing URLs before fetching", async () => {
    await assert.rejects(
      fetchProfileAssetSourceUrl("http://media.example.test/photo.webp"),
      /must use HTTPS URLs/,
    );
    await assert.rejects(
      fetchProfileAssetSourceUrl("https://user:secret@media.example.test/photo.webp"),
      /must not include URL credentials/,
    );
    await assert.rejects(
      fetchProfileAssetSourceUrl("https://media.example.test:8443/photo.webp"),
      /default HTTPS port/,
    );
  });

  it("rejects local and reserved literal addresses before fetching", async () => {
    for (const sourceUrl of [
      "https://localhost/photo.webp",
      "https://127.0.0.1/photo.webp",
      "https://10.0.0.1/photo.webp",
      "https://192.168.1.2/photo.webp",
      "https://[::1]/photo.webp",
      "https://[fc00::1]/photo.webp",
    ]) {
      await assert.rejects(
        fetchProfileAssetSourceUrl(sourceUrl),
        /must use public HTTPS URLs/,
      );
    }
  });

  it("rejects DNS and redirect targets that resolve to private addresses", async () => {
    await assert.rejects(
      fetchProfileAssetSourceUrl("https://media.example.test/photo.webp", {
        resolveHostname: async () => [{ address: "10.0.0.4" }],
        requestPinnedSource: async () => {
          throw new Error("private DNS result reached the network");
        },
      }),
      /must use public HTTPS URLs/,
    );

    let requestCount = 0;
    await assert.rejects(
      fetchProfileAssetSourceUrl("https://media.example.test/photo.webp", {
        resolveHostname: async () => [{ address: "93.184.216.34" }],
        requestPinnedSource: async () => {
          requestCount += 1;
          return sourceResponse({
            statusCode: 302,
            headers: { location: "https://127.0.0.1/private.webp?token=secret" },
          });
        },
      }),
      /must use public HTTPS URLs/,
    );
    assert.equal(requestCount, 1);
  });

  it("reapplies caller URL policy after every redirect", async () => {
    let requestCount = 0;

    await assert.rejects(
      fetchProfileAssetSourceUrl("https://media.example.test/photo.webp", {
        assertSourceUrl: (url) => {
          if (url.hostname === "blocked.example.test") {
            throw new Error("blocked redirect target");
          }
        },
        resolveHostname: async () => [{ address: "93.184.216.34" }],
        requestPinnedSource: async () => {
          requestCount += 1;
          return sourceResponse({
            statusCode: 302,
            headers: { location: "https://blocked.example.test/preview.png" },
          });
        },
      }),
      /blocked redirect target/,
    );
    assert.equal(requestCount, 1);
  });

  it("enforces MIME and byte limits before accepting the response body", async () => {
    const dependencies = {
      resolveHostname: async () => [{ address: "93.184.216.34" }],
    };
    await assert.rejects(
      fetchProfileAssetSourceUrl("https://media.example.test/photo.txt", {
        ...dependencies,
        requestPinnedSource: async () => sourceResponse({
          statusCode: 200,
          headers: { "content-type": "text/plain", "content-length": "4" },
          body: new TextEncoder().encode("nope"),
        }),
      }),
      /must be PNG, SVG, JPEG, or WebP/,
    );
    await assert.rejects(
      fetchProfileAssetSourceUrl("https://media.example.test/large.webp", {
        ...dependencies,
        requestPinnedSource: async () => sourceResponse({
          statusCode: 200,
          headers: {
            "content-type": "image/webp",
            "content-length": String(12 * 1024 * 1024 + 1),
          },
        }),
      }),
      /12 MB or smaller/,
    );

    const accepted = await fetchProfileAssetSourceUrl(
      "https://media.example.test/photo.webp",
      {
        ...dependencies,
        requestPinnedSource: async () => sourceResponse({
          statusCode: 200,
          headers: { "content-type": "image/webp", "content-length": "4" },
          body: new Uint8Array([1, 2, 3, 4]),
        }),
      },
    );
    assert.equal(accepted.mimeType, "image/webp");
    assert.deepEqual([...accepted.body], [1, 2, 3, 4]);
  });

  it("enforces a total deadline while a response trickles bytes", async () => {
    const response = new Readable({ read() {} }) as IncomingMessage;
    response.statusCode = 200;
    response.headers = { "content-type": "image/webp" };

    const trickle = setInterval(() => response.push(new Uint8Array([1])), 2);
    try {
      await assert.rejects(
        fetchProfileAssetSourceUrl("https://media.example.test/slow.webp", {
          resolveHostname: async () => [{ address: "93.184.216.34" }],
          requestPinnedSource: async () => response,
          totalTimeoutMs: 15,
        }),
        /total timeout/,
      );
      assert.equal(response.destroyed, true);
    } finally {
      clearInterval(trickle);
      response.destroy();
    }
  });

  it("enforces the total deadline while hostname resolution is stalled", async () => {
    let requested = false;

    await assert.rejects(
      fetchProfileAssetSourceUrl("https://media.example.test/stalled.webp", {
        resolveHostname: async () => await new Promise(() => {}),
        requestPinnedSource: async () => {
          requested = true;
          return sourceResponse({ statusCode: 200 });
        },
        totalTimeoutMs: 15,
      }),
      /total timeout/,
    );
    assert.equal(requested, false);
  });

  it("destroys responses rejected during header validation", async () => {
    const response = new Readable({ read() {} }) as IncomingMessage;
    response.statusCode = 200;
    response.headers = { "content-type": "text/plain" };

    await assert.rejects(
      fetchProfileAssetSourceUrl("https://media.example.test/not-an-image.txt", {
        resolveHostname: async () => [{ address: "93.184.216.34" }],
        requestPinnedSource: async () => response,
      }),
      /must be PNG, SVG, JPEG, or WebP/,
    );
    assert.equal(response.destroyed, true);
  });

  it("destroys discarded non-success responses", async () => {
    const response = new Readable({ read() {} }) as IncomingMessage;
    response.statusCode = 503;
    response.headers = { "content-type": "text/plain" };

    await assert.rejects(
      fetchProfileAssetSourceUrl("https://media.example.test/unavailable.webp", {
        resolveHostname: async () => [{ address: "93.184.216.34" }],
        requestPinnedSource: async () => response,
      }),
      /returned HTTP 503/,
    );
    assert.equal(response.destroyed, true);
  });

  it("destroys redirect responses when their location is invalid", async () => {
    const response = new Readable({ read() {} }) as IncomingMessage;
    response.statusCode = 302;
    response.headers = {};

    await assert.rejects(
      fetchProfileAssetSourceUrl("https://media.example.test/redirect.webp", {
        resolveHostname: async () => [{ address: "93.184.216.34" }],
        requestPinnedSource: async () => response,
      }),
      /without a Location header/,
    );
    assert.equal(response.destroyed, true);
  });
});
