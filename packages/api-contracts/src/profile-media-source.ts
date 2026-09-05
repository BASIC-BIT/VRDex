/** Supported MCP contribution sources. This validates shape, not CDN access. */
export function normalizeMcpContributionSourceUrl(value: string): string | null {
  if (value.length > 2_048) return null;
  let url: URL;
  try { url = new URL(value); } catch { return null; }
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash) return null;
  if (!url.search) return url.toString();

  // Preserve the raw signed query. URLSearchParams would reserialize it.
  if (/[\s\u0000-\u001f\u007f\\#]/u.test(value) || url.hostname !== "cdn.discordapp.com") return null;
  const raw = /^https:\/\/[^/?#]+(\/[^?#]*)\?([^#]*)$/i.exec(value);
  const rawQuery = raw?.[2];
  if (!raw || rawQuery === undefined || raw[1] !== url.pathname || `?${rawQuery}` !== url.search) return null;
  const path = /^\/attachments\/[1-9]\d{0,19}\/[1-9]\d{0,19}\/([^/]+)$/.exec(url.pathname);
  const rawFilename = path?.[1];
  if (rawFilename === undefined) return null;
  try {
    const filename = decodeURIComponent(rawFilename);
    if (filename === "." || filename === ".." || /[/\\\u0000-\u001f\u007f]/u.test(filename)) return null;
  } catch { return null; }

  const pairs = rawQuery.replace(/&$/, "").split("&");
  if (pairs.length !== 3) return null;
  const keys = new Set<string>();
  for (const pair of pairs) {
    const match = /^(ex|is|hm)=([a-fA-F0-9]+)$/.exec(pair);
    const key = match?.[1];
    const hex = match?.[2];
    if (key === undefined || hex === undefined || keys.has(key)) return null;
    // Support bounds, not claims about Discord's signature or timestamp format.
    if (hex.length > (key === "hm" ? 256 : 16)) return null;
    keys.add(key);
  }
  return url.toString();
}

/** A signed source may not redirect to a different attachment or signature. */
export function assertMcpContributionSourceRedirect(sourceUrl: string, target: URL): void {
  const source = normalizeMcpContributionSourceUrl(sourceUrl);
  if (source === null || (new URL(source).search && target.toString() !== source)) {
    throw new Error("Profile media source redirect is not supported.");
  }
}
