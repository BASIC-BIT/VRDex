export default {
  providers: [
    {
      // Clerk Frontend API origin, e.g. https://<slug>.clerk.accounts.dev.
      // Must match the issuer of the `convex` JWT template on the Clerk instance.
      domain: process.env.CLERK_JWT_ISSUER_DOMAIN,
      applicationID: "convex",
    },
  ],
};
