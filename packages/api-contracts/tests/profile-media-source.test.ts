import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeMcpContributionSourceUrl, assertMcpContributionSourceRedirect } from "../src/profile-media-source";

const source = "https://cdn.discordapp.com/attachments/123/456/press%20kit.png?hm=AbCd0123&is=1&ex=2&";

describe("MCP contribution sources", () => {
  it("preserves signed bytes and accepts old timestamps for completed replay", () => {
    assert.equal(normalizeMcpContributionSourceUrl(source), source);
    assert.equal(normalizeMcpContributionSourceUrl(source.replace(".com/", ".com:443/")), source);
    assert.equal(normalizeMcpContributionSourceUrl("https://MEDIA.example.test/photo.png"), "https://media.example.test/photo.png");
  });

  it("rejects unsupported query, host, path and credential shapes", () => {
    for (const invalid of [
      source.replace("https:", "http:"), source.replace(".com/", ".com:8443/"),
      source.replace("cdn.discordapp.com", "media.discordapp.net"),
      source.replace("cdn.discordapp.com", "cdn.discordapp.com.evil.test"),
      source.replace("cdn.discordapp.com", "cdn.discordapp.com."),
      source.replace("cdn.discordapp.com", "user:secret@cdn.discordapp.com"),
      source + "#", source + "#fragment", " " + source, source + "\n",
      source.replace("/123/", "/0/"), source.replace("/123/", "/123456789012345678901/"),
      source.replace("press%20kit.png", "../press.png"),
      source.replace("press%20kit.png", "%2e%2e"),
      "https://cdn.discordapp.com/attachments/123/456/folder/press.png?hm=AbCd0123&is=1&ex=2&",
      source.replace("press%20kit.png", "press%2fkit.png"),
      source.replace("press%20kit.png", "press%5ckit.png"),
      source.replace("press%20kit.png", "press%00kit.png"),
      source.replace("press%20kit.png", "press%xx.png"),
      source.replace("/456/", "\\456/"),
      source + "width=128", source + "ex=2", source + "&",
      source.replace("hm=AbCd0123", "hm="), source.replace("hm=AbCd0123", "hm=xyz"),
      source.replace("hm=AbCd0123", "hm=" + "a".repeat(257)),
      source.replace("ex=2", "ex=" + "f".repeat(17)),
      source.replace("is=1&", ""), source.replace("is=1", "IS=1"),
      source.replace("is=1", "%69s=1"), source.replace("is=1", "is=%31"),
      source.replace("is=1", "is=1=2"),
      "https://example.test/image.png?ex=2&is=1&hm=abcd",
    ]) assert.equal(normalizeMcpContributionSourceUrl(invalid), null, invalid);
  });

  it("binds signed redirects to the exact canonical attachment and raw query", () => {
    assert.doesNotThrow(() => assertMcpContributionSourceRedirect(source, new URL(source)));
    for (const target of [
      source.slice(0, source.indexOf("?")), source.replace("ex=2", "ex=3"), source.replace("/456/", "/457/"),
      source.replace("cdn.discordapp.com", "example.test"), source.slice(0, -1),
      source.replace("hm=AbCd0123&is=1&ex=2&", "is=1&ex=2&hm=AbCd0123&"),
    ]) assert.throws(() => assertMcpContributionSourceRedirect(source, new URL(target)), /not supported/);
    assert.doesNotThrow(() => assertMcpContributionSourceRedirect("https://example.test/image.png", new URL("https://images.example.test/redirected.png")));
  });
});
