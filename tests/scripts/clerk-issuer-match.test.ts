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
 * A bare host normalises to the same string as the decoded key host, so
 * comparing hosts alone reports success — while `convex/auth.config.ts` passes
 * the bare value through verbatim and matches no token issuer. The variable is
 * named `..._DOMAIN`, which makes that an easy value to enter.
 */
/**
 * Clerk keys encode `host$`. One encoding only `host` — truncated, or re-entered
 * by hand — decodes to the same string, so both comparisons passed while
 * `ClerkProvider` and the middleware could not use the key at all.
 */
test("rejects a publishable key with no terminator", () => {
  const withoutTerminator = `pk_test_${Buffer.from("oriented-anemone-94.clerk.accounts.dev").toString("base64")}`;

  assert.throws(() => decodeClerkKeyHost(withoutTerminator), /truncated or otherwise malformed/);
});

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
 * The missing-key result is what `--allow-missing-key` forgives, so an
 * unreachable target must not produce it. A transient 500 or a
 * deployment-protection 401 folded into the same answer would let a stale or
 * cross-instance issuer be written and deployed before the post-deploy check
 * could report the outage.
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
