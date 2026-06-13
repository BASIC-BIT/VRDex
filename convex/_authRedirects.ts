export function siteRelativeRedirectUrl(redirectTo: string, siteUrl = process.env.SITE_URL) {
  if (!redirectTo.startsWith("/") || redirectTo.startsWith("//")) {
    throw new Error("Only relative redirects are allowed.");
  }

  const baseUrl = siteUrl?.trim().replace(/\/$/, "");

  if (!baseUrl) {
    throw new Error("SITE_URL must be configured before auth redirects.");
  }

  let parsedBaseUrl: URL;

  try {
    parsedBaseUrl = new URL(baseUrl);
  } catch {
    throw new Error("SITE_URL must be an absolute http/https URL.");
  }

  if (parsedBaseUrl.protocol !== "http:" && parsedBaseUrl.protocol !== "https:") {
    throw new Error("SITE_URL must be an absolute http/https URL.");
  }

  return `${baseUrl}${redirectTo}`;
}
