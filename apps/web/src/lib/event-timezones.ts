export type EventTimezoneOption = { value: string; label: string };
const aliases: Record<string, string[]> = {
  "America/New_York": ["eastern", "est", "edt", "et"],
  "America/Chicago": ["central", "cst", "cdt", "ct"],
  "America/Denver": ["mountain", "mst", "mdt", "mt"],
  "America/Los_Angeles": ["pacific", "pst", "pdt", "pt"],
  "Europe/London": ["uk", "britain", "bst", "gmt"],
  "Europe/Berlin": ["cet", "cest"],
  "Asia/Tokyo": ["jst", "japan"],
  "Australia/Sydney": ["aest", "aedt"],
};
export function searchEventTimezones(query: string, date: string | null): EventTimezoneOption[] {
  const search = query.trim().toLowerCase().replaceAll("_", " ");
  const zones = new Set(["UTC", ...Intl.supportedValuesOf("timeZone"), ...Object.keys(aliases)]);
  // Intl's supported list omits valid aliases, including previously stored zones.
  if (query.includes("/") || query === "UTC") {
    try { new Intl.DateTimeFormat("en", { timeZone: query }); zones.add(query); } catch { /* Search text is not a zone. */ }
  }
  const instant = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T12:00:00Z`) : new Date();
  return [...zones].filter(zone => zone.toLowerCase().replaceAll("_", " ").includes(search) || aliases[zone]?.some(alias => alias.includes(search)))
    .sort((a, b) => Number(aliases[b]?.includes(search) || b.toLowerCase() === search) - Number(aliases[a]?.includes(search) || a.toLowerCase() === search) || a.localeCompare(b))
    .map(value => {
      const offset = new Intl.DateTimeFormat("en", { timeZone: value, timeZoneName: "longOffset" }).formatToParts(Number.isFinite(instant.getTime()) ? instant : new Date()).find(part => part.type === "timeZoneName")!.value.replace("GMT", "UTC");
      return { value, label: `${value.replaceAll("_", " ")} (${offset})` };
    });
}
