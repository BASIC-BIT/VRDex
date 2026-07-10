import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { setTimeout as delay } from "node:timers/promises";

import {
  fetchOAuthClientMetadataDocument,
  pinnedLookupForAddress,
} from "../../apps/web/src/lib/server/oauth-client-metadata-document";

const clientId = "https://client.example.test/oauth/client.json?app=vrdex";
const publicAddress = "93.184.216.34";

function metadataResponse(status = 200) {
  return Response.json(
    {
      client_id: clientId,
      client_name: "VRDex Test Client",
      client_uri: "https://client.example.test",
      redirect_uris: ["http://localhost:8765/callback"],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: "mcp:read public:read",
    },
    { status },
  );
}

describe("OAuth client metadata documents", () => {
  it("fetches through the address selected by the validation lookup", async () => {
    const requests: Array<{ address: string; url: string }> = [];
    const metadata = await fetchOAuthClientMetadataDocument(clientId, {
      requestDocument: async (url, address) => {
        requests.push({ address: address.address, url: url.toString() });
        return metadataResponse();
      },
      resolveHostname: async () => [{ address: publicAddress }],
    });

    assert.deepEqual(requests, [{ address: publicAddress, url: clientId }]);
    assert.deepEqual(metadata, {
      allowedScopes: ["mcp:read", "public:read"],
      clientId,
      clientName: "VRDex Test Client",
      clientType: "public",
      clientUri: "https://client.example.test/",
      contacts: [],
      grantTypes: ["authorization_code", "refresh_token"],
      redirectUris: ["http://localhost:8765/callback"],
      responseTypes: ["code"],
      tokenEndpointAuthMethod: "none",
    });
  });

  it("pins the first validated address without a second hostname resolution", async () => {
    let resolutions = 0;
    let connectedAddress = "";

    await fetchOAuthClientMetadataDocument(clientId, {
      resolveHostname: async () => {
        resolutions += 1;
        return [{ address: resolutions === 1 ? publicAddress : "127.0.0.1" }];
      },
      requestDocument: async (_url, address) => {
        connectedAddress = address.address;
        return metadataResponse();
      },
    });

    assert.equal(resolutions, 1);
    assert.equal(connectedAddress, publicAddress);

    const source = readFileSync("apps/web/src/lib/server/oauth-client-metadata-document.ts", "utf8");
    assert.match(source, /lookup: pinnedLookupForAddress\(address\)/);
    assert.match(source, /servername: url\.hostname/);
    assert.match(source, /rejectUnauthorized: true/);
  });

  it("returns only the pinned address for Node single-address and all-address lookups", async () => {
    const pinnedLookup = pinnedLookupForAddress({ address: publicAddress });
    const single = await new Promise<{ address: string; family: number }>((resolve, reject) => {
      pinnedLookup("client.example.test", {}, (error, address, family) => {
        if (error) {
          reject(error);
          return;
        }

        resolve({ address, family });
      });
    });
    const all = await new Promise<Array<{ address: string; family: number }>>((resolve, reject) => {
      pinnedLookup("client.example.test", { all: true }, (error, addresses) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(addresses);
      });
    });

    assert.deepEqual(single, { address: publicAddress, family: 4 });
    assert.deepEqual(all, [{ address: publicAddress, family: 4 }]);
  });

  it("rejects special-use IPv4, IPv6, mapped, translation, and documentation ranges", async () => {
    for (const address of [
      "0.0.0.1",
      "10.0.0.1",
      "127.0.0.1",
      "169.254.169.254",
      "192.168.1.1",
      "198.51.100.8",
      "::1",
      "::ffff:127.0.0.1",
      "64:ff9b::1",
      "100::1",
      "2001:db8::1",
      "3fff::1",
      "5f00::1",
      "fc00::1",
      "fe80::1",
      "ff02::1",
    ]) {
      await assert.rejects(
        fetchOAuthClientMetadataDocument(clientId, {
          requestDocument: async () => metadataResponse(),
          resolveHostname: async () => [{ address }],
        }),
        /public address/,
        address,
      );
    }
  });

  it("rejects redirects, mismatched client ids, and oversized metadata", async () => {
    await assert.rejects(
      fetchOAuthClientMetadataDocument(clientId, {
        requestDocument: async () => new Response(null, { status: 302, headers: { location: "https://other.example.test" } }),
        resolveHostname: async () => [{ address: publicAddress }],
      }),
      /HTTP 200/,
    );

    await assert.rejects(
      fetchOAuthClientMetadataDocument(clientId, {
        requestDocument: async () => Response.json({ client_id: "https://client.example.test/oauth/other-client.json" }),
        resolveHostname: async () => [{ address: publicAddress }],
      }),
      /client_id must match/,
    );

    await assert.rejects(
      fetchOAuthClientMetadataDocument(clientId, {
        requestDocument: async () => new Response(JSON.stringify({ padding: "x".repeat(6 * 1024) })),
        resolveHostname: async () => [{ address: publicAddress }],
      }),
      /too large/,
    );
  });

  it("enforces an absolute deadline against a slow-drip HTTP 200 response", async () => {
    let interval: ReturnType<typeof setInterval> | undefined;
    let cancelled = false;
    const startedAt = Date.now();

    await assert.rejects(
      fetchOAuthClientMetadataDocument(clientId, {
        deadlineMs: 80,
        requestDocument: async () =>
          new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                interval = setInterval(() => controller.enqueue(new TextEncoder().encode(" ")), 10);
              },
              cancel() {
                cancelled = true;
                if (interval !== undefined) {
                  clearInterval(interval);
                }
              },
            }),
            { status: 200 },
          ),
        resolveHostname: async () => [{ address: publicAddress }],
      }),
      /timed out/,
    );

    await delay(0);
    assert.equal(cancelled, true);
    assert.ok(Date.now() - startedAt < 500, "slow-drip response exceeded the absolute deadline");
  });

  it("cancels a never-ending non-200 response body immediately", async () => {
    let cancelled = false;
    const startedAt = Date.now();

    await assert.rejects(
      fetchOAuthClientMetadataDocument(clientId, {
        deadlineMs: 1_000,
        requestDocument: async () =>
          new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(new TextEncoder().encode("still streaming"));
              },
              cancel() {
                cancelled = true;
              },
            }),
            { status: 503 },
          ),
        resolveHostname: async () => [{ address: publicAddress }],
      }),
      /HTTP 200/,
    );

    await delay(0);
    assert.equal(cancelled, true);
    assert.ok(Date.now() - startedAt < 500, "non-200 response waited for its body");
  });
});
