import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  appendReturnPathQuery,
  isSafeReturnPath,
  resolveSameOriginUrl,
  safeReturnPath,
} from "../../apps/web/src/lib/return-path";

describe("return path safety", () => {
  it("accepts ordinary same-origin paths", () => {
    assert.equal(isSafeReturnPath("/account"), true);
    assert.equal(isSafeReturnPath("/claim/some-slug?source=profile"), true);
  });

  it("rejects protocol-relative and absolute URLs", () => {
    assert.equal(isSafeReturnPath("//evil.com"), false);
    assert.equal(isSafeReturnPath("https://evil.com"), false);
    assert.equal(isSafeReturnPath("evil.com"), false);
    assert.equal(isSafeReturnPath(null), false);
  });

  // The WHATWG URL parser normalizes backslashes to forward slashes for
  // http(s), so `/\evil.com` passes a naive `//` check and then resolves to a
  // different host entirely.
  it("rejects backslash paths that would normalize to another origin", () => {
    assert.equal(new URL("/\\evil.com", "https://vrdex.net").host, "evil.com");

    assert.equal(isSafeReturnPath("/\\evil.com"), false);
    assert.equal(isSafeReturnPath("/\\\\evil.com"), false);
    assert.equal(isSafeReturnPath("/path\\evil.com"), false);
    assert.equal(safeReturnPath("/\\evil.com"), "/account");
  });

  // Written as escapes rather than literal bytes: a raw NUL makes git treat the
  // whole file as binary, which hides these assertions from code review.
  it("rejects control characters", () => {
    assert.equal(isSafeReturnPath("/account\nSet-Cookie: x"), false, "newline");
    assert.equal(isSafeReturnPath("/account\r\nSet-Cookie: x"), false, "CRLF");
    assert.equal(isSafeReturnPath("/account\u0000"), false, "NUL");
    assert.equal(isSafeReturnPath("/account\u001f"), false, "unit separator");
    assert.equal(isSafeReturnPath("/account\u007f"), false, "DEL");
  });

  // The query must precede the fragment; appending after a `#` would bury the
  // status where the destination page cannot read it.
  it("keeps appended query parameters ahead of a fragment", () => {
    assert.equal(
      appendReturnPathQuery("/claim/foo", { discordVerify: "verified" }),
      "/claim/foo?discordVerify=verified",
    );
    assert.equal(
      appendReturnPathQuery("/claim/foo?source=profile", { discordVerify: "verified" }),
      "/claim/foo?source=profile&discordVerify=verified",
    );
    assert.equal(
      appendReturnPathQuery("/claim/foo#step-2", { discordVerify: "verified", discordGuilds: 3 }),
      "/claim/foo?discordVerify=verified&discordGuilds=3#step-2",
    );

    const resolved = new URL(
      appendReturnPathQuery("/claim/foo#step-2", { discordVerify: "verified" }),
      "https://vrdex.net",
    );
    assert.equal(resolved.searchParams.get("discordVerify"), "verified");
    assert.equal(resolved.hash, "#step-2");
  });

  // These parameters are the callback's statement about what happened, and the
  // pages that read them take the first value. Appending let a crafted
  // `returnTo` carrying `discordVerify=verified` keep showing success after the
  // callback reported a failure.
  it("replaces a status the return path already carried", () => {
    assert.equal(
      appendReturnPathQuery("/claim/foo?discordVerify=verified", { discordVerify: "failed" }),
      "/claim/foo?discordVerify=failed",
    );
    // The callback always names both of its parameters, so an omitted count
    // clears a crafted one rather than leaving it to be read as this outcome's.
    assert.equal(
      appendReturnPathQuery("/claim/foo?source=profile&discordVerify=verified&discordGuilds=9", {
        discordVerify: "declined",
        discordGuilds: undefined,
      }),
      "/claim/foo?source=profile&discordVerify=declined",
    );

    const resolved = new URL(
      appendReturnPathQuery("/claim/foo?discordVerify=verified", { discordVerify: "failed" }),
      "https://vrdex.net",
    );
    assert.deepEqual(resolved.searchParams.getAll("discordVerify"), ["failed"]);
  });

  it("omits undefined parameters and leaves the path untouched when empty", () => {
    assert.equal(
      appendReturnPathQuery("/claim/foo", { discordVerify: "failed", discordGuilds: undefined }),
      "/claim/foo?discordVerify=failed",
    );
    assert.equal(appendReturnPathQuery("/claim/foo", { discordGuilds: undefined }), "/claim/foo");
  });

  it("refuses to resolve a path onto a different origin", () => {
    assert.equal(
      resolveSameOriginUrl("/account?x=1", "https://vrdex.net").href,
      "https://vrdex.net/account?x=1",
    );
    assert.throws(
      () => resolveSameOriginUrl("/\\evil.com", "https://vrdex.net"),
      /different origin/,
    );
    assert.throws(
      () => resolveSameOriginUrl("//evil.com", "https://vrdex.net"),
      /different origin/,
    );
  });
});
