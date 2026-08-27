const managedProfileAssetPath = /^\/api\/v0\/profiles\/[^/]+\/assets\/[^/]+\/file$/;
const playwrightFixtureAssetPath = /^\/api\/e2e\/fixture-assets\/[^/]+$/;

export function inlineableProfileShareAssetUrl(
  imageUrl: string,
  siteUrl: URL,
): URL | null {
  try {
    const url = new URL(imageUrl, siteUrl);

    if (url.origin !== siteUrl.origin) return null;
    if (!managedProfileAssetPath.test(url.pathname) && !playwrightFixtureAssetPath.test(url.pathname)) {
      return null;
    }

    return url;
  } catch {
    return null;
  }
}
