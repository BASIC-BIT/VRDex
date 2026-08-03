#!/usr/bin/env node
/**
 * Compares a Convex `CLERK_JWT_ISSUER_DOMAIN` against the Clerk publishable key
 * a deployment actually serves.
 *
 * Convex's issuer and the web publishable key are configured in different
 * places — a repository variable and the Vercel project — and nothing else
 * compares them. A mismatch deploys cleanly and then rejects every signed-in
 * request, because Convex validates the issuer it was *told* about rather than
 * the one the browser authenticated against. The staging runtime audit cannot
 * catch it: it reads variable names, never values.
 *
 * Two sources, for the two moments worth checking:
 *
 *   --publishable-key <pk>   what Vercel is *about* to serve, read from its
 *                            configuration before either provider is changed
 *   --base-url <origin>      what a deployment *is* serving, read from the page
 *
 * Usage:
 *   node scripts/check-clerk-issuer-match.mjs --issuer <origin> --publishable-key <pk>
 *   node scripts/check-clerk-issuer-match.mjs --issuer <origin> --base-url <origin>
 */
import assert from "node:assert/strict";

// Unanchored: used to *find* a key inside a page or a JS chunk.
const CLERK_KEY_SEARCH_PATTERN = /pk_(test|live)_[A-Za-z0-9+/=_-]+/;
// Anchored, and the whole value must be canonical base64. A configured key with
// trailing data — `pk_test_<base64>==junk` — matched the unanchored pattern, and
// Node's decoder ignores the suffix, so the host and the `$` terminator both
// came out right and every comparison passed on a key Clerk cannot use.
const CLERK_KEY_STRICT_PATTERN = /^pk_(test|live)_[A-Za-z0-9+/]+={0,2}$/;
/** A confirmed key/issuer mismatch, as opposed to any other failure. */
export const MISMATCH_EXIT_CODE = 2;

const ISSUER_PATTERN = /^https:\/\/[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;

/**
 * Requires the decoded payload to end in Clerk's `$` terminator rather than
 * stripping one when it happens to be there.
 *
 * A key holding base64 of `host` instead of `host$` — truncated, or re-entered
 * by hand — decodes to the same string, so both comparisons passed while
 * `ClerkProvider` and the middleware could not use the key at all. That reported
 * a deployment as correctly paired at exactly the moment it could authenticate
 * nobody.
 */
export function decodeClerkKeyHost(key) {
  assert.ok(
    CLERK_KEY_STRICT_PATTERN.test(key),
    `That Clerk publishable key is not a well-formed key: it must be pk_test_ or pk_live_ followed by base64 and nothing else, got '${key.slice(0, 12)}…'.`,
  );

  const encoded = key.replace(/^pk_(test|live)_/, "");
  const padded = encoded + "=".repeat((4 - (encoded.length % 4)) % 4);
  const decoded = Buffer.from(padded, "base64").toString("utf8");

  // Round-trips exactly, so neither trailing bytes nor noncanonical padding can
  // pass. Comparing with padding stripped from both sides accepted a valid
  // unpadded key with a stray `=` appended — which `atob` in the browser
  // rejects, so Clerk's own parser would refuse a key this approved.
  const canonical = Buffer.from(decoded, "utf8").toString("base64");

  assert.ok(
    encoded === canonical || encoded === canonical.replace(/=+$/, ""),
    "That Clerk publishable key is not canonically encoded — it carries extra data or invalid padding — so Clerk cannot use it.",
  );

  assert.ok(
    decoded.endsWith("$"),
    "That Clerk publishable key does not decode to a frontend API host followed by '$', so Clerk cannot use it. It is truncated or otherwise malformed.",
  );

  return decoded.slice(0, -1);
}

/**
 * Rejects a bare host outright rather than normalising it away.
 *
 * `convex/auth.config.ts` passes this value through verbatim as the provider
 * domain, so `example.clerk.accounts.dev` does not match tokens whose issuer is
 * `https://example.clerk.accounts.dev` — every authenticated request is
 * rejected. Comparing only the host would have called that pair equal and
 * reported success, and the variable's `_DOMAIN` name makes the bare form an
 * easy thing to enter.
 */
export function issuerHost(issuer) {
  assert.ok(
    ISSUER_PATTERN.test(issuer),
    `CLERK_JWT_ISSUER_DOMAIN must be an https origin with no path, got '${issuer}'. Convex passes it to auth.config.ts verbatim, so a bare host or a trailing slash matches no token issuer.`,
  );

  return issuer.slice("https://".length);
}

/**
 * Throws on an HTTP error rather than returning null.
 *
 * A missing key and an unreachable page are different answers, and only the
 * first is ever benign. Folding a transient 500 or a deployment-protection 401
 * into the same `null` would let an unreachable target read as "nothing to
 * compare".
 */
async function fetchText(url) {
  const response = await fetch(url, { redirect: "follow" });

  if (!response.ok) {
    throw new Error(`GET ${url} returned HTTP ${response.status}.`);
  }

  return await response.text();
}

export async function servedClerkKey(baseUrl, fetchImpl = fetchText) {
  const html = await fetchImpl(`${baseUrl}/sign-in`);
  const inline = html.match(CLERK_KEY_SEARCH_PATTERN);

  if (inline) {
    return inline[0];
  }

  // Next inlines the key into a client chunk rather than the shell.
  const scripts = [...new Set(html.match(/\/_next\/static\/[^"']+\.js/g) ?? [])];

  for (const script of scripts) {
    const body = await fetchImpl(`${baseUrl}${script}`);
    const match = body.match(CLERK_KEY_SEARCH_PATTERN);

    if (match) {
      return match[0];
    }
  }

  return null;
}

function parseArgs(argv) {
  const options = { baseUrl: "", issuer: "", publishableKey: "", validateIssuerOnly: false };

  for (let index = 0; index < argv.length; index += 1) {
    switch (argv[index]) {
      case "--validate-issuer-only":
        options.validateIssuerOnly = true;
        break;
      case "--allow-missing-key":
        options.allowMissingKey = true;
        break;
      case "--publishable-key":
        options.publishableKey = argv[index + 1] ?? "";
        index += 1;
        break;
      case "--base-url":
        options.baseUrl = argv[index + 1] ?? "";
        index += 1;
        break;
      case "--issuer":
        options.issuer = argv[index + 1] ?? "";
        index += 1;
        break;
      default:
        throw new Error(`Unknown option: ${argv[index]}`);
    }
  }

  assert.ok(options.issuer, "--issuer is required.");
  assert.ok(
    options.validateIssuerOnly || options.baseUrl || options.publishableKey,
    "One of --base-url, --publishable-key, or --validate-issuer-only is required.",
  );

  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  // Validated first, and unconditionally. This is the check that rejects a bare
  // host, and Convex passes the value to `auth.config.ts` verbatim, so it has to
  // run on every path that can write the issuer.
  const expectedHost = issuerHost(options.issuer);

  // Format only. Split out so it can run on every path that writes the issuer,
  // including a rotation that legitimately skips the comparison below.
  if (options.validateIssuerOnly) {
    console.log(`CLERK_JWT_ISSUER_DOMAIN is a well-formed origin for ${expectedHost}.`);
    return;
  }

  const source = options.publishableKey ? "The configured publishable key" : options.baseUrl;
  const key = options.publishableKey || (await servedClerkKey(options.baseUrl.replace(/\/+$/, "")));

  if (!key) {
    const message = `${source} carries no Clerk publishable key, so its instance cannot be compared with the configured issuer.`;

    // A target stuck on a build from before Clerk existed serves no key at all,
    // and that is the outage this workflow has to remain able to fix.
    if (options.allowMissingKey) {
      console.log(`${message} Continuing: expected while recovering a pre-Clerk build.`);
      return;
    }

    console.error(`::error::${message} Check NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY on that environment.`);
    process.exit(1);
  }

  if (key.startsWith("pk_live_")) {
    console.error(
      "::error::That target serves a *production* Clerk key. Production and staging tenants must stay isolated; every session it mints would be a real one.",
    );
    process.exit(1);
  }

  const servedHost = decodeClerkKeyHost(key);

  if (servedHost !== expectedHost) {
    console.error(
      `::error::${source} names Clerk instance '${servedHost}' but Convex is configured to trust '${expectedHost}'. Convex would reject every signed-in request. Fix VRDEX_STAGING_CLERK_JWT_ISSUER_DOMAIN or the Vercel publishable key so both name one instance.`,
    );
    // Exit 2, not 1. A caller has to tell a *confirmed* mismatch from a failure
    // to reach the deployment at all: the first means the pairing is genuinely
    // wrong and a rollback repairs it, the second means we learned nothing and
    // rolling back would break a pairing that may well be correct.
    process.exit(MISMATCH_EXIT_CODE);
  }

  console.log(`Clerk key and Convex issuer both resolve to ${servedHost}.`);
}

const isDirectRun = process.argv[1]?.endsWith("check-clerk-issuer-match.mjs");

if (isDirectRun) {
  main().catch((error) => {
    console.error(`::error::${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
