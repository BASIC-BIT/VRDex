import assert from "node:assert/strict";
import test from "node:test";

import {
  decodeClerkKeyHost,
  issuerHost,
  servedClerkKey,
} from "../../scripts/check-clerk-issuer-match.mjs";

function publishableKey(host: string, tier: "test" | "live" = "test") {
  return `pk_${tier}_${Buffer.from(`${host}$`).toString("base64")}`;
}

test("decodes the frontend API host a publishable key encodes", () => {
  assert.equal(
    decodeClerkKeyHost(publishableKey("oriented-anemone-94.clerk.accounts.dev")),
    "oriented-anemone-94.clerk.accounts.dev",
  );
  assert.equal(decodeClerkKeyHost(publishableKey("clerk.vrdex.net", "live")), "clerk.vrdex.net");
});

/**
 * Clerk keys encode `host$`. One encoding only `host` — truncated, or re-entered
 * by hand — decodes to the same string, so both comparisons passed while
 * `ClerkProvider` and the middleware could not use the key at all.
 */
test("rejects a publishable key with no terminator", () => {
  const withoutTerminator = `pk_test_${Buffer.from("oriented-anemone-94.clerk.accounts.dev").toString("base64")}`;

  assert.throws(() => decodeClerkKeyHost(withoutTerminator), /truncated or otherwise malformed/);
});

/**
 * Node's base64 decoder ignores trailing bytes, so an unanchored match let
 * `pk_test_<base64>==junk` decode to the right host with the right terminator
 * and pass every comparison on a key Clerk cannot use.
 */
test("rejects a publishable key with data beyond its encoded host", () => {
  const valid = `pk_test_${Buffer.from("a.clerk.accounts.dev$").toString("base64")}`;

  assert.throws(() => decodeClerkKeyHost(`${valid}junk`), /not canonically encoded/);
  assert.throws(() => decodeClerkKeyHost(`${valid.replace(/=*$/, "")}==junk`), /not a well-formed key/);
  assert.throws(() => decodeClerkKeyHost("pk_test_not base64"), /not a well-formed key/);
});

/**
 * Stripping padding from both sides of the round-trip accepted a valid unpadded
 * key with a stray `=` appended. Browsers decode the key with `atob`, which
 * rejects that encoding, so this approved a key Clerk's own parser refuses.
 */
test("rejects a publishable key with noncanonical padding", () => {
  // This host's payload length forces one `=`, so the padded and unpadded forms
  // actually differ — the earlier case encoded to a length needing none, which
  // is why it could not exercise this.
  const host = "abc.clerk.accounts.dev";
  const canonical = Buffer.from(`${host}$`).toString("base64");
  const unpadded = canonical.replace(/=+$/, "");

  assert.notEqual(canonical, unpadded);

  // Clerk emits the padded form; the unpadded form decodes identically and is
  // accepted, because both are canonical for this payload.
  assert.equal(decodeClerkKeyHost(`pk_test_${canonical}`), host);
  assert.equal(decodeClerkKeyHost(`pk_test_${unpadded}`), host);

  // Anything else is padding `atob` would refuse.
  assert.throws(() => decodeClerkKeyHost(`pk_test_${unpadded}==`), /not canonically encoded/);
  assert.throws(() => decodeClerkKeyHost(`pk_test_${canonical}=`), /not canonically encoded/);
});

/**
 * A bare host normalises to the same string as the decoded key host, so
 * comparing hosts alone reports success — while `convex/auth.config.ts` passes
 * the bare value through verbatim and matches no token issuer. The variable is
 * named `..._DOMAIN`, which makes that an easy value to enter.
 */
test("rejects an issuer that is not an https origin", () => {
  assert.throws(() => issuerHost("example.clerk.accounts.dev"), /must be an https origin/);
  assert.throws(() => issuerHost("http://example.clerk.accounts.dev"), /must be an https origin/);
  assert.throws(() => issuerHost("https://example.clerk.accounts.dev/"), /must be an https origin/);
  assert.throws(() => issuerHost("https://example.clerk.accounts.dev/foo"), /must be an https origin/);
  assert.throws(() => issuerHost(""), /must be an https origin/);
});

test("accepts a well-formed https origin", () => {
  assert.equal(
    issuerHost("https://oriented-anemone-94.clerk.accounts.dev"),
    "oriented-anemone-94.clerk.accounts.dev",
  );
});

test("finds a publishable key inlined in a client chunk rather than the shell", async () => {
  const key = publishableKey("oriented-anemone-94.clerk.accounts.dev");
  const pages = new Map([
    ["https://staging.example.test/sign-in", '<script src="/_next/static/chunks/abc.js"></script>'],
    ["https://staging.example.test/_next/static/chunks/abc.js", `const k=\"${key}\";`],
  ]);

  assert.equal(
    await servedClerkKey("https://staging.example.test", async (url) => pages.get(url) ?? null),
    key,
  );
});

test("reports no key when the target serves none", async () => {
  const pages = new Map([["https://staging.example.test/sign-in", "<html>no clerk here</html>"]]);

  assert.equal(
    await servedClerkKey("https://staging.example.test", async (url) => pages.get(url) ?? null),
    null,
  );
});

/**
 * A missing key and an unreachable page are different answers, and callers act
 * on that difference. Folding a transient 500 or a deployment-protection 401
 * into the same `null` would let an unreachable target read as "this page
 * carried no key".
 */
test("throws rather than reporting no key when a fetch fails", async () => {
  await assert.rejects(
    servedClerkKey("https://staging.example.test", async () => {
      throw new Error("GET https://staging.example.test/sign-in returned HTTP 500.");
    }),
    /HTTP 500/,
  );
});

test("throws when a client chunk fails even though the shell loaded", async () => {
  await assert.rejects(
    servedClerkKey("https://staging.example.test", async (url) => {
      if (url.endsWith("/sign-in")) {
        return '<script src="/_next/static/chunks/abc.js"></script>';
      }

      throw new Error(`GET ${url} returned HTTP 401.`);
    }),
    /HTTP 401/,
  );
});
