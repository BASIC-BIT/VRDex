const PRODUCTION_SITE_URL = "https://vrdex.net";
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
 * stays on the canonical host; Vercel previews and local Playwright runs keep
 * their generated share image on the same deployment as the page data.
 */
export function publicSiteUrl(): URL {
  const configuredPublicUrl = parsedHttpUrl(process.env.VRDEX_PUBLIC_SITE_URL);
  if (configuredPublicUrl) {
    return configuredPublicUrl;
  }

  if (process.env.VERCEL_ENV === "production") {
    return new URL(PRODUCTION_SITE_URL);
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
