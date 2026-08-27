const PRODUCTION_SITE_URL = "https://vrdex.net";
const STAGING_SITE_URL = "https://staging.vrdex.net";
const LOCAL_SITE_URL = "http://127.0.0.1:3000";

function parsedHttpUrl(value: string | undefined): URL | null {
  if (!value?.trim()) {
    return null;
  }

  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

/**
 * Absolute metadata URLs must follow the deployment being previewed. Production
 * and shared staging stay on their canonical hosts; branch previews and local
 * Playwright runs keep generated share images on the same deployment as the page.
 */
export function publicSiteUrl(): URL {
  const configuredPublicUrl = parsedHttpUrl(process.env.VRDEX_PUBLIC_SITE_URL);
  if (configuredPublicUrl) {
    return configuredPublicUrl;
  }

  if (process.env.VERCEL_ENV === "production") {
    return new URL(PRODUCTION_SITE_URL);
  }

  if (process.env.VRDEX_DEPLOYMENT_ENV?.trim().toLowerCase() === "staging") {
    return new URL(STAGING_SITE_URL);
  }

  const vercelUrl = process.env.VERCEL_URL?.trim();
  if (vercelUrl) {
    return new URL(`https://${vercelUrl.replace(/^https?:\/\//, "")}`);
  }

  return (
    parsedHttpUrl(process.env.PLAYWRIGHT_BASE_URL) ??
    parsedHttpUrl(process.env.SITE_URL) ??
    new URL(LOCAL_SITE_URL)
  );
}

export function absolutePublicUrl(pathOrUrl: string): string {
  return new URL(pathOrUrl, publicSiteUrl()).href;
}
