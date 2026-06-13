export function siteRelativeRedirectUrl(redirectTo: string, siteUrl = process.env.SITE_URL) {
  if (!redirectTo.startsWith("/") || redirectTo.startsWith("//")) {
    throw new Error("Only relative redirects are allowed.");
  }

  const baseUrl = siteUrl?.trim().replace(/\/$/, "");

  if (!baseUrl) {
    throw new Error("SITE_URL must be configured before auth redirects.");
  }

  return `${baseUrl}${redirectTo}`;
}
