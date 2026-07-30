import { BlockList, isIP } from "node:net";

const isVercel = process.env.VERCEL === "1" || process.env.VERCEL === "true";
const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
const posthogHost = process.env.NEXT_PUBLIC_POSTHOG_HOST;
const requireConvexUrl = process.env.VRDEX_REQUIRE_CONVEX_URL === "true";
const isProductionVercel = isVercel && process.env.VERCEL_ENV === "production";

const errors = [];
const warnings = [];
const loopbackAddresses = new BlockList();

loopbackAddresses.addSubnet("127.0.0.0", 8, "ipv4");
loopbackAddresses.addAddress("::1", "ipv6");
loopbackAddresses.addSubnet("::ffff:127.0.0.0", 104, "ipv6");

function isLocalHost(hostname) {
  const host = hostname.toLowerCase().replace(/\.$/, "").replace(/^\[|\]$/g, "");
  const addressFamily = isIP(host);

  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    (addressFamily === 4 && loopbackAddresses.check(host, "ipv4")) ||
    (addressFamily === 6 && loopbackAddresses.check(host, "ipv6"))
  );
}

function parseUrl(name, value) {
  try {
    const url = new URL(value);

    if (!["http:", "https:"].includes(url.protocol)) {
      errors.push(`${name} must use http or https.`);
    }

    return url;
  } catch {
    errors.push(`${name} must be a valid URL.`);
    return null;
  }
}

if (process.env.VRDEX_ENABLE_PLAYWRIGHT_FIXTURES === "true") {
  errors.push("VRDEX_ENABLE_PLAYWRIGHT_FIXTURES must not be enabled for Vercel builds.");
}

if (isProductionVercel) {
  for (const name of [
    "VRDEX_ENABLE_E2E_HELPERS",
    "VRDEX_ENABLE_E2E_AUTH_HELPERS",
    "VRDEX_ENABLE_E2E_ADAPTER_HELPERS",
  ]) {
    if (process.env[name] === "true") {
      errors.push(`${name} must not be enabled for production Vercel builds.`);
    }
  }
}

// Clerk is the auth provider. Missing keys would build cleanly and then fail at
// runtime with nobody able to sign in, so fail the build instead. Convex-side
// CLERK_JWT_ISSUER_DOMAIN is enforced separately by the Convex CLI, which
// requires it on every hosted deployment (see convex/auth.config.ts).
if (isVercel && requireConvexUrl) {
  for (const name of ["NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "CLERK_SECRET_KEY"]) {
    if (!process.env[name]?.trim()) {
      errors.push(`${name} is required when Convex is configured.`);
    }
  }

  const publishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim();

  if (publishableKey && isProductionVercel && publishableKey.startsWith("pk_test_")) {
    errors.push(
      "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY must use a live Clerk instance (pk_live_) for production builds.",
    );
  }
}

if (isProductionVercel) {
  const rateLimitStore = process.env.VRDEX_RATE_LIMIT_STORE?.trim().toLowerCase();

  if (!rateLimitStore) {
    errors.push("VRDEX_RATE_LIMIT_STORE is required for production Vercel builds.");
  } else if (!["redis-rest", "upstash"].includes(rateLimitStore)) {
    errors.push("VRDEX_RATE_LIMIT_STORE must use redis-rest or upstash in production.");
  }

  const rateLimitRestUrl = process.env.VRDEX_RATE_LIMIT_REDIS_REST_URL;
  if (!rateLimitRestUrl) {
    errors.push("VRDEX_RATE_LIMIT_REDIS_REST_URL is required for production Vercel builds.");
  } else {
    const parsedRateLimitRestUrl = parseUrl(
      "VRDEX_RATE_LIMIT_REDIS_REST_URL",
      rateLimitRestUrl,
    );

    if (parsedRateLimitRestUrl?.protocol !== "https:") {
      errors.push("VRDEX_RATE_LIMIT_REDIS_REST_URL must use https in production.");
    }

    if (parsedRateLimitRestUrl) {
      if (isLocalHost(parsedRateLimitRestUrl.hostname)) {
        errors.push(
          "VRDEX_RATE_LIMIT_REDIS_REST_URL must not point at a local backend in production.",
        );
      }
    }
  }

  if (!process.env.VRDEX_RATE_LIMIT_REDIS_REST_TOKEN?.trim()) {
    errors.push("VRDEX_RATE_LIMIT_REDIS_REST_TOKEN is required for production Vercel builds.");
  }
}

if (process.env.NEXT_PUBLIC_VRDEX_SUBMISSIONS_AUTH_READY === "true") {
  errors.push("NEXT_PUBLIC_VRDEX_SUBMISSIONS_AUTH_READY must stay false until web auth is wired.");
}

if (convexUrl) {
  const parsedConvexUrl = parseUrl("NEXT_PUBLIC_CONVEX_URL", convexUrl);

  if (isVercel && parsedConvexUrl) {
    const host = parsedConvexUrl.hostname.toLowerCase();
    if (host === "localhost" || host === "127.0.0.1" || host.endsWith(".local")) {
      errors.push("NEXT_PUBLIC_CONVEX_URL must not point at a local backend for Vercel builds.");
    }
  }
} else if (requireConvexUrl) {
  errors.push("NEXT_PUBLIC_CONVEX_URL is required because VRDEX_REQUIRE_CONVEX_URL=true.");
} else if (isVercel) {
  warnings.push("NEXT_PUBLIC_CONVEX_URL is not set; the hosted app will render missing-backend states.");
}

if (posthogHost) {
  const parsedPosthogHost = parseUrl("NEXT_PUBLIC_POSTHOG_HOST", posthogHost);

  if (isVercel && parsedPosthogHost) {
    const host = parsedPosthogHost.hostname.toLowerCase();
    if (host === "localhost" || host === "127.0.0.1" || host.endsWith(".local")) {
      errors.push("NEXT_PUBLIC_POSTHOG_HOST must not point at a local backend for Vercel builds.");
    }
  }
}

for (const warning of warnings) {
  console.warn(`[vercel-env] ${warning}`);
}

if (errors.length > 0) {
  console.error("[vercel-env] Vercel environment validation failed:");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

const deploymentLabel = isVercel ? `Vercel ${process.env.VERCEL_ENV ?? "unknown"}` : "local";
console.log(`[vercel-env] ${deploymentLabel} environment accepted.`);
