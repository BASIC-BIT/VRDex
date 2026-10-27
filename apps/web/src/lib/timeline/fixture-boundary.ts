type FixtureEnvironment = {
  NODE_ENV?: string;
  VERCEL_ENV?: string;
  VRDEX_ENABLE_E2E_HELPERS?: string;
  VRDEX_E2E_BROWSER_TOKEN?: string;
  VRDEX_E2E_CONVEX_SECRET?: string;
  CONVEX_URL?: string;
  NEXT_PUBLIC_CONVEX_URL?: string;
};
function loopback(value: string | undefined): boolean {
  try {
    const u = new URL(value ?? "");
    return (
      u.protocol === "http:" &&
      ["127.0.0.1", "localhost", "[::1]"].includes(u.hostname)
    );
  } catch {
    return false;
  }
}
export function timelineFixtureBoundary(
  environment: FixtureEnvironment,
  targetUrl: string,
  requestToken: string | null,
): { url: string; secret: string } | null {
  const url = environment.CONVEX_URL ?? environment.NEXT_PUBLIC_CONVEX_URL;
  const token = environment.VRDEX_E2E_BROWSER_TOKEN?.trim(),
    secret = environment.VRDEX_E2E_CONVEX_SECRET?.trim();
  if (
    environment.NODE_ENV === "production" ||
    environment.VERCEL_ENV === "production" ||
    environment.VRDEX_ENABLE_E2E_HELPERS !== "true" ||
    !token ||
    !secret ||
    requestToken !== token ||
    !loopback(targetUrl) ||
    !loopback(url) ||
    !url
  )
    return null;
  return { url, secret };
}
