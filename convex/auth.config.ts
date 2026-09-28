// Convex sets CONVEX_CLOUD_URL on every deployment, including the throwaway one
// `convex dev --local` creates. Branching on it means a missing
// CLERK_JWT_ISSUER_DOMAIN is only ever fatal on a hosted deployment, which is
// exactly where we want the Convex CLI to keep enforcing that it is set.
//
// Without this, `verify:backend:local` cannot pass: that command creates a local
// deployment and pushes in one step, so there is no point at which a variable
// could be set on it first, and the CLI's requirement check ignores fallbacks.
//
// The local placeholder is an unresolvable host on purpose. No Clerk instance
// can issue tokens for it, so a local backend without CLERK_JWT_ISSUER_DOMAIN
// rejects every token instead of trusting some other issuer.
const cloudUrl = process.env.CONVEX_CLOUD_URL ?? "";
const isLocalDeployment =
  cloudUrl.includes("127.0.0.1") || cloudUrl.includes("localhost");

// On a local deployment a contributor may point the backend at their own Clerk
// development instance by setting CLERK_JWT_ISSUER_DOMAIN on it. When it is
// unset the placeholder below keeps every token rejected.
//
// The read is wrapped rather than written as `process.env.X ?? placeholder`:
// the backend evaluates this file against a `process.env` that raises when an
// unset variable is read, so a bare `??` never reaches its fallback and fails
// the push instead. `"X" in process.env` is not the alternative it looks like
// either -- it is always false here, so the override would be ignored in
// silence.
let localIssuerOverride: string | undefined;
try {
  localIssuerOverride = process.env.CLERK_JWT_ISSUER_DOMAIN;
} catch {
  localIssuerOverride = undefined;
}

// Clerk Frontend API origin, e.g. https://<slug>.clerk.accounts.dev. Must match
// the issuer of the `convex` JWT template on the Clerk instance.
const issuerDomain = isLocalDeployment
  ? (localIssuerOverride ?? "https://clerk-issuer.invalid")
  : process.env.CLERK_JWT_ISSUER_DOMAIN;

export default {
  providers: [
    {
      domain: issuerDomain,
      applicationID: "convex",
    },
  ],
};
