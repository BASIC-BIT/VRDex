import type { PaginationOptions } from "convex/server";
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

export function readScopedPagination(
  options: PaginationOptions,
  scope: string,
): PaginationOptions {
  return {
    ...options,
    cursor: readScopedCursor(options.cursor, scope),
    ...(options.endCursor === undefined
      ? {}
      : {
          endCursor:
            options.endCursor === null
              ? null
              : readScopedCursor(options.endCursor, scope),
        }),
  };
}
export function writeScopedPagination<
  T extends { continueCursor: string; splitCursor?: string | null },
>(page: T, scope: string): T {
  return {
    ...page,
    continueCursor: writeScopedCursor(page.continueCursor, scope),
    ...(page.splitCursor === undefined
      ? {}
      : {
          splitCursor:
            page.splitCursor === null
              ? null
              : writeScopedCursor(page.splitCursor, scope),
        }),
  };
}
