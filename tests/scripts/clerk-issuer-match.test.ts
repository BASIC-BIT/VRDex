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

/**
 * The recovery case. A target stuck on a build from before Clerk existed serves
 * no key at all, and the caller has to be able to tell that apart from a
 * mismatch so the deploy that fixes it is not blocked by it.
 */
test("reports no key when the target serves none", async () => {
  const pages = new Map([["https://staging.example.test/sign-in", "<html>no clerk here</html>"]]);

  assert.equal(
    await servedClerkKey("https://staging.example.test", async (url) => pages.get(url) ?? null),
    null,
  );
});

test("reports no key when the sign-in page cannot be fetched", async () => {
  assert.equal(await servedClerkKey("https://staging.example.test", async () => null), null);
});
