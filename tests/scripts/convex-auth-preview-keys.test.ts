import assert from "node:assert/strict";
import { createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import {
  createConvexAuthKeyPair,
  writeConvexAuthKeyPair,
} from "../../scripts/generate-convex-auth-preview-keys.mjs";

describe("Convex Auth preview key generation", () => {
  it("creates a matching RS256 private key and public JWKS", () => {
    const values = createConvexAuthKeyPair();
    const jwks = JSON.parse(values.jwks) as { keys: Array<JsonWebKey & { use?: string }> };
    const publicJwk = jwks.keys[0];

    assert.equal(values.jwtPrivateKey.includes("\n"), false);
    assert.match(values.jwtPrivateKey, /^-----BEGIN PRIVATE KEY----- /);
    assert.equal(publicJwk?.kty, "RSA");
    assert.equal(publicJwk?.use, "sig");

    const payload = Buffer.from("vrdex-convex-auth-preview");
    const restoredPrivateKey = values.jwtPrivateKey
      .replace("-----BEGIN PRIVATE KEY----- ", "-----BEGIN PRIVATE KEY-----\n")
      .replace(" -----END PRIVATE KEY-----", "\n-----END PRIVATE KEY-----");
    const signature = sign("RSA-SHA256", payload, createPrivateKey(restoredPrivateKey));

    assert.equal(verify("RSA-SHA256", payload, createPublicKey({ format: "jwk", key: publicJwk! }), signature), true);
  });

  it("writes the private key and JWKS to separate files", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "vrdex-convex-auth-preview-"));

    try {
      const files = await writeConvexAuthKeyPair(directory);
      const privateKey = await readFile(files.privateKeyPath, "utf8");
      const jwks = JSON.parse(await readFile(files.jwksPath, "utf8")) as { keys?: unknown[] };

      assert.match(privateKey, /^-----BEGIN PRIVATE KEY----- /);
      assert.equal(jwks.keys?.length, 1);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });
});
