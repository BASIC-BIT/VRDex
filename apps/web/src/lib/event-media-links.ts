import type { Doc } from "../../../../convex/_generated/dataModel";
import { parseVrcdnStreamLinks } from "../../../../convex/_vrcdnLinks";

export type EventMediaLink = NonNullable<Doc<"events">["mediaLinks"]>[number];

function normalizeMediaType(value: string): EventMediaLink["type"] {
  const normalized = value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

  if (
    normalized === "event_page" ||
    normalized === "watch" ||
    normalized === "stream" ||
    normalized === "vrcdn" ||
    normalized === "discord" ||
    normalized === "ticket" ||
    normalized === "other"
  ) {
    return normalized;
  }

  return "other" as const;
}

/** One link per line of the `Media links` field: type | label | URL | open or copy. */
export function parseMediaLinks(value: string): EventMediaLink[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [type = "other", label = "Event link", url = "", presentation] = line
        .split("|")
        .map((part) => part.trim());
      const vrcdnLinks = parseVrcdnStreamLinks(type);

      if (vrcdnLinks !== null && url === "") {
        return {
          type: "vrcdn" as const,
          label: "VRCDN stream",
          url: vrcdnLinks.reference,
          presentation: "copy" as const,
        };
      }

      return {
        type: normalizeMediaType(type),
        label,
        url,
        presentation: presentation === "copy" ? ("copy" as const) : ("open" as const),
      };
    });
}

export function serializeMediaLinks(links: readonly EventMediaLink[]): string {
  return links.map((link) => `${link.type} | ${link.label} | ${link.url} | ${link.presentation}`).join("\n");
}
