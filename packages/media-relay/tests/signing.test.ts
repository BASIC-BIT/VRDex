import assert from "node:assert/strict";
import { test } from "node:test";
import { generateKeyPairSync, verify } from "node:crypto";
import { createSegmentSigner } from "../src/gateway/signing";
test("CloudFront URL verifies cryptographically against its resource and at least five minutes; tampering fails", () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });
  const sign = createSegmentSigner({
    origin: "https://cdn.example",
    keyPairId: "K123",
    privateKey: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    clock: () => 100001,
  });
  const raw = sign({
    objectKey: "vrcdn/Alpha/1/epochs/1/attempt-1-abc/video-0.ts",
    expiresAt: 400001,
  });
  const url = new URL(raw);
  const expires = Number(url.searchParams.get("Expires"));
  assert.ok(expires * 1000 >= 400001);
  assert.equal(url.searchParams.get("Key-Pair-Id"), "K123");
  const signature = Buffer.from(
    url.searchParams
      .get("Signature")!
      .replace(/-/g, "+")
      .replace(/_/g, "=")
      .replace(/~/g, "/"),
    "base64",
  );
  url.search = "";
  const policy = (resource: string) =>
    JSON.stringify({
      Statement: [
        {
          Resource: resource,
          Condition: { DateLessThan: { "AWS:EpochTime": expires } },
        },
      ],
    });
  assert.ok(
    verify("RSA-SHA1", Buffer.from(policy(url.href)), publicKey, signature),
  );
  assert.equal(
    verify(
      "RSA-SHA1",
      Buffer.from(policy(url.href + "x")),
      publicKey,
      signature,
    ),
    false,
  );
  assert.throws(() => sign({ objectKey: "../secret", expiresAt: 400001 }));
  assert.throws(() =>
    sign({
      objectKey: "vrcdn/Alpha/1/epochs/1/attempt-1-abc/video-0.ts",
      expiresAt: 400000,
    }),
  );
});
