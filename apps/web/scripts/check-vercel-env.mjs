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
//
// Production is unconditional. Gating solely on `VRDEX_REQUIRE_CONVEX_URL` let a
// production deployment that merely omitted that flag build with no Clerk
// credentials at all: middleware would then redirect every protected route to
// `/sign-in`, which can only render the unavailable notice. Previews keep the
// opt-in so a shell-only build still works without auth secrets.
if (isVercel && (requireConvexUrl || isProductionVercel)) {
  for (const name of ["NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "CLERK_SECRET_KEY"]) {
    if (!process.env[name]?.trim()) {
      errors.push(
        isProductionVercel
          ? `${name} is required for production Vercel builds.`
          : `${name} is required when Convex is configured.`,
      );
    }
  }

}

// Tier validation is deliberately outside the block above: that one is gated on
// `VRDEX_REQUIRE_CONVEX_URL`, and a preview which simply omitted the flag would
// skip this entirely. Whenever a Clerk key is present on a Vercel build, it must
// match the environment's tier.
//
// Both tiers are checked positively, in both directions. Positively, because
// rejecting only the wrong prefix would let a truncated or otherwise malformed
// value through, and the build would succeed while ClerkProvider and the
// middleware failed at runtime. In both directions, because the tenants have to
// stay isolated either way: production carrying test keys is the obvious
// failure, but a preview carrying the *live* pair is the quieter one — it
// authenticates real users against the production Clerk tenant from an
// unreviewed deployment, where every session it mints is a real one.
//
// `infra/terraform/vercel/variables.tf` enforces the same split for keys managed
// as code; this catches the environments set by hand in the dashboard, which is
// where they live today.
if (isVercel) {
  const expectedTier = isProductionVercel ? "live" : "test";
  const clerkKeys = [
    ["NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "pk", "publishable"],
    ["CLERK_SECRET_KEY", "sk", "secret"],
  ];

  // Neither key is a valid state — that is the deliberate unconfigured-auth
  // fallback, where `ClerkProvider` is not mounted and the middleware fails
  // closed. Both keys is the working state. One key is neither: a lone
  // publishable key still makes `layout.tsx` mount `ClerkProvider` and
  // `middleware.ts` select `clerkMiddleware`, so the build succeeds and then
  // every server-side authentication fails at runtime for want of a secret.
  //
  // Checked here rather than in the block above because that one is gated on
  // `VRDEX_REQUIRE_CONVEX_URL`, so a preview omitting the flag never reached it.
  const present = clerkKeys.filter(([name]) => process.env[name]?.trim());

  if (present.length === 1) {
    const [missing] = clerkKeys.filter(([name]) => !process.env[name]?.trim());

    errors.push(
      `${missing[0]} is required because ${present[0][0]} is set. Set both Clerk keys, or neither for a build with authentication deliberately unconfigured.`,
    );
  }

  for (const [name, prefix, label] of clerkKeys) {
    const value = process.env[name]?.trim();

    if (value && !value.startsWith(`${prefix}_${expectedTier}_`)) {
      errors.push(
        `${name} must be a ${expectedTier} Clerk ${label} key (${prefix}_${expectedTier}_...) for ${
          isProductionVercel ? "production" : "non-production"
        } Vercel builds.`,
      );
    }
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

// `NEXT_PUBLIC_VRDEX_SUBMISSIONS_AUTH_READY` used to be rejected here to keep
// `/submit` locked until web auth existed. Clerk is that auth, and `/submit` is
// protected by `clerkMiddleware`, so the flag gated nothing and failing a build
// over it would now block a correctly configured deployment.

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
