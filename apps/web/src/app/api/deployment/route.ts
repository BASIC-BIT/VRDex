export const dynamic = "force-dynamic";

/**
 * What revision this deployment is running, as data.
 *
 * Replaces the `/deployment` page, which was the original Vercel/Convex
 * bring-up screen and had long outlived that purpose — it carried a visual
 * baseline and a route expectation for a screen nobody looks at.
 *
 * The E2E harness is the only real consumer: `hostedTargetRunsCurrentRevision`
 * and the claim flow's staging-lag tolerance both ask one question, "which
 * commit is this target on", and both were answering it by substring-matching
 * rendered HTML. A JSON route says it directly, has no appearance to snapshot,
 * and cannot drift when the page around it changes.
 *
 * Deliberately nothing but build identity. The page also reported whether Convex
 * and Clerk were configured and at which URLs, which is a description of a
 * deployment's configuration on an unauthenticated endpoint; `scripts/
 * check-clerk-issuer-match.mjs` and the staging runtime audit already answer
 * that from the outside, where it belongs.
 */
export function GET() {
  return Response.json(
    {
      commit: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
      branch: process.env.VERCEL_GIT_COMMIT_REF ?? null,
      environment: process.env.VERCEL_ENV ?? "local",
    },
    { headers: { "cache-control": "no-store" } },
  );
}
