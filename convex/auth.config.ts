// Convex sets CONVEX_CLOUD_URL on every deployment, including the throwaway one
// `convex dev --local` creates. Branching on it means CLERK_JWT_ISSUER_DOMAIN is
// only ever read on a hosted deployment, which is exactly where we want the
// Convex CLI to keep enforcing that it is set.
//
// Without this, `verify:backend:local` cannot pass: that command creates a local
// deployment and pushes in one step, so there is no point at which a variable
// could be set on it first, and the CLI's requirement check ignores fallbacks.
//
// The local placeholder is an unresolvable host on purpose. No Clerk instance can
// issue tokens for it, so a local backend rejects every token instead of
// trusting some other issuer.
const cloudUrl = process.env.CONVEX_CLOUD_URL ?? "";
const isLocalDeployment =
  cloudUrl.includes("127.0.0.1") || cloudUrl.includes("localhost");

// Clerk Frontend API origin, e.g. https://<slug>.clerk.accounts.dev. Must match
// the issuer of the `convex` JWT template on the Clerk instance.
const issuerDomain = isLocalDeployment
  ? "https://clerk-issuer.invalid"
  : process.env.CLERK_JWT_ISSUER_DOMAIN;

export default {
  providers: [
    {
      domain: issuerDomain,
      applicationID: "convex",
    },
  ],
};
