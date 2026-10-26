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
  "America/Indianapolis": "Eastern (Indianapolis)", "America/Indiana/Indianapolis": "Eastern (Indianapolis)",
  "America/New_York": "Eastern", "America/Chicago": "Central", "America/Denver": "Mountain",
  "America/Los_Angeles": "Pacific", "Europe/London": "United Kingdom", "Europe/Berlin": "Central Europe",
  "Asia/Tokyo": "Japan", "Australia/Sydney": "Sydney", "Asia/Shanghai": "China", "UTC": "UTC",
};
aliases["Asia/Shanghai"] = ["china", "cst"];
export const commonEventTimezones = ["UTC", ...Object.keys(aliases)];

function timezoneName(value: string, instant: number, timeZoneName: "short" | "longOffset"): string | undefined {
  return new Intl.DateTimeFormat("en-US", { timeZone: value, timeZoneName }).formatToParts(instant).find(part => part.type === "timeZoneName")?.value;
}

export function eventTimezoneLabel(value: string, instant?: number): string {
  const region = regionNames[value] ?? value.replaceAll("_", " ").replaceAll("/", " / ");
  try {
    // Etc/GMT values have a permanent offset. Their IANA sign is reversed.
    if (/^Etc\/GMT[+-]\d{1,2}$/.test(value)) {
      const offset = timezoneName(value, 0, "longOffset")?.replace("GMT", "UTC");
      return offset ? `Fixed offset (${offset})` : region;
    }
    if (value === "UTC" || instant === undefined || !Number.isFinite(instant)) return region;
    const abbreviation = timezoneName(value, instant, "short");
    const offset = timezoneName(value, instant, "longOffset")?.replace("GMT", "UTC");
    const name = abbreviation && abbreviation !== region ? `${region} · ${abbreviation}` : region;
    return offset && offset !== name ? `${name} (${offset})` : name;
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
      const name = eventTimezoneLabel(value, instant);
      const identifier = value.replaceAll("_", " ");
      return { value, label: name.split(" \u00b7 ").includes(identifier) ? name : `${name} \u00b7 ${identifier}` };
    });
}
