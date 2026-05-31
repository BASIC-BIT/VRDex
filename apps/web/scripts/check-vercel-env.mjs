const isVercel = process.env.VERCEL === "1" || process.env.VERCEL === "true";
const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
const requireConvexUrl = process.env.VRDEX_REQUIRE_CONVEX_URL === "true";

const errors = [];
const warnings = [];

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

if (isVercel && process.env.VERCEL_ENV === "production") {
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
