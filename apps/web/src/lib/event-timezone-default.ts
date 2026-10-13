export function resolveEventTimezoneDefault({ savedPreference, browserTimezone }: { savedPreference?: string | null; browserTimezone?: string | null }): string {
  for (const zone of [savedPreference, browserTimezone]) {
    if (!zone || /^[+-]/.test(zone)) continue;
    try { new Intl.DateTimeFormat("en", { timeZone: zone }); return zone; } catch { /* Try the next default. */ }
  }
  return "UTC";
}
