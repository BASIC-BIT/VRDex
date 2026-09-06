import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeMcpContributionSourceUrl } from "../src/profile-media-source";

describe("MCP contribution sources", () => {
  it("accepts provider-independent query URLs without rewriting query bytes", () => {
    for (const source of [
      "https://images.example.test/photo?width=512&format=webp",
      "https://storage.example.test/file.png?signature=Ab%2fCd%2B&expires=1&",
      "https://cdn.discordapp.com/attachments/123/456/photo.png?ex=2&is=1&hm=AbCd",
      "https://media.example.test/image?tag=a&tag=b&empty=&opaque=a=b+c",
      "https://media.example.test/photo.png",
    ]) assert.equal(normalizeMcpContributionSourceUrl(source), source);
    assert.equal(normalizeMcpContributionSourceUrl("https://MEDIA.example.test:443/photo.png"), "https://media.example.test/photo.png");
  });

  it("rejects credentials, non-HTTPS, custom ports, fragments and malformed raw input", () => {
    for (const invalid of [
      "http://media.example.test/image?width=512",
      "https://user:secret@media.example.test/image",
      "https://media.example.test:8443/image",
      "https://media.example.test/image#fragment",
      "https://media.example.test/image#",
      " https://media.example.test/image",
      "https://media.example.test/image\n",
      "https://media.example.test\\image",
      "not a URL",
      "https://media.example.test/image?token=" + "a".repeat(2_048),
    ]) assert.equal(normalizeMcpContributionSourceUrl(invalid), null, invalid);
  });

  it("bounds the encoded URL before it reaches durable request handling", () => {
    const prefix = "https://media.example.test/image?name=";
    assert.equal(normalizeMcpContributionSourceUrl(prefix + "é".repeat(400)), null);
    const accepted = prefix + "é".repeat(100);
    const normalized = normalizeMcpContributionSourceUrl(accepted);
    assert.equal(normalized, new URL(accepted).toString());
    assert.equal(normalizeMcpContributionSourceUrl(normalized!), normalized);
  });
});
