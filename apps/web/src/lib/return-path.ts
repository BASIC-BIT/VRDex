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
