export const dynamic = "force-dynamic";

/**
 * What this deployment is, as data.
 *
 * Replaces the `/deployment` page, which was the original Vercel/Convex
 * bring-up screen: nobody read it, and it carried two visual baselines and a
 * route expectation for a screen whose only consumers were machines parsing its
 * rendered HTML.
 *
 * Those consumers are the point, so the contract is preserved rather than
 * trimmed. `production-promote.yml` gates an alias move on the backend
 * identities below, and the E2E harness asks which commit a target runs. Both
 * were reading attributes out of markup; both now read fields.
 */

/**
 * A backend URL reported whole, or `unknown` when unset or unparseable.
 *
 * Deliberately not reduced to a host or an origin. Both clients receive this
 * value verbatim, so every part of it matters and each reduction hides a real
 * failure: a host comparison accepts `http://`, whose WebSocket an https origin
 * blocks, and an origin comparison accepts a stray path like `/wrong`, which
 * `ConvexHttpClient` would then target for every server-side call. Only trailing
 * slashes are normalised, being the one difference with no effect.
 */
function backendUrl(value: string | undefined) {
  const trimmed = value?.trim();

  if (!trimmed) {
    return "unknown";
  }

  try {
    // Parsed rather than string-matched, so a malformed value reports `unknown`
    // instead of being compared as-is.
    new URL(trimmed);
    return trimmed.replace(/\/+$/, "");
  } catch {
    return "unknown";
  }
}

/**
 * Frontend API origin the publishable key encodes. The key is base64 after its
 * prefix, so this is the only way to name the Clerk tenant from the client
 * bundle — the tier prefix alone does not distinguish one instance from another.
 */
function clerkFrontendApi() {
  const key = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim();

  if (!key) {
    return "unknown";
  }

  try {
    const decoded = atob(key.replace(/^pk_(test|live)_/, ""));

    return `https://${decoded.replace(/\$+$/, "")}`;
  } catch {
    return "unknown";
  }
}

export function GET() {
  return Response.json(
    {
      commit: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
      branch: process.env.VERCEL_GIT_COMMIT_REF ?? null,
      environment: process.env.VERCEL_ENV ?? "local",
      // Identity, not presence. "Configured" is equally true for a build pointed
      // at the staging Convex deployment, and promoting that would put vrdex.net
      // on the wrong dataset with the wrong auth configuration.
      //
      // Both Convex targets, because `convexHttpClient()` resolves
      // `CONVEX_URL ?? NEXT_PUBLIC_CONVEX_URL` — the API, OAuth, MCP and account
      // route handlers can read a different deployment than the browser while
      // the public URL looks correct.
      convexBrowser: backendUrl(process.env.NEXT_PUBLIC_CONVEX_URL),
      convexServer: backendUrl(process.env.CONVEX_URL ?? process.env.NEXT_PUBLIC_CONVEX_URL),
      clerkFrontendApi: clerkFrontendApi(),
    },
    { headers: { "cache-control": "no-store" } },
  );
}
