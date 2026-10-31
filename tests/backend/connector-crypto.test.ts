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

it("rejects extra segments and wrong IV or tag lengths as a format error", async () => {
  const [v, iv, tag, body] = (await encryptSecret("refresh")).split(":");
  const short = Buffer.alloc(8).toString("base64");
  await assert.rejects(decryptSecret([v, iv, tag, body, "extra"].join(":")), /CONNECTOR_CIPHER_FORMAT/);
  await assert.rejects(decryptSecret([v, short, tag, body].join(":")), /CONNECTOR_CIPHER_FORMAT/);
  await assert.rejects(decryptSecret([v, iv, short, body].join(":")), /CONNECTOR_CIPHER_FORMAT/);
});

it("refuses to decrypt without the key or with a different key", async () => {
  const cipher = await encryptSecret("refresh");
  delete process.env.VRDEX_CONNECTOR_TOKEN_KEY;
  await assert.rejects(decryptSecret(cipher), /VRDEX_CONNECTOR_TOKEN_KEY/);
  process.env.VRDEX_CONNECTOR_TOKEN_KEY = Buffer.alloc(32, 8).toString("base64");
  await assert.rejects(decryptSecret(cipher));
  process.env.VRDEX_CONNECTOR_TOKEN_KEY = Buffer.alloc(32, 7).toString("base64");
});
