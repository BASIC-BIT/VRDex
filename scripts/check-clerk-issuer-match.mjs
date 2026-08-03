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
 * Usage:
 *   node scripts/check-clerk-issuer-match.mjs --base-url <origin> --issuer <origin>
 *                                             [--allow-missing-key]
 *
 * `--allow-missing-key` reports rather than fails when the target serves no
 * Clerk key at all. That is the recovery case: a target stuck on a build from
 * before Clerk existed has nothing to compare against, and refusing to proceed
 * would make the outage unfixable by the very workflow meant to fix it.
 */
import assert from "node:assert/strict";

const CLERK_KEY_PATTERN = /pk_(test|live)_[A-Za-z0-9+/=_-]+/;
const ISSUER_PATTERN = /^https:\/\/[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;

export function decodeClerkKeyHost(key) {
  const encoded = key.replace(/^pk_(test|live)_/, "");
  const padded = encoded + "=".repeat((4 - (encoded.length % 4)) % 4);

  return Buffer.from(padded, "base64").toString("utf8").replace(/\$+$/, "");
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

async function fetchText(url) {
  const response = await fetch(url, { redirect: "follow" });

  if (!response.ok) {
    return null;
  }

  return await response.text();
}

export async function servedClerkKey(baseUrl, fetchImpl = fetchText) {
  const html = await fetchImpl(`${baseUrl}/sign-in`);

  if (html === null) {
    return null;
  }

  const inline = html.match(CLERK_KEY_PATTERN);

  if (inline) {
    return inline[0];
  }

  // Next inlines the key into a client chunk rather than the shell.
  const scripts = [...new Set(html.match(/\/_next\/static\/[^"']+\.js/g) ?? [])];

  for (const script of scripts) {
    const body = await fetchImpl(`${baseUrl}${script}`);
    const match = body?.match(CLERK_KEY_PATTERN);

    if (match) {
      return match[0];
    }
  }

  return null;
}

function parseArgs(argv) {
  const options = { allowMissingKey: false, baseUrl: "", issuer: "" };

  for (let index = 0; index < argv.length; index += 1) {
    switch (argv[index]) {
      case "--allow-missing-key":
        options.allowMissingKey = true;
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

  assert.ok(options.baseUrl, "--base-url is required.");
  assert.ok(options.issuer, "--issuer is required.");

  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const expectedHost = issuerHost(options.issuer);
  const key = await servedClerkKey(options.baseUrl.replace(/\/+$/, ""));

  if (key === null) {
    const message = `${options.baseUrl} serves no Clerk publishable key, so its instance cannot be compared with the configured issuer.`;

    if (!options.allowMissingKey) {
      console.error(`::error::${message} Check NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY on that environment.`);
      process.exit(1);
    }

    console.log(`${message} Continuing: this is expected while recovering a target stuck on a pre-Clerk build.`);
    return;
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
      `::error::${options.baseUrl} serves a Clerk key for '${servedHost}' but Convex is configured to trust '${expectedHost}'. Convex would reject every signed-in request. Fix VRDEX_STAGING_CLERK_JWT_ISSUER_DOMAIN or the Vercel publishable key so both name one instance.`,
    );
    process.exit(1);
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
