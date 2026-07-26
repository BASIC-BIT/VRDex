export function optionalField<T>(key: string, value: T | undefined): Record<string, T> {
  return value === undefined ? {} : { [key]: value };
}

export function safeHttpsUrl(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : undefined;
  } catch {
    return undefined;
  }
}

export function safePublicImageUrl(value: string | undefined): string | undefined {
  if (value?.startsWith("/") && !value.startsWith("//")) {
    return value;
  }

  return safeHttpsUrl(value);
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

export function firstSafePublicImageUrl(...urls: Array<string | undefined>): string | undefined {
  for (const url of urls) {
    const safeUrl = safePublicImageUrl(url);

    if (safeUrl !== undefined) {
      return safeUrl;
    }
  }

  return undefined;
}
