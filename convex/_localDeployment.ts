// convex/_localDeployment.ts
//
// Convex sets CONVEX_CLOUD_URL on every deployment, including the throwaway
// one `convex dev --local` creates. Anything that must never touch a hosted
// deployment gates on the URL being loopback, the same test auth.config.ts
// uses to pick the placeholder Clerk issuer.

export type LocalDeploymentEnvironment = Record<string, string | undefined>;

export function isLocalDeploymentUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const host = parsed.hostname;
  if (host === "localhost" || host === "[::1]" || host === "::1") {
    return true;
  }
  return /^127(?:\.\d{1,3}){3}$/.test(host);
}

export function requireLocalDeployment(
  environment: LocalDeploymentEnvironment = process.env,
): void {
  const cloudUrl = environment.CONVEX_CLOUD_URL ?? "";
  if (!isLocalDeploymentUrl(cloudUrl)) {
    throw new Error(
      "Local fixtures only run on a local deployment (CONVEX_CLOUD_URL must be loopback).",
    );
  }
}
