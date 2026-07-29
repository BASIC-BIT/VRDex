/** Written as a code-point scan so no escaping subtlety can hide a control byte. */
export function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;

    if (codePoint < 0x20 || codePoint === 0x7f) {
      return true;
    }
  }

  return false;
}

/**
 * Whether `value` is a safe same-origin return path.
 *
 * `startsWith("/") && !startsWith("//")` is not sufficient on its own: the
 * WHATWG URL parser normalizes backslashes to forward slashes for http(s), so
 * `/\evil.com` passes both checks and then resolves to `https://evil.com/`.
 * Backslashes and control characters are therefore rejected outright.
 */
export function isSafeReturnPath(value: string | null | undefined): value is string {
  return (
    typeof value === "string" &&
    value.startsWith("/") &&
    !value.startsWith("//") &&
    !value.includes("\\") &&
    !hasControlCharacter(value)
  );
}

export function safeReturnPath(value: string | null | undefined, fallback = "/account"): string {
  return isSafeReturnPath(value) ? value : fallback;
}

/**
 * Append query parameters to a return path, keeping them ahead of any fragment.
 *
 * The query component must precede the fragment, so appending blindly to a path
 * ending in `#…` would bury the parameters inside the fragment where the
 * destination page cannot read them.
 */
export function appendReturnPathQuery(
  path: string,
  params: Record<string, string | number | undefined>,
): string {
  const hashIndex = path.indexOf("#");
  const base = hashIndex >= 0 ? path.slice(0, hashIndex) : path;
  const hash = hashIndex >= 0 ? path.slice(hashIndex) : "";
  const queryIndex = base.indexOf("?");
  const pathname = queryIndex >= 0 ? base.slice(0, queryIndex) : base;
  const existing = new URLSearchParams(queryIndex >= 0 ? base.slice(queryIndex + 1) : "");

  // Replace, never append. These parameters are the callback's own statement
  // about what happened, and the pages that read them take the first value —
  // so a crafted `returnTo` already carrying `discordVerify=verified` kept
  // showing success after the callback appended `failed`. Deleting first also
  // covers an `undefined` value: the caller is saying this outcome does not
  // apply, and a stale one from the return path must not stand in for it.
  for (const [key, value] of Object.entries(params)) {
    existing.delete(key);

    if (value !== undefined) {
      existing.append(key, String(value));
    }
  }

  const query = existing.toString();

  return `${pathname}${query.length === 0 ? "" : `?${query}`}${hash}`;
}

/**
 * Resolve a return path against `origin`, refusing anything that lands on a
 * different host. Belt-and-braces alongside `isSafeReturnPath` so a future
 * parser quirk cannot turn a stored path into an off-site redirect.
 */
export function resolveSameOriginUrl(path: string, origin: string): URL {
  const base = new URL(origin);
  const resolved = new URL(path, base);

  if (resolved.host !== base.host || resolved.protocol !== base.protocol) {
    throw new Error("Return path resolved to a different origin.");
  }

  return resolved;
}
