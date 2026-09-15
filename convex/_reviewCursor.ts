/** Bind continuation to authenticated actor and exact filters, independently of Convex cursor internals. */
export function readScopedCursor(
  cursor: string | null,
  scope: string,
): string | null {
  if (!cursor) return null;
  try {
    const value = JSON.parse(cursor);
    if (value.scope !== scope || typeof value.cursor !== "string")
      throw new Error();
    return value.cursor;
  } catch {
    throw new Error("PAGE_CURSOR_INVALID");
  }
}
export function writeScopedCursor(cursor: string, scope: string) {
  return JSON.stringify({ scope, cursor });
}
