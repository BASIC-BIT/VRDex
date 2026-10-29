import assert from "node:assert/strict";
import { it } from "node:test";
import { decryptSecret, encryptSecret } from "../../convex/_connectorCrypto";

process.env.VRDEX_CONNECTOR_TOKEN_KEY = Buffer.alloc(32, 7).toString("base64");

it("round-trips with a fresh IV in the v1 format", async () => {
  const a = await encryptSecret("ya29.token");
  const b = await encryptSecret("ya29.token");
  assert.match(a, /^v1:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);
  assert.notEqual(a, b);
  assert.equal(Buffer.from(a.split(":")[1]!, "base64").length, 12);
  assert.equal(Buffer.from(a.split(":")[2]!, "base64").length, 16);
  assert.equal(await decryptSecret(a), "ya29.token");
});

it("rejects tampered ciphertext, tag, and version", async () => {
  const [v, iv, tag, body] = (await encryptSecret("refresh")).split(":");
  const flip = (s: string) => { const bytes = Buffer.from(s, "base64"); bytes[0] ^= 1; return bytes.toString("base64"); };
  await assert.rejects(decryptSecret([v, iv, tag, flip(body!)].join(":")));
  await assert.rejects(decryptSecret([v, iv, flip(tag!), body].join(":")));
  await assert.rejects(decryptSecret(["v2", iv, tag, body].join(":")), /CONNECTOR_CIPHER_VERSION/);
});

it("refuses a key that is not 32 bytes", async () => {
  process.env.VRDEX_CONNECTOR_TOKEN_KEY = Buffer.alloc(16, 1).toString("base64");
  await assert.rejects(encryptSecret("x"), /VRDEX_CONNECTOR_TOKEN_KEY/);
  process.env.VRDEX_CONNECTOR_TOKEN_KEY = Buffer.alloc(32, 7).toString("base64");
});
