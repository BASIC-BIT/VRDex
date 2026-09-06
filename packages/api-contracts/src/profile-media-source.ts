/** Validate URL shape here; the fetcher checks public addresses at every hop. */
export function normalizeMcpContributionSourceUrl(value: string): string | null {
  if (value.length > 2_048 || /[\s\u0000-\u001f\u007f\\#]/u.test(value)) return null;
  let url: URL;
  try { url = new URL(value); } catch { return null; }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
  // Do not reserialize searchParams: query bytes can carry a signature.
  return url.toString();
}
