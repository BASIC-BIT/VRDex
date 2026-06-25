export function optionalField<T>(key: string, value: T | undefined): Record<string, T> {
  return value === undefined ? {} : { [key]: value };
}

export function safeHttpsUrl(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.href : undefined;
  } catch {
    return undefined;
  }
}

export function firstSafeHttpsUrl(...urls: Array<string | undefined>): string | undefined {
  for (const url of urls) {
    const safeUrl = safeHttpsUrl(url);

    if (safeUrl !== undefined) {
      return safeUrl;
    }
  }

  return undefined;
}
