import type { PublicEvent } from "./_eventPublic";
export type TimelineRange = { startAt: number; endAt: number; timeZone: string };
export type PlanReference =
  | { kind: "event"; eventId: string }
  | { kind: "set"; eventId: string; slotId: string };
export type TimelineSchedule =
  | { kind: "timed"; startAt: number; endAt: number }
  | { kind: "open_end"; startAt: number }
  | { kind: "date_only"; eventDate: string };
type TimelinePerson = { id: string; slug: string; displayName: string };
export type TimelineSlot = {
  id: string;
  eventId: string;
  displayLabel: string;
  performer?: TimelinePerson;
  schedule: Exclude<TimelineSchedule, { kind: "date_only" }>;
};
export type TimelineEvent = {
  id: string;
  slug: string;
  href?: string;
  title: string;
  host?: TimelinePerson & { imageUrl?: string };
  communityName?: string;
  status: "scheduled" | "cancelled";
  schedule: TimelineSchedule;
  slots: TimelineSlot[];
  performers: TimelinePerson[];
  rosterCursor: string | null;
};
export type TimelineEventIdentity = Omit<TimelineEvent, "slots" | "performers" | "rosterCursor">;
export type TimelinePage = { items: TimelineEvent[]; cursor: string | null; complete: boolean };
export type TimelineDetailRow = Pick<PublicEvent["lineup"][number], "key" | "position" | "displayLabel" | "roleLabel" | "startAt" | "endAt"> & {
  kind: "slot" | "lineup" | "participant";
  performer?: TimelinePerson;
};
export type TimelineRosterPage = { detail?: { kind: "unavailable" } | { kind: "available"; host?: TimelineEventIdentity["host"]; rows: TimelineDetailRow[] }; items: TimelineSlot[]; performers: TimelinePerson[]; cursor: string | null; complete: boolean };
type AvailableSaved = { kind: "available"; event: TimelineEventIdentity; status: TimelineEventIdentity["status"] };
export type SavedResolution =
  | { reference: PlanReference; kind: "unavailable" }
  | (AvailableSaved & { reference: Extract<PlanReference, { kind: "event" }>; slot?: never })
  | (AvailableSaved & { reference: Extract<PlanReference, { kind: "set" }>; slot: TimelineSlot });
