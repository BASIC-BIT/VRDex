export function validMediaCleanupUrl(value: string | undefined): URL | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password &&
      url.pathname === "/api/internal/media-cleanup" ? url : null;
  } catch {
    return null;
  }
}
