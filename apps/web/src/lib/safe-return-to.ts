export const DEFAULT_SIGN_IN_RETURN_TO = "/account";

function hasUnsafePathCharacters(value: string): boolean {
  let decoded = value;

  try {
    decoded = decodeURIComponent(value);
  } catch {
    return true;
  }

  return /[\\\u0000-\u001f\u007f]/.test(decoded) || decoded.startsWith("//");
}

export function validateSignInReturnTo(
  value: string | string[] | null | undefined,
  fallback = DEFAULT_SIGN_IN_RETURN_TO,
): string {
  const candidate = Array.isArray(value) ? value[0] : value;

  if (!candidate || !candidate.startsWith("/") || hasUnsafePathCharacters(candidate)) {
    return fallback;
  }

  try {
    const base = new URL("https://return-to.vrdex.invalid");
    const parsed = new URL(candidate, base);

    if (parsed.origin !== base.origin) {
      return fallback;
    }

    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}
