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
const regionNames: Record<string, string> = {
  "America/New_York": "Eastern", "America/Chicago": "Central", "America/Denver": "Mountain",
  "America/Los_Angeles": "Pacific", "Europe/London": "United Kingdom", "Europe/Berlin": "Central Europe",
  "Asia/Tokyo": "Japan", "Australia/Sydney": "Sydney", "Asia/Shanghai": "China", "UTC": "UTC",
};
aliases["Asia/Shanghai"] = ["china", "cst"];
export const commonEventTimezones = ["UTC", ...Object.keys(aliases)];

export function eventTimezoneLabel(value: string, instant?: number): string {
  const region = regionNames[value] ?? value.replaceAll("_", " ").replaceAll("/", " / ");
  if (instant === undefined || !Number.isFinite(instant)) return region;
  try {
    const abbreviation = new Intl.DateTimeFormat("en-US", { timeZone: value, timeZoneName: "short" }).formatToParts(instant).find(part => part.type === "timeZoneName")?.value;
    return abbreviation && abbreviation !== region ? `${region} · ${abbreviation}` : region;
  } catch { return region; }
}

export function searchEventTimezones(query: string, _date: string | null, instant?: number): EventTimezoneOption[] {
  const search = query.trim().toLowerCase().replaceAll("_", " ");
  const zones = new Set(["UTC", ...Intl.supportedValuesOf("timeZone"), ...Object.keys(aliases)]);
  // Intl's supported list omits valid aliases, including previously stored zones.
  if (query.includes("/") || query === "UTC") {
    try { new Intl.DateTimeFormat("en", { timeZone: query }); zones.add(query); } catch { /* Search text is not a zone. */ }
  }
  return [...zones].filter(zone => zone.toLowerCase().replaceAll("_", " ").includes(search) || regionNames[zone]?.toLowerCase().includes(search) || aliases[zone]?.some(alias => alias.includes(search)))
    .sort((a, b) => Number(aliases[b]?.includes(search) || b.toLowerCase() === search) - Number(aliases[a]?.includes(search) || a.toLowerCase() === search) || a.localeCompare(b))
    .map(value => {
      const offset = instant === undefined || !Number.isFinite(instant) ? undefined : new Intl.DateTimeFormat("en-US", { timeZone: value, timeZoneName: "longOffset" }).formatToParts(instant).find(part => part.type === "timeZoneName")?.value.replace("GMT", "UTC");
      const name = eventTimezoneLabel(value, instant);
      const identifier = value.replaceAll("_", " ");
      const label = `${name}${offset && offset !== name ? ` (${offset})` : ""}`;
      return { value, label: name.split(" \u00b7 ").includes(identifier) ? label : `${label} \u00b7 ${identifier}` };
    });
}
