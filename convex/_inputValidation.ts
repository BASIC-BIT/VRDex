/**
 * Shared validation primitives for untrusted structured input.
 *
 * These started life as private helpers inside `_seedImports`, where the
 * operator seed pipeline was the only thing writing structured profile data.
 * Owner-authored and community-submitted profile links now run the same
 * checks, so they live here instead of being copied into a second module.
 */

export function normalizeInlineText(value: string, fieldName: string, maxLength: number): string {
  const normalized = value.trim().replace(/\s+/g, " ");

  if (!normalized) {
    throw new Error(`${fieldName} is required.`);
  }

  return normalized.slice(0, maxLength);
}

export function optionalInlineText(
  value: string | undefined,
  fieldName: string,
  maxLength: number,
): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  const normalized = value.trim().replace(/\s+/g, " ");

  if (!normalized) {
    return undefined;
  }

  return normalizeInlineText(normalized, fieldName, maxLength);
}

export function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

export function requireHttpsUrl(value: string | undefined, fieldName: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  const normalized = value.trim();

  if (!isHttpsUrl(normalized)) {
    throw new Error(`${fieldName} must be an HTTPS URL.`);
  }

  return normalized.slice(0, 2_048);
}

export function requireRecord(value: unknown, fieldName: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${fieldName} must be an object.`);
  }

  return value as Record<string, unknown>;
}

export function assertOnlyKeys(
  value: Record<string, unknown>,
  allowedKeys: string[],
  fieldName: string,
): void {
  const allowed = new Set(allowedKeys);
  const unexpected = Object.keys(value).find((key) => !allowed.has(key));

  if (unexpected !== undefined) {
    throw new Error(`${fieldName} contains unsupported key "${unexpected}".`);
  }
}

export function requireStringValue(value: unknown, fieldName: string): string {
  if (typeof value !== "string") {
    throw new Error(`${fieldName} must be a string.`);
  }

  return value;
}

export function optionalStringValue(value: unknown, fieldName: string): string | undefined {
  return value === undefined ? undefined : requireStringValue(value, fieldName);
}

export function requireArrayValue(value: unknown, fieldName: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${fieldName} must be an array.`);
  }

  return value;
}
