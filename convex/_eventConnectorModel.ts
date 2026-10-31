// Dependency-free so the web client can import it without pulling server modules into the bundle.
export type ConnectorKind =
  | "discord_announcements" | "discord_board" | "discord_scheduled_events"
  | "google_calendar" | "vrchat_calendar" | "notion";
export type ConnectorDirection = "import" | "export" | "bidirectional" | "off";

const ALL_DIRECTIONS: ReadonlyArray<ConnectorDirection> = ["import", "export", "bidirectional", "off"];
// "off" stays allowed for every kind: it is how a staffer pauses a connector without removing it.
export function allowedDirections(kind: ConnectorKind): ReadonlyArray<ConnectorDirection> {
  if (kind === "discord_announcements") return ["import", "off"];
  if (kind === "discord_board") return ["export", "off"];
  if (kind === "notion") return ["off"];
  return ALL_DIRECTIONS;
}
