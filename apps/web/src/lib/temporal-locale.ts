export function defaultCountryForLocale(locale: string) {
  try {
    const region = new Intl.Locale(locale).maximize().region?.toUpperCase();
    return region !== undefined && /^[A-Z]{2}$/.test(region) ? region : "";
  } catch {
    return "";
  }
}
