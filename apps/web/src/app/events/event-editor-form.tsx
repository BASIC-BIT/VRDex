"use client";
import { formatLineupTimeRange } from "@/lib/calendar/event-lineup-display";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { resolveEventTimezoneDefault } from "@/lib/event-timezone-default";
import { IntakeTime } from "./event-intake-form";
import { projectEditorTime, resolveEditorTime } from "@/lib/calendar/event-editor-time";
import { eventTimezoneLabel } from "@/lib/event-timezones";
import { EventTimezonePicker } from "../_components/event-timezone-picker";
import { resolveEventLocalTime, selectEventLocalTime } from "../../../../../packages/api-contracts/src/event-intake";
import type { ChangeEvent, FormEvent, ReactNode } from "react";
import { Fragment, useEffect, useRef, useState, useTransition } from "react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { api } from "@convex-generated-api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import type { PlaybackStream } from "../../../../../convex/_eventPlayback";
import type { PublicEvent } from "../_components/event-public-page";
import { buttonVariants, Button } from "@/components/ui/button";
import { Card, Eyebrow, SectionTitle } from "@/components/ui/card";
import { Field, FieldText, Input, Select, Textarea } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { BACKEND_ERROR_COPY } from "@/lib/error-copy";
import { VrcdnMediaLinkAssistant } from "../_components/vrcdn-media-link-assistant";
import { ViewerLocalEventDateTime } from "../_components/viewer-local-event-times";
import { parseVrcdnStreamLinks } from "../../../../../convex/_vrcdnLinks";
import {
  browserTimeZone,
  formatZonedDateTimeInput,
} from "@/lib/calendar/zoned-date-time";
import { applyStaffLineupTimings, changeStaffSlotOffset, readStaffLineupTimings, type SlotFormRow } from "@/lib/calendar/event-lineup-adapters";
import { changeLineupDuration, generateLineupTimings, getLineupEndAt, getLineupEndConflict, insertLineupSlot, removeLineupSlot, shiftLineupStart, type LineupEditResult, type LineupTimingRow } from "@/lib/calendar/event-lineup-timing";
import { EventLineupSetup, EventLineupInsert, EventSlotDuration, EventLineupReset, EventLineupConflict } from "./event-lineup-controls";
import { resolveAuthoredEventEndAt } from "@/lib/calendar/event-end-time";
import { EventEditorSteps, type EventEditorStep } from "./event-editor-steps";
import { EventLocationField } from "./event-location-field";
import type { EventIdentityOption } from "@/lib/event-editor-identity";
import { EventEditorPreview, EventCommunitySummary, useEventCommunity } from "./event-editor-preview";
import { EventPerformerField, useEventPerformerEditor } from "./event-performer-field";

type EventMediaLinkType = PublicEvent["mediaLinks"][number]["type"];

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;

type EventEditorStatus =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "success"; result: { eventPath: string; slug: string } }
  | { kind: "error"; message: string; streamSelections?: Record<string, string> };

type VrcdnOutputStatus =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "success" }
  | { kind: "error"; message: string };

type VrcdnOutputFormState = {
  outputAccount: string;
  label: string;
  browserUrl: string;
  standaloneUrl: string;
  pcUrl: string;
  authorized: boolean;
};

export type EditableEvent = Omit<PublicEvent, "slots"> & {
  usesCanonicalLineup?: boolean;
  retainedLineupAssociations?: { participantIds: Id<"eventParticipants">[]; slotIds: Id<"eventSlots">[] };
  slots: Array<PublicEvent["slots"][number] & { clientKey?: string; selectedStreamId?: string; streamChoices?: PlaybackStream[] }>;
  notes?: string;
  preservedCommunityProfileId?: Id<"profiles">;
  preservedParticipantAssociationIds: Id<"eventParticipants">[];
  preservedSlotAssociationIds: Id<"eventSlots">[];
  preservedWorldAssociationIds: Id<"eventWorlds">[];
  editableWorldAssociation?: { associationId: Id<"eventWorlds">; worldSlug: string };
  publicationState?: "draft_private" | "published";
};

type EventAssociationSnapshot = Pick<
  EditableEvent,
  | "preservedParticipantAssociationIds"
  | "preservedSlotAssociationIds"
  | "preservedWorldAssociationIds"
>;

type VrcdnOutputAccountOption = {
  key: string;
  label: string;
  playbackLinks: Array<{
    platform: "browser" | "pc" | "standalone";
    label?: string;
    url: string;
  }>;
};

function SlotStreamSelect({ row, invalid, onChange }: { row: SlotFormRow; invalid?: boolean; onChange: (value: string) => void }) {
  const slug = row.personSlug.trim();
  const currentChoices = useQuery(api.events.getPersonStreamChoices, /^[a-z0-9-]{1,64}$/.test(slug) ? { slug } : "skip");
  const choices = slug ? currentChoices ?? row.streamChoices ?? [] : [];
  const unavailable = Boolean(row.selectedStreamId && !choices.some(choice => choice.streamId === row.selectedStreamId));
  return <Field className="text-xs text-muted">
    Stream
    <Select aria-label="Stream" aria-invalid={invalid || undefined} className={invalid ? "border-danger" : undefined} onChange={event => onChange(event.currentTarget.value)} value={row.selectedStreamId ?? ""}>
      <option value="">{choices.length === 1 ? `Automatic: ${choices[0]!.streamId}` : choices.length === 0 ? "Unavailable" : "Select stream"}</option>
      {unavailable ? <option value={row.selectedStreamId}>{row.selectedStreamId} (Unavailable)</option> : null}
      {choices.length > 1 || row.selectedStreamId ? choices.map(choice => <option key={choice.streamId} value={choice.streamId}>{choice.streamId}</option>) : null}
    </Select>
  </Field>;
}

const userSafeErrorPatterns = [
  /Ambiguous local time requires an earlier or later occurrence\./,
  /Local time does not exist in this timezone\./,
  /Event changes require a signed-in user\./,
  /Event start time must be a valid timestamp\./,
  /Doors-open time must be a valid timestamp\./,
  /Event end time must be a valid timestamp\./,
  /(?:Event start|Event end|Doors-open) time must be a valid local time in .+\./,
  /Event title must be at least \d+ characters\./,
  /Event title must be \d+ characters or fewer\./,
  /Doors-open time must be at or before the event start time\./,
  /Doors-open offset minutes must be (?:a whole number|zero or greater)\./,
  /Event end time must be after the start time\./,
  /Time zone must be a valid IANA time zone\./,
  /Time zone is required when event slots are provided\./,
  /(?:Event source URL|Poster image URL|Banner image URL|Thumbnail image URL|Media link URL|Participant source URL|Slot source URL) must (?:use https|be a valid URL)\./,
  /(?:Slot start time|Slot end time) must be a valid timestamp\./,
  /(?:Slot count|Slot offset minutes|Slot duration minutes|Break duration minutes) must be a whole number\./,
  /Slot end time must be after the start time\./,
  /Slot start time must be at or after the event start time\./,
  /Slot end time must be at or before the event end time\./,
  /Slot display label must be at least \d+ characters\./,
  /(?:Slot display label|Slot role|Slot source label|Slot notes) must be \d+ characters or fewer\./,
  /Event slots can include at most \d+ entries\./,
  /Participant links can include at most \d+ unique profiles including linked slot performers\./,
  /Community profile was not found\./,
  /World profile was not found or is not published\./,
  /Person profile ".+" was not found\./,
  /You do not have permission to update this event\./,
  /You do not have permission to move this event to another community\./,
  /Current event code is invalid\./,
  /Event was not found\./,
  /Output account is required\./,
  /Output account is not configured\./,
  /Output label is required\./,
  /Output label must be \d+ characters or fewer\./,
  /Watch preview URL is required\./,
  /Confirm you are authorized to publish this output\./,
  /Media control public links must use HTTPS or a recognized VRCDN stream URL\./,
];

function isUnavailableStreamError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /^(?:Uncaught Error: )?Selected stream must belong to the performer's public streams\.$/m.test(message);
}

function eventEditorErrorMessage(error: unknown): string {
  if (isUnavailableStreamError(error)) return "Stream unavailable";
  const message = error instanceof Error ? error.message : String(error);

  if (/Credential secret reference/.test(message)) {
    return "Output account is not configured.";
  }

  for (const pattern of userSafeErrorPatterns) {
    const match = message.match(pattern);

    if (match) {
      return match[0];
    }
  }

  return BACKEND_ERROR_COPY;
}

function stringField(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value : "";
}

function optionalString(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

function createInitialVrcdnOutputForm(event: PublicEvent | undefined): VrcdnOutputFormState {
  // Derived from the stored reference rather than matched out of three rows.
  // Every spelling of one stream canonicalizes to the same `vrcdn:<id>` now, so
  // the sanitizer dedupes them into a single link and there is no `.live.ts`
  // row or `rtspt://` row left to find.
  const vrcdnLink = (event?.mediaLinks ?? [])
    .map((link) => ({ label: link.label, stream: parseVrcdnStreamLinks(link.url) }))
    .find((entry) => entry.stream !== null);

  return {
    outputAccount: "",
    label: vrcdnLink?.label ?? "Event stream",
    browserUrl: vrcdnLink?.stream?.hlsUrl ?? "",
    standaloneUrl: vrcdnLink?.stream?.questUrl ?? "",
    pcUrl: vrcdnLink?.stream?.pcUrl ?? "",
    authorized: false,
  };
}

function applyVrcdnOutputAccountDefaults(
  current: VrcdnOutputFormState,
  account: VrcdnOutputAccountOption,
): VrcdnOutputFormState {
  const browserLink = account.playbackLinks.find((link) => link.platform === "browser");
  const standaloneLink = account.playbackLinks.find((link) => link.platform === "standalone");
  const pcLink = account.playbackLinks.find((link) => link.platform === "pc");

  return {
    ...current,
    outputAccount: account.key,
    label: browserLink?.label ?? current.label,
    browserUrl: browserLink?.url ?? current.browserUrl,
    standaloneUrl: standaloneLink?.url ?? current.standaloneUrl,
    pcUrl: pcLink?.url ?? current.pcUrl,
  };
}

function parseInteger(value: string, fieldName: string): number {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new Error(`${fieldName} is required.`);
  }

  const parsed = Number(normalized);

  if (!Number.isInteger(parsed)) {
    throw new Error(`${fieldName} must be a whole number.`);
  }

  return parsed;
}

function parseMediaLinks(value: string) {
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

function normalizeMediaType(value: string): EventMediaLinkType {
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

function parseSlotRows(rows: SlotFormRow[], eventStartAt: number) {
  return rows.map((row) => {
      const offsetMinutes = row.startAtOverride === undefined ? parseInteger(row.offsetMinutes, "Slot offset minutes") : 0;
      const durationMinutes = row.endAtOverride !== undefined || row.durationMsOverride !== undefined || optionalString(row.durationMinutes) === undefined
        ? undefined
        : parseInteger(row.durationMinutes, "Slot duration minutes");
      const startAt = row.startAtOverride ?? eventStartAt + offsetMinutes * 60_000;

      return {
        personSlug: optionalString(row.personSlug),
        selectedStreamId: optionalString(row.selectedStreamId ?? "") ?? null,
        displayLabel:
          optionalString(row.displayLabel) ??
          "",
        roleLabel: optionalString(row.roleLabel) ?? "Participant",
        startAt,
        ...(row.endAtOverride !== undefined ? { endAt: row.endAtOverride } : row.durationMsOverride !== undefined ? { endAt: startAt + row.durationMsOverride } : durationMinutes === undefined ? {} : { endAt: startAt + durationMinutes * 60_000 }),
      };
    });
}

function serializeMediaLinks(event: PublicEvent | undefined): string {
  return (event?.authoredMediaLinks ?? event?.mediaLinks ?? [])
    .map((link) => `${link.type} | ${link.label} | ${link.url} | ${link.presentation}`)
    .join("\n");
}

function initialSlotRows(event: EditableEvent | undefined): SlotFormRow[] {
  if (event === undefined) {
    return [];
  }

  return event.slots.map((slot, index) => ({
    position: slot.position,
    startAtOverride: slot.startAt,
    endAtOverride: slot.endAt,
    id: slot.clientKey ?? slot.playbackKey ?? `stored-${slot.position}-${slot.startAt}-${index}`,
    offsetMinutes: String(Math.round((slot.startAt - (event.startAt ?? slot.startAt)) / 60_000)),
    durationMinutes:
      slot.endAt === undefined
        ? ""
        : String(Math.round((slot.endAt - slot.startAt) / 60_000)),
    personSlug: slot.performer?.slug ?? "",
    selectedStreamId: slot.selectedStreamId,
    streamChoices: slot.streamChoices,
    displayLabel: slot.displayLabel,
    roleLabel: slot.roleLabel,
  }));
}

function eventTargetValue(changeEvent: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>): string {
  return changeEvent.currentTarget.value;
}

function eventTargetChecked(changeEvent: ChangeEvent<HTMLInputElement>): boolean {
  return changeEvent.currentTarget.checked;
}

function formatPrivateTimestamp(timestamp: number | undefined): string {
  if (timestamp === undefined) {
    return "Not set";
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(timestamp));
}

function formatMachineValue(value: string | number | undefined): string {
  if (value === undefined) {
    return "Not recorded";
  }

  return String(value).replaceAll("_", " ");
}

function shortTaskId(value: string | undefined): string {
  if (value === undefined) {
    return "Not recorded";
  }

  return value.split("/").at(-1) ?? value;
}

function chooseVisibleWorkerSession<Session extends { status: string; updatedAt: number }>(sessions: Session[]): Session | undefined {
  return sessions.find((session) => ["starting", "live", "hold", "fallback", "stopping"].includes(session.status)) ?? sessions[0];
}

function EditorSection({ children, title }: { children: ReactNode; title: string }) {
  return (
    <section className="grid gap-5 border-b border-border pb-8">
      <h2 className="text-2xl font-semibold tracking-[-0.03em]">{title}</h2>
      {children}
    </section>
  );
}

function EditorDisclosure({ children, title }: { children: ReactNode; title: string }) {
  return (
    <details className="group border-b border-border pb-6">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-2 text-xl font-semibold tracking-[-0.02em] marker:hidden">
        {title}
        <span aria-hidden="true" className="text-muted transition group-open:rotate-45">+</span>
      </summary>
      <div className="mt-5 grid gap-5 rounded-panel border border-border bg-surface px-4 py-5 sm:px-6 sm:py-6">
        {children}
      </div>
    </details>
  );
}

function DisabledEventEditorPanel() {
  return (
    <Card surface="dashed">
      <Eyebrow>Event editor</Eyebrow>
      <SectionTitle className="mt-4 text-2xl tracking-[-0.03em]">Convex URL not configured</SectionTitle>
      <p className="mt-3 text-sm leading-7 text-muted">
        Run <code className="font-mono text-[0.95em]">pnpm bootstrap:backend:local</code> before testing event creation locally.
      </p>
    </Card>
  );
}

function SignInRequiredEventEditorPanel() {
  return (
    <Card surface="dashed">
      <Eyebrow>Event editor</Eyebrow>
      <SectionTitle className="mt-4 text-2xl tracking-[-0.03em]">Sign-in required</SectionTitle>
    </Card>
  );
}

function storedTimeOccurrence(instant?: number, timezone?: string): "earlier" | "later" | "" {
  if (instant === undefined || !timezone) return "";
  const local = formatZonedDateTimeInput(instant, timezone);
  const choices = resolveEventLocalTime(local.slice(0, 10), { time: local.slice(11, 16) }, timezone);
  return choices.length > 1 ? (Math.floor(choices[0]! / 60_000) === Math.floor(instant / 60_000) ? "earlier" : "later") : "";
}

function resolveStaffStartAt(local: string, timezone: string, occurrence: "earlier" | "later" | "", event?: { startAt?: number; timezone?: string }): number {
  if (event?.startAt !== undefined && local === formatZonedDateTimeInput(event.startAt, event.timezone) && timezone === event.timezone && occurrence === storedTimeOccurrence(event.startAt, event.timezone)) {
    return event.startAt;
  }
  return selectEventLocalTime(local.slice(0, 10), { time: local.slice(11, 16), ...(occurrence ? { occurrence } : {}) }, timezone);
}

function ConnectedEventEditorForm({
  communitySlug,
  communityName,
  demoMode = false,
  event,
  heading,
  savedTimezonePreference,
}: {
  communitySlug: string;
  communityName?: string;
  demoMode?: boolean;
  event?: EditableEvent;
  heading?: ReactNode;
  savedTimezonePreference?: string | null;
}) {
  const router = useRouter();
  const [activeStep, setActiveStep] = useState<EventEditorStep>("Details");
  const knownCommunity: EventIdentityOption | undefined = communityName || event?.communityName ? { kind: "community", slug: communitySlug, title: communityName || event?.communityName || "", href: `/${communitySlug}`, imageUrl: event?.communityImageUrl, imageKind: "logo", appearance: event?.communityAvatarAppearance } : undefined;
  const community = useEventCommunity(communitySlug, knownCommunity);
  const initialWorld = event?.worlds[0];
  const [location, setLocation] = useState({ worldSlug: initialWorld?.slug ?? "", venueLabel: event?.venueLabel ?? "" });
  const [worldEdited, setWorldEdited] = useState(false);
  const worldEditRevision = useRef(0);
  const [editableWorld, setEditableWorld] = useState(event?.editableWorldAssociation);
  const initialWorldOption: EventIdentityOption | undefined = initialWorld ? { kind: "world", slug: initialWorld.slug, title: initialWorld.displayName, href: `/${initialWorld.slug}`, imageUrl: initialWorld.heroImageUrl, imageKind: "profile" } : undefined;
  const [selectedWorld, setSelectedWorld] = useState(initialWorldOption);
  const world = selectedWorld?.slug === location.worldSlug ? selectedWorld : undefined;
  const [preview, setPreview] = useState({ title: event?.title ?? (demoMode ? "Afterglow Harbor Sessions" : ""), summary: event?.summary ?? "", venueLabel: event?.venueLabel ?? "", artwork: event?.posterImageUrl ?? "" });
  const [eventDate, setEventDate] = useState(event?.eventDate ?? formatZonedDateTimeInput(event?.startAt, event?.timezone).slice(0, 10));
  const [timeTba, setTimeTba] = useState(event?.scheduleKind === "date_only");
  const performers = useEventPerformerEditor([...(event?.slots.flatMap(row => row.performer ? [row.performer] : []) ?? []), ...(event?.participants ?? []), ...(event?.lineup?.flatMap(row => row.performer ? [row.performer] : []) ?? [])].map(person => ({ kind: "person", slug: person.slug, title: person.displayName, href: `/${person.slug}`, imageUrl: person.imageUrl, imageKind: "profile", trustLabel: person.trustLabel })));
  const [untimedRows, setUntimedRows] = useState(() => (event?.lineup ?? []).filter(row => row.startAt === undefined).map(row => ({
    clientKey: row.key, position: row.position, performerLabel: row.displayLabel, personSlug: row.performer?.slug ?? "", roleLabel: row.roleLabel ?? "",
  })));
  const [startInstantOverride, setStartInstantOverride] = useState<number>();
  const [startLocal, setStartLocal] = useState(formatZonedDateTimeInput(event?.startAt, event?.timezone));
  const [occurrence, setOccurrence] = useState<"earlier" | "later" | "">(() => storedTimeOccurrence(event?.startAt, event?.timezone));
  const [endLocal, setEndLocal] = useState(event?.endAt === undefined ? "" : formatZonedDateTimeInput(event.endAt, event.timezone));
  const [endOccurrence, setEndOccurrence] = useState<"earlier" | "later" | "">(() => storedTimeOccurrence(event?.endAt, event?.timezone));
  const [endOpen, setEndOpen] = useState(event?.endAt !== undefined);
  const [endEdited, setEndEdited] = useState(false);
  const createEvent = useMutation(api.events.createCommunityEvent);
  const updateEvent = useMutation(api.events.updateCommunityEvent);
  const setEventCancelled = useMutation(api.events.setCommunityEventCancelled);
  const configureVrcdnOutput = useMutation(api.events.configureVrcdnOutput);
  const vrcdnOutputAccounts = useQuery(api.events.listVrcdnOutputAccounts, demoMode ? "skip" : {});
  const [currentSlug, setCurrentSlug] = useState(event?.slug);
  const eventMediaControlStatus = useQuery(api.events.getEventMediaControlStatus, currentSlug === undefined ? "skip" : { currentSlug });
  const eventAudit = useQuery(
    api.events.listEventAudit,
    currentSlug === undefined ? "skip" : { currentSlug, limit: 40 },
  );
  const [status, setStatus] = useState<EventEditorStatus>({ kind: "idle" });
  const [vrcdnOutputStatus, setVrcdnOutputStatus] = useState<VrcdnOutputStatus>({ kind: "idle" });
  const [timezone, setTimezone] = useState(event?.timezone ?? "");
  const timezoneAuthored = useRef(event !== undefined);
  const editingTimezoneAuthored = useRef(false);
  const [editingTimezone, setEditingTimezone] = useState(() => resolveEventTimezoneDefault({ savedPreference: savedTimezonePreference }));
  useEffect(() => {
    if (editingTimezoneAuthored.current || (!event && timezoneAuthored.current) || formRef.current?.querySelector('[data-time-pending="true"]')) return;
    const zone = resolveEventTimezoneDefault({ savedPreference: savedTimezonePreference, browserTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone });
    setEditingTimezone(zone);
    if (!timezoneAuthored.current) setTimezone(zone);
  }, [savedTimezonePreference, event]);
  const tbaDisplayDate = useRef<string | undefined>(undefined);
  const timedDateBackup = useRef<string | undefined>(undefined);
  const [doorsAtOverride, setDoorsAtOverride] = useState<number | null>();
  const [doorsOpen, setDoorsOpen] = useState(event?.doorsOpenAt !== undefined);
  const [doorsOpenMinutes, setDoorsOpenMinutes] = useState(() => event?.doorsOpenAt === undefined || event.startAt === undefined
    ? ""
    : String(Math.max(0, Math.round((event.startAt - event.doorsOpenAt) / 60_000))));
  const [watchSurfaceEnabled, setWatchSurfaceEnabled] = useState(event?.watchSurfaceEnabled ?? false);
  const [watchMode, setWatchMode] = useState<"event_stream" | "performer_sequence">(event?.watchMode ?? "event_stream");
  const [mediaLinksText, setMediaLinksText] = useState(() => serializeMediaLinks(event));
  const [vrcdnOutput, setVrcdnOutput] = useState<VrcdnOutputFormState>(() => createInitialVrcdnOutputForm(event));
  const [slotRows, setSlotRows] = useState(() => initialSlotRows(event));
  const [lineupEdited, setLineupEdited] = useState(false);
  const [scheduleChanged, setScheduleChanged] = useState(false);
  const startAnchor = useRef(event?.startAt);
  const [endAtOverride, setEndAtOverride] = useState<number>();
  const formRef = useRef<HTMLFormElement>(null);
  const [cancellationReason, setCancellationReason] = useState("");
  const [eventStatus, setEventStatus] = useState(event?.status);
  const [isPublished, setIsPublished] = useState(event?.publicationState === "published");
  const [unrepresentedLineupAssociations] = useState(event?.retainedLineupAssociations);
  const [associationSnapshot, setAssociationSnapshot] = useState<EventAssociationSnapshot>({
    preservedParticipantAssociationIds: event?.preservedParticipantAssociationIds ?? [],
    preservedSlotAssociationIds: event?.preservedSlotAssociationIds ?? [],
    preservedWorldAssociationIds: event?.preservedWorldAssociationIds ?? [],
  });
  const [, startTransition] = useTransition();

  useEffect(() => {
    if (vrcdnOutputAccounts === undefined || vrcdnOutputAccounts.length === 0) {
      return;
    }

    setVrcdnOutput((current) => {
      if (current.outputAccount !== "") {
        return current;
      }

      return applyVrcdnOutputAccountDefaults(current, vrcdnOutputAccounts[0]!);
    });
  }, [vrcdnOutputAccounts]);

  function updateSlotRows(updater: (rows: SlotFormRow[]) => SlotFormRow[]) {
    timezoneAuthored.current = true;
    setSlotRows((rows) => updater(rows));
    setLineupEdited(true);
  }

  function updateUntimedRows(updater: (rows: typeof untimedRows) => typeof untimedRows) {
    setUntimedRows(updater);
    setLineupEdited(true);
  }

  async function onSaveVrcdnOutput() {
    if (event === undefined || watchMode !== "event_stream") {
      return;
    }

    setVrcdnOutputStatus({ kind: "submitting" });

    try {
      const outputAccount = optionalString(vrcdnOutput.outputAccount);
      const label = optionalString(vrcdnOutput.label);
      const browserUrl = optionalString(vrcdnOutput.browserUrl);
      const standaloneUrl = optionalString(vrcdnOutput.standaloneUrl);
      const pcUrl = optionalString(vrcdnOutput.pcUrl);

      if (outputAccount === undefined) {
        throw new Error("Output account is required.");
      }

      if (label === undefined) {
        throw new Error("Output label is required.");
      }

      if (browserUrl === undefined) {
        throw new Error("Watch preview URL is required.");
      }

      if (!vrcdnOutput.authorized) {
        throw new Error("Confirm you are authorized to publish this output.");
      }

      await configureVrcdnOutput({
        currentSlug: currentSlug!,
        key: "main-vrcdn",
        label,
        outputAccountKey: outputAccount,
        playbackLinks: [
          { platform: "browser" as const, label, url: browserUrl },
          ...(standaloneUrl === undefined ? [] : [{ platform: "standalone" as const, label: "Quest stream", url: standaloneUrl }]),
          ...(pcUrl === undefined ? [] : [{ platform: "pc" as const, label: "PC stream", url: pcUrl }]),
        ],
        sourceConsentAccepted: true,
        destinationAuthorityAccepted: true,
        providerRulesAccepted: true,
        rightsClearedMediaAccepted: true,
      });

      startTransition(() => setVrcdnOutputStatus({ kind: "success" }));
    } catch (error) {
      startTransition(() => setVrcdnOutputStatus({ kind: "error", message: eventEditorErrorMessage(error) }));
    }
  }

  async function onSubmit(submitEvent: FormEvent<HTMLFormElement>) {
    submitEvent.preventDefault();
    if (status.kind === "submitting") return;

    const form = submitEvent.currentTarget;
    const formData = new FormData(form, (submitEvent.nativeEvent as SubmitEvent).submitter);
    const intent = stringField(formData.get("intent"));
    if (intent === "continue" || (!intent && activeStep !== "Review")) { setActiveStep(activeStep === "Details" ? "Lineup" : "Review"); return; }
    function revealField(field: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | HTMLButtonElement) {
      const panel = field.closest<HTMLElement>("[data-editor-step]");
      if (panel) setActiveStep(panel.dataset.editorStep as EventEditorStep);
      for (let parent = field.parentElement; parent && parent !== form; parent = parent.parentElement) {
        if (parent instanceof HTMLDetailsElement) parent.open = true;
      }
      requestAnimationFrame(() => { field.focus(); field.reportValidity(); });
    }
    const invalid = form.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("input:invalid, select:invalid, textarea:invalid");
    if (invalid && (intent === "publish" || invalid.dataset.timePending === "true")) {
      if (invalid.dataset.timePending === "true") setStatus({ kind: "error", message: invalid.validationMessage });
      revealField(invalid);
      return;
    }
    if (endConflict) { setActiveStep("Lineup"); requestAnimationFrame(() => formRef.current?.querySelector<HTMLElement>('[data-lineup-conflict] button, [data-lineup-row] input')?.focus()); return; }

    if (event !== undefined && isPublished && intent === "draft" && !window.confirm("Unpublish and save draft")) {
      return;
    }

    setStatus({ kind: "submitting" });
    let timeErrorField: "start" | "end" = "start";
    try {
      const submittedTimezone = optionalString(stringField(formData.get("timezone")));
      if (!timeTba && !submittedTimezone) throw new Error("Time zone must be a valid IANA time zone.");
      const timeZoneForParsing = submittedTimezone ?? browserTimeZone();
      const authoredStart = startLocal;
      const startAt = timeTba ? undefined : startInstantOverride ?? resolveStaffStartAt(authoredStart, timeZoneForParsing, occurrence, event);
      const slotLinks = startAt === undefined ? [] : parseSlotRows(slotRows, startAt);
      const derivedEndAt = getLineupEndAt(slotLinks.map((slot, index) => ({ ...slot, key: slotRows[index]!.id })));
      timeErrorField = "end";
      const authoredEndAt = timeTba || !endEdited ? undefined : !endLocal ? null
        : endAtOverride !== undefined ? endAtOverride : event?.endAt !== undefined && endLocal === formatZonedDateTimeInput(event.endAt, event.timezone) && timezone === event.timezone && endOccurrence === storedTimeOccurrence(event.endAt, event.timezone)
          ? event.endAt
          : selectEventLocalTime(endLocal.slice(0, 10), { time: endLocal.slice(11, 16), ...(endOccurrence ? { occurrence: endOccurrence } : {}) }, timeZoneForParsing);
      if (startAt !== undefined && typeof authoredEndAt === "number" && authoredEndAt <= startAt) {
        throw new Error("Event end time must be after the start time.");
      }
      const endAt = startAt === undefined ? undefined : resolveAuthoredEventEndAt({
        startAt,
        authoredEndAt,
        derivedEndAt,
        previousStartAt: event?.startAt,
        previousEndAt: event?.endAt,
        scheduleChanged,
      });
      const doorsOffsetMinutes = !timeTba && doorsOpenMinutes.trim() !== ""
        ? parseInteger(doorsOpenMinutes, "Doors-open offset minutes")
        : undefined;
      if (doorsOffsetMinutes !== undefined && doorsOffsetMinutes < 0) {
        throw new Error("Doors-open offset minutes must be zero or greater.");
      }
      const doorsOpenAt = timeTba ? undefined : doorsAtOverride !== undefined ? doorsAtOverride ?? undefined
        : event?.doorsOpenAt !== undefined && event.startAt !== undefined && startAt !== undefined ? event.doorsOpenAt + startAt - event.startAt
          : doorsOffsetMinutes === undefined || startAt === undefined ? undefined : startAt - doorsOffsetMinutes * 60_000;
      const payload = {
        title: stringField(formData.get("title")),
        communitySlug,
        ...(worldEdited ? { worldSlug: location.worldSlug || undefined } : {}),
        venueLabel: location.venueLabel,
        startAt,
        ...(doorsOpenAt === undefined ? {} : { doorsOpenAt }),
        ...(endAt === undefined ? {} : { endAt }),
        timezone: submittedTimezone,
        summary: optionalString(stringField(formData.get("summary"))),
        notes: optionalString(stringField(formData.get("notes"))),
        sourceLabel: optionalString(stringField(formData.get("sourceLabel"))),
        sourceUrl: optionalString(stringField(formData.get("sourceUrl"))),
        posterImageUrl: optionalString(stringField(formData.get("posterImageUrl"))),
        bannerImageUrl: optionalString(stringField(formData.get("bannerImageUrl"))),
        thumbnailImageUrl: optionalString(stringField(formData.get("thumbnailImageUrl"))),
        watchSurfaceEnabled,
        watchMode,
        mediaLinks: parseMediaLinks(mediaLinksText),
        ...((!event || lineupEdited || startAt !== event.startAt) ? { lineup: [
          ...slotRows.map((row, index) => ({
            clientKey: row.id, position: row.position ?? index, performerLabel: row.displayLabel || performers.person(row.personSlug)?.title || `Session ${index + 1}`, personSlug: optionalString(row.personSlug), roleLabel: optionalString(row.roleLabel),
            ...(!timeTba ? { startAt: slotLinks[index]!.startAt, endAt: slotLinks[index]!.endAt, selectedStreamId: slotLinks[index]!.selectedStreamId } : {}),
          })),
          ...untimedRows.map(row => ({ ...row, personSlug: optionalString(row.personSlug), roleLabel: optionalString(row.roleLabel) })),
        ].sort((a, b) => a.position - b.position).map((row, position) => ({ ...row, position })) } : {}),
      };
      const submittedSlotKeys = slotRows.map(row => row.id);
      const submittedWorldRevision = worldEditRevision.current;
      const result = event
          ? await updateEvent({
            currentSlug: currentSlug!,
            preservedCommunityProfileId: event.preservedCommunityProfileId,
            ...associationSnapshot,
            ...(worldEdited ? { preservedWorldAssociationIds: associationSnapshot.preservedWorldAssociationIds.filter(id => id !== editableWorld?.associationId) } : {}),
            ...(intent === "publish"
              ? { published: true }
              : intent === "draft"
                ? { published: false }
                : {}),
            ...payload,
            ...(worldEdited ? { worldSlug: location.worldSlug || null } : {}),
            preserveLineupConfirmation: true,
            ...(payload.lineup && unrepresentedLineupAssociations ? { retainedLineupAssociations: {
              participantIds: unrepresentedLineupAssociations.participantIds.filter(id => associationSnapshot.preservedParticipantAssociationIds.includes(id)),
              slotIds: unrepresentedLineupAssociations.slotIds.filter(id => associationSnapshot.preservedSlotAssociationIds.includes(id)),
            } } : {}),
            doorsOpenAt: doorsOpenAt ?? null,
            endAt: endAt ?? null,
            summary: payload.summary ?? null,
            notes: payload.notes ?? null,
            sourceLabel: payload.sourceLabel ?? "",
            sourceUrl: payload.sourceUrl ?? null,
            posterImageUrl: payload.posterImageUrl ?? null,
            bannerImageUrl: payload.bannerImageUrl ?? null,
            thumbnailImageUrl: payload.thumbnailImageUrl ?? null,
            scheduleKind: timeTba ? "date_only" : "timed",
            ...(timeTba ? { eventDate } : {}),
            venueLabel: location.venueLabel,
          })
        : await createEvent({ ...payload, startAt: startAt!, published: intent === "publish" });

      if (event !== undefined && (intent === "publish" || intent === "draft")) {
        setIsPublished(intent === "publish");
      }
      if (event !== undefined) {
        setCurrentSlug(result.slug);
        if ("storedSlotAssociations" in result && result.storedSlotAssociations) {
          const storedIdsBySubmittedKey = new Map(result.storedSlotAssociations.map(item => [submittedSlotKeys[item.position], item.slotId]));
          setSlotRows(rows => rows.map(row => ({ ...row, id: storedIdsBySubmittedKey.get(row.id) ?? row.id })));
        }
        if ("preservedParticipantAssociationIds" in result) {
          if (worldEdited) setEditableWorld(result.editableWorldAssociation ?? undefined);
          if (worldEditRevision.current === submittedWorldRevision) setWorldEdited(false);
          setAssociationSnapshot({
            preservedParticipantAssociationIds: result.preservedParticipantAssociationIds,
            preservedSlotAssociationIds: result.preservedSlotAssociationIds,
            preservedWorldAssociationIds: result.preservedWorldAssociationIds,
          });
        }
      }

      if (intent === "publish") router.replace(result.eventPath ?? `/${communitySlug}/events/${result.slug}`);
      startTransition(() =>
        setStatus({
          kind: "success",
          result: {
            ...result,
            eventPath: intent === "publish"
              ? `/${communitySlug}/events/${result.slug}`
              : `/${communitySlug}/events/${result.slug}/edit`,
          },
        }),
      );
    } catch (error) {
      const message = eventEditorErrorMessage(error);
      const selector = message.startsWith("Slot offset minutes") ? '[data-slot-offset]'
        : message.startsWith("Slot duration minutes") ? '[data-slot-duration]'
        : message === "Time zone must be a valid IANA time zone." ? 'button[aria-label="Time zone"]'
        : message === "Local time does not exist in this timezone." ? `[name="${timeErrorField === "end" ? "endAt" : "startAt"}"]`
        : message === "Ambiguous local time requires an earlier or later occurrence." ? `[aria-label="${timeErrorField === "end" ? "End" : "Start"} occurrence"]`
        : message === "Event end time must be after the start time." ? '[name="endAt"]'
        : undefined;
      const field = selector ? form.querySelector<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>(selector) : null;
      if (field) revealField(field);
      if (isUnavailableStreamError(error)) setActiveStep("Lineup");
      startTransition(() => setStatus({
        kind: "error", message,
        // The backend identifies the selection category, not an individual row.
        streamSelections: isUnavailableStreamError(error)
          ? Object.fromEntries(slotRows.filter(row => row.selectedStreamId).map(row => [row.id, row.selectedStreamId!]))
          : undefined,
      }));
    }
  }

  async function onSetCancelled(cancelled: boolean) {
    if (event === undefined) {
      return;
    }
    if (cancelled && !window.confirm("Cancel event")) return;

    setStatus({ kind: "submitting" });
    try {
      const result = await setEventCancelled({
        currentSlug: currentSlug!,
        cancelled,
        ...(cancelled ? { reason: cancellationReason } : {}),
      });
      setEventStatus(result.eventStatus);
      startTransition(() =>
        setStatus({
          kind: "success",
          result: {
            eventPath: isPublished
              ? `/${communitySlug}/events/${currentSlug}`
              : `/${communitySlug}/events/${currentSlug}/edit`,
            slug: currentSlug!,
          },
        }),
      );
    } catch (error) {
      startTransition(() => setStatus({ kind: "error", message: eventEditorErrorMessage(error) }));
    }
  }

  const isSubmitting = status.kind === "submitting";
  let previewStart: number | undefined;
  try { if (!timeTba && startLocal && timezone) previewStart = startInstantOverride ?? resolveStaffStartAt(startLocal, timezone, occurrence, event); } catch { /* The preview waits for a valid local time. */ }
  let previewDerivedEndAt: number | undefined;
  try {
    if (!timeTba && previewStart !== undefined) {
      previewDerivedEndAt = getLineupEndAt(readStaffLineupTimings(slotRows, previewStart));
    }
  } catch { /* Incomplete slot rows do not provide a preview end. */ }
  const implicitEndAt = timeTba || previewStart === undefined ? undefined : resolveAuthoredEventEndAt({
    startAt: previewStart, derivedEndAt: previewDerivedEndAt,
    previousStartAt: event?.startAt, previousEndAt: event?.endAt, scheduleChanged,
  });
  const displayedEndLocal = !endEdited && previewStart !== undefined
    ? implicitEndAt === undefined ? "" : formatZonedDateTimeInput(implicitEndAt, timezone)
    : endLocal;
  const displayedEndOccurrence = !endEdited && previewStart !== undefined
    ? storedTimeOccurrence(implicitEndAt, timezone)
    : endOccurrence;
  let endChoices: number[] = [];
  try { if (displayedEndLocal && timezone) endChoices = resolveEventLocalTime(displayedEndLocal.slice(0, 10), { time: displayedEndLocal.slice(11, 16) }, timezone); } catch { /* The form remains editable while incomplete. */ }
  const previewEnteredEndAt = endChoices.length === 1 ? endChoices[0]
    : displayedEndOccurrence === "earlier" ? endChoices[0]
      : displayedEndOccurrence === "later" ? endChoices.at(-1) : undefined;
  const previewEndAt = timeTba ? undefined : !endEdited ? implicitEndAt
    : !endLocal && previewStart !== undefined ? previewDerivedEndAt
      : endAtOverride ?? previewEnteredEndAt;
  const displayedStart = previewStart === undefined ? startLocal : projectEditorTime({ instant: previewStart, timezone: editingTimezone }).value;
  const doorsAt = doorsAtOverride !== undefined ? doorsAtOverride : event?.doorsOpenAt !== undefined && event.startAt !== undefined && previewStart !== undefined ? event.doorsOpenAt + previewStart - event.startAt : undefined;
  const doorsLocal = doorsAt == null ? "" : formatZonedDateTimeInput(doorsAt, timezone);
  const doorsOccurrence = doorsAt == null ? "" : storedTimeOccurrence(doorsAt, timezone);
  const vrcdnOutputAccountOptions = vrcdnOutputAccounts ?? [];
  const vrcdnOutputAccountsLoading = vrcdnOutputAccounts === undefined;
  const canSaveVrcdnOutput =
    vrcdnOutputStatus.kind !== "submitting" && !vrcdnOutputAccountsLoading && vrcdnOutputAccountOptions.length > 0;
  const visibleWorkerSession = chooseVisibleWorkerSession(eventMediaControlStatus?.sessions ?? []);
  const visibleWorkerOutput = eventMediaControlStatus?.outputs.find((output) => output.outputId === visibleWorkerSession?.outputId);
  function onVrcdnOutputAccountChange(changeEvent: ChangeEvent<HTMLSelectElement>) {
    const value = eventTargetValue(changeEvent);
    const account = vrcdnOutputAccountOptions.find((option) => option.key === value);

    if (account === undefined) {
      setVrcdnOutput((current) => ({ ...current, outputAccount: value }));
      return;
    }

    setVrcdnOutput((current) => applyVrcdnOutputAccountDefaults(current, account));
  }

  const displayRows = [
    ...slotRows.map((row, index) => ({ kind: "timed" as const, row, position: row.position ?? index })),
    ...untimedRows.map(row => ({ kind: "untimed" as const, row, position: row.position })),
  ].sort((a, b) => a.position - b.position);
  const staffTimings = readStaffLineupTimings(slotRows, previewStart ?? NaN);
  const timings = displayRows.map(item => item.kind === "untimed" || timeTba ? { key: item.kind === "timed" ? item.row.id : item.row.clientKey } : staffTimings.find(timing => timing.key === item.row.id)!);
  const endConflict = getLineupEndConflict(previewEndAt, timings);
  function applyTimingEdit(result: LineupEditResult<LineupTimingRow>, newUntimedKey?: string) {
    if (!result.ok) { requestAnimationFrame(() => formRef.current?.querySelector<HTMLElement>('[data-lineup-row] input')?.focus()); return; }
    if (previewStart !== undefined) startAnchor.current = previewStart;
    const untimedKeys = new Set(untimedRows.map(row => row.clientKey));
    if (newUntimedKey) untimedKeys.add(newUntimedKey);
    const slots = result.rows.filter(row => !untimedKeys.has(row.key));
    // Time TBA leaves surviving stored clocks reversible in this open editor.
    const nextSlots = timeTba ? slots.flatMap(timing => { const row = slotRows.find(row => row.id === timing.key); return row ? [row] : []; }) : applyStaffLineupTimings(slotRows, slots, previewStart ?? NaN);
    updateSlotRows(() => nextSlots.map(row => ({ ...row, position: result.rows.findIndex(timing => timing.key === row.id) })));
    updateUntimedRows(rows => result.rows.flatMap((timing, position) => {
      if (!untimedKeys.has(timing.key)) return [];
      const original = rows.find(row => row.clientKey === timing.key);
      return [{ ...(original ?? { clientKey: timing.key, performerLabel: "", personSlug: "", roleLabel: "" }), position }];
    }));
    setScheduleChanged(true);
  }
  function addUntimed(index = displayRows.length) {
    if (slotRows.length + untimedRows.length >= 80) return;
    const key = crypto.randomUUID();
    applyTimingEdit({ ok: true, rows: [...timings.slice(0, index), { key }, ...timings.slice(index)] }, key);
    requestAnimationFrame(() => formRef.current?.querySelector<HTMLElement>(`[data-lineup-row="${key}"] input`)?.focus());
  }
  function changeStart(local: string, nextOccurrence: "earlier" | "later" | "", exactInstant?: number) {
    timezoneAuthored.current = true;
    try {
      const next = exactInstant ?? resolveStaffStartAt(local, timezone, nextOccurrence, event);
      if (startAnchor.current !== undefined) {
        const shifted = shiftLineupStart(readStaffLineupTimings(slotRows, startAnchor.current), next - startAnchor.current);
        setSlotRows(applyStaffLineupTimings(slotRows, shifted, next).map((row, index) => ({ ...row, position: slotRows[index]?.position })));
      }
      startAnchor.current = next;
      setScheduleChanged(true);
    } catch { /* Incomplete authored starts keep the last valid cascade anchor. */ }
    setStartInstantOverride(exactInstant);
    setStartLocal(local); setEventDate(local.slice(0, 10)); setOccurrence(nextOccurrence);
  }
  function changeTimezone(value: string | null) {
    const invalid = formRef.current?.querySelector<HTMLInputElement>('[data-time-pending="true"]');
    if (invalid) { setActiveStep(invalid.closest('[data-editor-step="Lineup"]') ? "Lineup" : "Details"); requestAnimationFrame(() => invalid.focus()); return false; }
    if (!value) return false;
    editingTimezoneAuthored.current = true;
    setEditingTimezone(value);
    if (!timezoneAuthored.current) setTimezone(value);
    return true;
  }
  function toggleTba(checked: boolean) {
    const invalid = formRef.current?.querySelector<HTMLInputElement>('[data-time-pending="true"]');
    if (checked && invalid) { invalid.focus(); return; }
    timezoneAuthored.current = true;
    if (checked) {
      timedDateBackup.current = eventDate;
      const localDate = previewStart === undefined ? eventDate : projectEditorTime({ instant: previewStart, timezone: editingTimezone }).value.slice(0, 10);
      tbaDisplayDate.current = localDate; setEventDate(localDate);
    } else if (tbaDisplayDate.current && eventDate !== tbaDisplayDate.current && startAnchor.current !== undefined) {
      const original = projectEditorTime({ instant: startAnchor.current, timezone: editingTimezone });
      const next = resolveEditorTime({ value: `${eventDate}T${original.value.slice(11)}`, timezone: editingTimezone, occurrence: original.occurrence });
      if (next.kind !== "resolved") return;
      const canonical = projectEditorTime({ instant: next.instant, timezone });
      changeStart(canonical.value, canonical.occurrence ?? "", next.instant + startAnchor.current % 60_000);
    } else if (timedDateBackup.current) setEventDate(timedDateBackup.current);
    setTimeTba(checked);
  }
  const insertion = (index: number) => <EventLineupInsert index={index} allowUntimed atLimit={slotRows.length + untimedRows.length >= 80} disabled={timeTba || (index === 0 ? previewStart : timings[index - 1]?.endAt) === undefined} onAddUntimed={addUntimed} onInsert={(index, durationMinutes) => {
    const key = crypto.randomUUID();
    applyTimingEdit(insertLineupSlot({ rows: timings, index, row: { key }, durationMinutes, eventStartAt: previewStart }));
    requestAnimationFrame(() => formRef.current?.querySelector<HTMLElement>(`[data-lineup-row="${key}"] input`)?.focus());
  }} />;
  const conflictNotice = endConflict && previewEndAt !== undefined ? <EventLineupConflict {...endConflict} eventEndAt={previewEndAt} timezone={editingTimezone} onExtend={endAt => { setEndAtOverride(endAt); setEndLocal(formatZonedDateTimeInput(endAt, timezone)); setEndOccurrence(storedTimeOccurrence(endAt, timezone)); setEndEdited(true); setEndOpen(true); }} /> : null;
  function renderUntimed(row: (typeof untimedRows)[number]) {
    return <Card data-lineup-row={row.clientKey} key={row.clientKey} className="grid gap-3" padding="sm" surface="dashed">
      <EventPerformerField value={performers.value({ key: row.clientKey, label: row.performerLabel, personSlug: row.personSlug })} selectedPerson={performers.person(row.personSlug)} onResolve={performers.resolve} onChange={value => {
        const next = performers.change({ key: row.clientKey, label: row.performerLabel, personSlug: row.personSlug }, value);
        updateUntimedRows(rows => rows.map(item => item.clientKey === row.clientKey ? { ...item, performerLabel: next.label, personSlug: next.personSlug } : item));
      }} />
      <Field>Role<Input value={row.roleLabel} onChange={change => updateUntimedRows(rows => rows.map(item => item.clientKey === row.clientKey ? { ...item, roleLabel: change.target.value } : item))} /></Field>
      {!timeTba ? <details><summary className="cursor-pointer text-sm font-medium">Details</summary><Field className="mt-3">Slot offset minutes<Input inputMode="numeric" disabled={previewStart === undefined} onKeyDown={change => { if (change.key === "Enter") { change.preventDefault(); change.currentTarget.blur(); } }} onBlur={change => {
        const value = change.currentTarget.value;
        if (previewStart === undefined || !value.trim() || !Number.isInteger(Number(value))) return;
        updateSlotRows(rows => [...rows, { id: row.clientKey, position: row.position, personSlug: row.personSlug, displayLabel: row.performerLabel, roleLabel: row.roleLabel, offsetMinutes: value, durationMinutes: "", startAtOverride: previewStart + Number(value) * 60_000 }]);
        updateUntimedRows(rows => rows.filter(item => item.clientKey !== row.clientKey));
      }} /></Field></details> : null}
      <Button type="button" variant="secondary" onClick={() => applyTimingEdit(removeLineupSlot(timings, row.clientKey))}>Remove performer</Button>
    </Card>;
  }
  function previewTime(timestamp: number) {
    const local = formatZonedDateTimeInput(timestamp, timezone);
    const instantOccurrence = storedTimeOccurrence(timestamp, timezone);
    return { time: local.slice(11, 16), dayOffset: Math.round((Date.parse(`${local.slice(0, 10)}T00:00:00Z`) - Date.parse(`${eventDate}T00:00:00Z`)) / 86_400_000), ...(instantOccurrence ? { occurrence: instantOccurrence } : {}) };
  }
  const previewFields = {
    ...preview, worldSlug: location.worldSlug, venueLabel: location.venueLabel, communitySlug, eventDate, timezone, timeTba,
    start: previewStart === undefined ? null : previewTime(previewStart),
    end: previewEndAt === undefined ? null : previewTime(previewEndAt),
    lineup: [
      ...displayRows.map((item, index) => {
        const startAt = timings[index]?.startAt;
        return item.kind === "untimed"
          ? { clientKey: item.row.clientKey, performerLabel: item.row.performerLabel || performers.person(item.row.personSlug)?.title || "" }
          : { clientKey: item.row.id, performerLabel: item.row.displayLabel || performers.person(item.row.personSlug)?.title || "", ...(previewStart === undefined || startAt === undefined ? {} : { start: previewTime(startAt) }) };
      }),
    ].filter(row => row.performerLabel).map((row, position) => ({ ...row, position })),
  };

  return (
    <form ref={formRef} className="grid gap-8" noValidate onSubmit={onSubmit} onChange={change => {
      const data = new FormData(change.currentTarget);
      setPreview({ title: stringField(data.get("title")), summary: stringField(data.get("summary")), venueLabel: stringField(data.get("venueLabel")), artwork: stringField(data.get("posterImageUrl")) });
    }}>
      <EventEditorSteps heading={heading} steps={["Details", "Lineup", "Review"]} activeStep={activeStep} onSelect={setActiveStep} preview={<EventEditorPreview editingTimezone={editingTimezone} fields={previewFields} artwork={preview.artwork || undefined} community={community} world={world} />}>
      <div hidden={activeStep !== "Details"} data-editor-step="Details" className="space-y-8">
      <EditorSection title="Details">
        <Field>
          Event title
          <Input
            defaultValue={event?.title ?? (demoMode ? "Afterglow Harbor Sessions" : "")}
            name="title"
            placeholder="Afterglow Harbor Sessions"
            required
          />
        </Field>

        <Field>
          Description
          <Textarea aria-label="Description" className="min-h-24" defaultValue={event?.summary} name="summary" />
        </Field>
        <EventCommunitySummary community={community} />
        <EventLocationField {...location} selectedWorld={world} onWorldPresentation={setSelectedWorld} onChange={next => { if (next.worldSlug !== location.worldSlug) { worldEditRevision.current += 1; setWorldEdited(true); } setLocation(next); }} />

        <details className="group rounded-control border border-border bg-surface px-4 py-3">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium marker:hidden">
            Private notes
            <span aria-hidden="true" className="text-muted transition group-open:rotate-45">+</span>
          </summary>
          <Textarea aria-label="Private notes" className="mt-4 min-h-24" defaultValue={event?.notes} name="notes" />
        </details>
      </EditorSection>

      <input type="hidden" name="timezone" value={timezone} />
      <EditorSection title="Timing">
        {event ? <label className="flex items-center gap-3 text-sm font-medium"><input checked={timeTba} onChange={change => toggleTba(change.target.checked)} type="checkbox" />Time TBA</label> : null}
        <div className="grid gap-4">
        {timeTba ? <Field>Date<Input type="date" required value={eventDate} onChange={change => { timezoneAuthored.current = true; setEventDate(change.target.value); }} /></Field> : <>
        <div className="grid items-start gap-4 sm:grid-cols-2">
          <div className="grid gap-2"><IntakeTime label="Starts" name="startAt" occurrenceLabel="Start occurrence" required eventStart date={startLocal.slice(0, 10) || eventDate} value={startLocal ? { time: startLocal.slice(11), ...(occurrence ? { occurrence } : {}) } : null} timezone={timezone} displayTimezone={editingTimezone} onChange={change => changeStart(change.local ? `${change.eventDate}T${change.local.time}` : "", change.local?.occurrence ?? "")} /><EventTimezonePicker name="editingTimezone" value={editingTimezone} date={eventDate || null} instant={previewStart} preferredValue={savedTimezonePreference} onChange={changeTimezone} /></div>
          <details className="relative min-w-0" open={endOpen} onToggle={change => setEndOpen(change.currentTarget.open)}>
            <summary className={`cursor-pointer font-medium ${endOpen ? "absolute right-0 top-0 text-xs" : "text-sm"}`}>Add end time</summary>
            <div className="grid gap-2">
              <IntakeTime label="Ends (optional)" name="endAt" occurrenceLabel="End occurrence" eventStart date={displayedEndLocal.slice(0, 10) || eventDate} value={displayedEndLocal ? { time: displayedEndLocal.slice(11), ...(displayedEndOccurrence ? { occurrence: displayedEndOccurrence } : {}) } : null} timezone={timezone} displayTimezone={editingTimezone} onChange={change => { timezoneAuthored.current = true; setEndAtOverride(undefined); setEndLocal(change.local ? `${change.eventDate}T${change.local.time}` : ""); setEndOccurrence(change.local?.occurrence ?? ""); setEndEdited(true); }} />
            </div>
          </details>
        </div>
        <details className="relative" open={doorsOpen} onToggle={change => setDoorsOpen(change.currentTarget.open)}>
          <summary className={`cursor-pointer font-medium ${doorsOpen ? "absolute right-0 top-0 text-xs" : "text-sm"}`}>Add doors-open time</summary>
          <IntakeTime label="Doors open" eventStart date={doorsLocal.slice(0, 10) || eventDate} value={doorsLocal ? { time: doorsLocal.slice(11), ...(doorsOccurrence ? { occurrence: doorsOccurrence } : {}) } : null} timezone={timezone} displayTimezone={editingTimezone} onChange={change => { timezoneAuthored.current = true; setDoorsAtOverride(change.local && change.eventDate ? selectEventLocalTime(change.eventDate, change.local, timezone) : null); setDoorsOpenMinutes(""); }} />
        </details>
        </>}
        </div>
      </EditorSection>

      <EditorDisclosure title="Source">
        <div className="grid gap-4 sm:grid-cols-3">
        <Field className="sm:col-span-1">
          Source label
          <Input defaultValue={event?.source.label} name="sourceLabel" placeholder="Community event listing" />
        </Field>
        <Field className="sm:col-span-1">
          Original event post
          <Input defaultValue={event?.source.url} name="sourceUrl" placeholder="https://..." />
        </Field>
        <Field className="sm:col-span-1">
          Poster image URL
          <Input defaultValue={event?.posterImageUrl} name="posterImageUrl" placeholder="https://..." />
        </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
        <Field>
          Banner image URL
          <Input defaultValue={event?.authoredBannerImageUrl} name="bannerImageUrl" placeholder="https://..." />
          <FieldText>Wide event-page hero image. Falls back to the poster image.</FieldText>
        </Field>
        <Field>
          Thumbnail image URL
          <Input defaultValue={event?.authoredThumbnailImageUrl} name="thumbnailImageUrl" placeholder="https://..." />
          <FieldText>Compact event-card image. Falls back to the poster or banner image.</FieldText>
        </Field>
        </div>

      <Field>
        Media links
        <Textarea className="min-h-28" name="mediaLinks" onChange={(changeEvent) => setMediaLinksText(changeEvent.currentTarget.value)} placeholder="watch | Twitch watch link | https://... | open&#10;vrcdn | VRCDN Quest link | https://stream.vrcdn.live/live/name.live.ts | copy&#10;vrcdn | VRCDN PC link | rtspt://stream.vrcdn.live/live/name | copy" value={mediaLinksText} />
        <FieldText>One per line: type | label | URL | open or copy. VRCDN variants derive Quest and PC player links automatically.</FieldText>
      </Field>
      <VrcdnMediaLinkAssistant mediaLinksText={mediaLinksText} />
      </EditorDisclosure>
      </div>
      <div hidden={activeStep !== "Lineup"} data-editor-step="Lineup">
      <EditorSection title="Lineup">

        {slotRows.length + untimedRows.length === 0 ? <EventLineupSetup disabled={previewStart === undefined || timeTba} onAddPerformer={() => addUntimed()} onGenerate={(count, durationMinutes) => applyTimingEdit(generateLineupTimings({ startAt: previewStart ?? NaN, count, durationMinutes, keys: Array.from({ length: count }, () => crypto.randomUUID()) }))} /> : null}
        <div className="grid gap-3">
          {slotRows.length + untimedRows.length > 0 ? insertion(0) : null}
          {displayRows.map((item, index) => {
            if (item.kind === "untimed") return <Fragment key={item.row.clientKey}>{renderUntimed(item.row)}{insertion(index + 1)}</Fragment>;
            const slot = item.row;
            const timing = timings[index];
            const previousEnd = timings[index - 1]?.endAt;
            const gap = timing.startAt !== undefined && previousEnd !== undefined ? (timing.startAt - previousEnd) / 60_000 : 0;
            const duration = timing.startAt !== undefined && timing.endAt !== undefined && timing.endAt > timing.startAt ? (timing.endAt - timing.startAt) / 60_000 : undefined;
            return <Fragment key={slot.id}>{gap !== 0 ? <p className={gap < 0 ? "text-sm text-danger" : "text-sm text-muted"}>{gap < 0 ? "Overlap" : "Break"}: {Math.abs(gap)} min</p> : null}<Card data-lineup-row={slot.id} className="grid gap-3" padding="sm" surface="dashed">
              <div className={duration !== undefined && !Number.isInteger(duration) ? "grid gap-3" : "grid gap-3 sm:grid-cols-[minmax(0,1fr)_7rem] sm:items-end"}>
                <div className={duration !== undefined && !Number.isInteger(duration) ? undefined : "sm:col-span-2"}>
                  <h4 className="font-semibold">{slot.displayLabel || `Slot ${index + 1}`}</h4>
                  <span className="text-xs text-muted">{timeTba ? "Time TBA" : formatLineupTimeRange({ ...timing, timezone: editingTimezone, eventDate: displayedStart.slice(0, 10) })}</span>
                </div>
                <EventPerformerField value={performers.value({ key: slot.id, label: slot.displayLabel, personSlug: slot.personSlug })} selectedPerson={performers.person(slot.personSlug)} onResolve={performers.resolve} onChange={value => {
                  const next = performers.change({ key: slot.id, label: slot.displayLabel, personSlug: slot.personSlug }, value);
                  updateSlotRows(rows => rows.map(row => row.id === slot.id ? { ...row, displayLabel: next.label, personSlug: next.personSlug } : row));
                }} />
                {!timeTba ? <EventSlotDuration value={duration} onCommit={minutes => applyTimingEdit(changeLineupDuration(timings, slot.id, minutes))} /> : null}
              </div>
              {watchSurfaceEnabled && watchMode === "performer_sequence" && (slot.personSlug.trim() || slot.selectedStreamId) ? <SlotStreamSelect
                row={slot}
                invalid={status.kind === "error" && Boolean(slot.selectedStreamId) && status.streamSelections?.[slot.id] === slot.selectedStreamId}
                onChange={value => updateSlotRows(rows => rows.map(row => row.id === slot.id ? { ...row, selectedStreamId: value || undefined } : row))}
              /> : null}
              <details className="group border-t border-border pt-3">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-sm font-medium marker:hidden">
                  Details
                  <span aria-hidden="true" className="text-muted transition group-open:rotate-45">+</span>
                </summary>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  {!timeTba ? <><Field>Slot offset minutes<Input data-slot-offset inputMode="numeric" value={slot.offsetMinutes} onChange={change => updateSlotRows(rows => rows.map(row => row.id === slot.id ? changeStaffSlotOffset(row, change.target.value, previewStart ?? NaN) : row))} /></Field><EventSlotDuration detailed value={duration} unresolvedValue={slot.durationMinutes} onClear={() => updateSlotRows(rows => rows.map(row => row.id === slot.id ? { ...row, durationMinutes: "", endAtOverride: undefined, durationMsOverride: undefined } : row))} onCommit={minutes => duration === undefined ? updateSlotRows(rows => rows.map(row => row.id === slot.id ? { ...row, durationMinutes: String(minutes), endAtOverride: undefined, durationMsOverride: undefined } : row)) : applyTimingEdit(changeLineupDuration(timings, slot.id, minutes))} /></> : null}
                  <Field className="text-xs text-muted">
                    Role or style
                    <Input
                      onChange={(changeEvent) => {
                        const value = eventTargetValue(changeEvent);
                        updateSlotRows((rows) => rows.map((row) => row.id === slot.id ? { ...row, roleLabel: value } : row));
                      }}
                      value={slot.roleLabel}
                    />
                  </Field>
                </div>
              </details>
              <Button type="button" variant="ghost" className="justify-self-start" onClick={() => applyTimingEdit(removeLineupSlot(timings, slot.id))}>Remove slot</Button>
            </Card>{insertion(index + 1)}</Fragment>;
          })}
        </div>
        {slotRows.length + untimedRows.length > 0 ? <div className="flex flex-wrap gap-3"><EventLineupReset onConfirm={() => { updateSlotRows(() => []); updateUntimedRows(() => []); }} /></div> : null}
        {conflictNotice}
      </EditorSection>

      </div>
      <div hidden={activeStep !== "Review"} data-editor-step="Review" className="space-y-8">
        <EditorSection title="Review">
        {activeStep === "Review" ? <Button disabled={isSubmitting} name="intent" size="lg" type="submit" value="publish" variant="primary" className="justify-self-start">
          {isSubmitting
            ? "Saving..."
            : isPublished
              ? "Save changes"
              : event
                ? "Save and publish"
                : "Publish event"}
        </Button> : null}
          {conflictNotice}
          <h3 className="break-words text-2xl font-semibold">{preview.title}</h3>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div><dt className="text-muted">{timeTba ? "Date" : "Starts"}</dt><dd>{timeTba ? eventDate : displayedStart.replace("T", " ")}</dd></div>
            {!timeTba ? <div><dt className="text-muted">Time zone</dt><dd>{eventTimezoneLabel(editingTimezone, previewStart)}</dd></div> : null}
            <div><dt className="text-muted">Community</dt><dd><EventCommunitySummary community={community} /></dd></div>
            {location.venueLabel || world?.title ? <div><dt className="text-muted">Where</dt><dd>{location.venueLabel || world?.title}</dd></div> : null}
          </dl>
          <div className="flex flex-wrap gap-3">
            {(["Details", "Lineup"] as const).map(step => <Button key={step} type="button" variant="secondary" onClick={() => setActiveStep(step)}>Edit {step.toLowerCase()}</Button>)}
          </div>
        </EditorSection>
        <EditorDisclosure title="Advanced">
      <label className="flex gap-3 rounded-control border border-border bg-surface-strong p-4 text-sm leading-6">
        <input
          className="mt-1 h-4 w-4 flex-none accent-accent"
          checked={watchSurfaceEnabled}
          onChange={event => setWatchSurfaceEnabled(event.currentTarget.checked)}
          name="watchSurfaceEnabled"
          type="checkbox"
        />
        <span>
          <span className="block font-medium text-foreground">Promote a watch surface during the event window</span>
          <span className="mt-1 block text-xs leading-5 text-muted">
            Keep this off unless stream capacity is ready for public viewers.
          </span>
        </span>
      </label>
      {watchSurfaceEnabled ? <Field>
        Watch mode
        <Select aria-label="Watch mode" onChange={event => setWatchMode(event.currentTarget.value as "event_stream" | "performer_sequence")} value={watchMode}>
          <option value="event_stream">Event stream</option>
          <option value="performer_sequence">Performer sequence</option>
        </Select>
      </Field> : null}

      {event === undefined || watchMode !== "event_stream" ? null : (
        <Card className="grid gap-4" padding="sm" surface="strong">
          <div>
            <h3 className="text-xl font-semibold tracking-[-0.03em]">VRCDN output</h3>
            <p className="mt-2 text-xs leading-5 text-muted">Managed output links can be promoted when the event watch surface is enabled.</p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              Output account
              <Select
                disabled={vrcdnOutputAccountsLoading || vrcdnOutputAccountOptions.length === 0}
                onChange={onVrcdnOutputAccountChange}
                value={vrcdnOutput.outputAccount}
              >
                {vrcdnOutputAccountsLoading ? <option value="">Loading accounts...</option> : null}
                {!vrcdnOutputAccountsLoading && vrcdnOutputAccountOptions.length === 0 ? <option value="">No accounts configured</option> : null}
                {vrcdnOutputAccountOptions.map((account) => (
                  <option key={account.key} value={account.key}>
                    {account.label}
                  </option>
                ))}
              </Select>
              <FieldText>Use the output account assigned for this event.</FieldText>
            </Field>
            <Field>
              Output label
              <Input
                onChange={(changeEvent) => {
                  const value = eventTargetValue(changeEvent);
                  setVrcdnOutput((current) => ({ ...current, label: value }));
                }}
                placeholder="Event stream"
                value={vrcdnOutput.label}
              />
            </Field>
          </div>

          <Field>
            Watch preview URL
            <Input
              onChange={(changeEvent) => {
                const value = eventTargetValue(changeEvent);
                setVrcdnOutput((current) => ({ ...current, browserUrl: value }));
              }}
              placeholder="https://panel.vrcdn.live/preview/name"
              value={vrcdnOutput.browserUrl}
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              Quest stream URL
              <Input
                onChange={(changeEvent) => {
                  const value = eventTargetValue(changeEvent);
                  setVrcdnOutput((current) => ({ ...current, standaloneUrl: value }));
                }}
                placeholder="https://stream.vrcdn.live/live/name.live.ts"
                value={vrcdnOutput.standaloneUrl}
              />
            </Field>
            <Field>
              PC stream URL
              <Input
                onChange={(changeEvent) => {
                  const value = eventTargetValue(changeEvent);
                  setVrcdnOutput((current) => ({ ...current, pcUrl: value }));
                }}
                placeholder="rtspt://stream.vrcdn.live/live/name"
                value={vrcdnOutput.pcUrl}
              />
            </Field>
          </div>

          <label className="flex gap-3 rounded-control border border-border bg-surface-strong p-4 text-sm leading-6">
            <input
              checked={vrcdnOutput.authorized}
              className="mt-1 h-4 w-4 flex-none accent-accent"
              onChange={(changeEvent) => {
                const checked = eventTargetChecked(changeEvent);
                setVrcdnOutput((current) => ({ ...current, authorized: checked }));
              }}
              type="checkbox"
            />
            <span>I confirm I am authorized to publish this event through the selected output account.</span>
          </label>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <Button disabled={!canSaveVrcdnOutput} onClick={onSaveVrcdnOutput} type="button" variant="secondary">
              {vrcdnOutputStatus.kind === "submitting" ? "Saving output..." : "Save output account"}
            </Button>
            {vrcdnOutputStatus.kind === "success" ? (
              <span className="text-sm text-muted">Output saved.</span>
            ) : null}
          </div>

          {vrcdnOutputStatus.kind === "error" ? <Notice variant="error">{vrcdnOutputStatus.message}</Notice> : null}
        </Card>
      )}

      {event === undefined || watchMode !== "event_stream" ? null : (
        // Private — worker runtime, task id, status reasons, artifact labels and
        // URLs, and the output-account key — as is the VRCDN output card above
        // it. Both are covered by `app/events/layout.tsx` rather than marked
        // here: marking one card at a time is exactly how the card above kept
        // leaking after this one was fixed.
        <Card className="grid gap-4" padding="sm" surface="dashed">
          <div>
            <h3 className="text-xl font-semibold tracking-[-0.03em]">Worker status</h3>
            <p className="mt-2 text-xs leading-5 text-muted">Private event-media status for the selected output account.</p>
          </div>

          {eventMediaControlStatus === undefined ? (
            <p className="text-sm text-muted">Loading worker status...</p>
          ) : eventMediaControlStatus.program === null ? (
            <p className="text-sm text-muted">No worker has been scheduled for this event.</p>
          ) : (
            <>
              <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-control border border-border bg-surface-strong p-3">
                  <dt className="text-xs text-muted">State</dt>
                  <dd className="mt-1 text-sm font-medium capitalize text-foreground">{formatMachineValue(eventMediaControlStatus.program.state)}</dd>
                </div>
                <div className="rounded-control border border-border bg-surface-strong p-3">
                  <dt className="text-xs text-muted">Output</dt>
                  <dd className="mt-1 text-sm font-medium text-foreground">{visibleWorkerOutput?.label ?? "Not selected"}</dd>
                </div>
                <div className="rounded-control border border-border bg-surface-strong p-3">
                  <dt className="text-xs text-muted">Session</dt>
                  <dd className="mt-1 text-sm font-medium capitalize text-foreground">{formatMachineValue(visibleWorkerSession?.status)}</dd>
                </div>
                <div className="rounded-control border border-border bg-surface-strong p-3">
                  <dt className="text-xs text-muted">Task</dt>
                  <dd className="mt-1 text-sm font-medium capitalize text-foreground">{formatMachineValue(visibleWorkerSession?.workerTaskStatus)}</dd>
                </div>
              </dl>

              {visibleWorkerSession === undefined ? (
                <p className="text-sm text-muted">No worker session has reported status yet.</p>
              ) : (
                <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <div className="rounded-control border border-border bg-surface-strong p-3">
                    <dt className="text-xs text-muted">Scheduled start</dt>
                    <dd className="mt-1 text-sm text-foreground">{formatPrivateTimestamp(visibleWorkerSession.scheduledStartAt)}</dd>
                  </div>
                  <div className="rounded-control border border-border bg-surface-strong p-3">
                    <dt className="text-xs text-muted">Ready deadline</dt>
                    <dd className="mt-1 text-sm text-foreground">{formatPrivateTimestamp(visibleWorkerSession.readyDeadlineAt)}</dd>
                  </div>
                  <div className="rounded-control border border-border bg-surface-strong p-3">
                    <dt className="text-xs text-muted">Last update</dt>
                    <dd className="mt-1 text-sm text-foreground">{formatPrivateTimestamp(visibleWorkerSession.updatedAt)}</dd>
                  </div>
                  <div className="rounded-control border border-border bg-surface-strong p-3">
                    <dt className="text-xs text-muted">Worker runtime</dt>
                    <dd className="mt-1 text-sm text-foreground">{formatMachineValue(visibleWorkerSession.workerRuntime)}</dd>
                  </div>
                  <div className="rounded-control border border-border bg-surface-strong p-3">
                    <dt className="text-xs text-muted">Task ID</dt>
                    <dd className="mt-1 break-all font-mono text-xs text-foreground">{shortTaskId(visibleWorkerSession.workerTaskId)}</dd>
                  </div>
                  <div className="rounded-control border border-border bg-surface-strong p-3">
                    <dt className="text-xs text-muted">Queued commands</dt>
                    <dd className="mt-1 text-sm text-foreground">{eventMediaControlStatus.queuedCommandCount}</dd>
                  </div>
                </dl>
              )}

              {visibleWorkerSession?.workerTaskStatusReason ? (
                <Notice>{visibleWorkerSession.workerTaskStatusReason}</Notice>
              ) : null}

              {visibleWorkerSession?.artifactLinks.length ? (
                <div className="grid gap-2">
                  <h4 className="text-sm font-semibold text-foreground">Artifacts</h4>
                  <div className="grid gap-2">
                    {visibleWorkerSession.artifactLinks.map((artifact) => (
                      artifact.url.startsWith("https://") ? (
                        <a
                          className="rounded-control border border-border bg-surface-strong px-3 py-2 text-sm font-medium text-foreground underline-offset-4 hover:underline"
                          href={artifact.url}
                          key={`${artifact.type}:${artifact.url}`}
                          rel="noreferrer"
                          target="_blank"
                        >
                          {artifact.label}
                        </a>
                      ) : (
                        <code className="break-all rounded-control border border-border bg-surface-strong px-3 py-2 text-xs text-foreground" key={`${artifact.type}:${artifact.url}`}>
                          {artifact.label}: {artifact.url}
                        </code>
                      )
                    ))}
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted">No artifacts recorded.</p>
              )}
            </>
          )}
        </Card>
      )}


      {event === undefined ? null : (
        <EditorDisclosure title="Operations">
          <Card className="grid gap-3" padding="sm" surface="dashed">
            <Field>
              Cancellation reason
              <Input
                onChange={(changeEvent) => setCancellationReason(changeEvent.currentTarget.value)}
                value={cancellationReason}
              />
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={isSubmitting || eventStatus === "cancelled"}
                onClick={() => void onSetCancelled(true)}
                type="button"
                variant="secondary"
              >
                Cancel event
              </Button>
              <Button
                disabled={isSubmitting || eventStatus !== "cancelled"}
                onClick={() => void onSetCancelled(false)}
                type="button"
                variant="secondary"
              >
                Restore event
              </Button>
            </div>
          </Card>

          <Card className="grid gap-3" padding="sm" surface="dashed">
            <h3 className="text-lg font-semibold">Change history</h3>
            {eventAudit === undefined ? (
              <p className="text-sm text-muted">Loading history…</p>
            ) : eventAudit.length === 0 ? (
              <p className="text-sm text-muted">No history</p>
            ) : (
              <ol className="grid gap-3">
                {eventAudit.map((row, index) => (
                  <li className="border-t border-border pt-3 first:border-t-0 first:pt-0" key={`${row.createdAt}:${row.action}:${index}`}>
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="font-medium capitalize">{formatMachineValue(row.action)}</span>
                      <ViewerLocalEventDateTime className="text-xs text-muted" timestamp={row.createdAt} />
                    </div>
                    <p className="mt-1 text-xs text-muted">
                      {row.actorDisplayName ?? formatMachineValue(row.actorSurface)}
                      {row.changedFields.length > 0 ? ` · ${row.changedFields.join(", ")}` : ""}
                    </p>
                    {row.reason ? <p className="mt-1 text-sm">{row.reason}</p> : null}
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </EditorDisclosure>
      )}

        </EditorDisclosure>
      </div>
      </EventEditorSteps>
      <div className="flex flex-wrap items-center gap-3">
        {activeStep !== "Details" ? <Button type="button" size="lg" variant="secondary" onClick={() => setActiveStep(activeStep === "Review" ? "Lineup" : "Details")}>Back</Button> : null}
        <span className="mr-auto text-sm text-muted">{["Details", "Lineup", "Review"].indexOf(activeStep) + 1} / 3</span>
        {activeStep !== "Review" ? <Button type="submit" name="intent" value="continue" size="lg">Continue</Button> : null}
        <Button disabled={isSubmitting} name="intent" size="lg" type="submit" value="draft" variant="secondary">
          {isPublished ? "Unpublish and save draft" : "Save draft"}
        </Button>
        {status.kind === "success" ? (
          <Link className={buttonVariants({ size: "lg", variant: "secondary" })} href={status.result.eventPath}>
            View {status.result.eventPath}
          </Link>
        ) : null}
      </div>

      {status.kind === "error" ? (
        <Notice variant="error">
          {status.message}
        </Notice>
      ) : null}
    </form>
  );
}

export function EventEditorForm({
  communitySlug,
  communityName,
  demoMode = false,
  event,
  heading,
  savedTimezonePreference,
}: {
  communitySlug: string;
  communityName?: string;
  demoMode?: boolean;
  event?: EditableEvent;
  heading?: ReactNode;
  savedTimezonePreference?: string | null;
}) {
  if (demoMode) {
    return <ConnectedEventEditorForm communitySlug={communitySlug} communityName={communityName} demoMode event={event} heading={heading} savedTimezonePreference={savedTimezonePreference} />;
  }

  if (!convexUrl) {
    return <>{heading}<DisabledEventEditorPanel /></>;
  }

  return <AuthenticatedEventEditorForm communitySlug={communitySlug} communityName={communityName} event={event} heading={heading} />;
}

function AuthenticatedEventEditorForm({ communitySlug, communityName, event, heading }: { communitySlug: string; communityName?: string; event?: EditableEvent; heading?: ReactNode }) {
  const { isAuthenticated, isLoading } = useConvexAuth();

  if (isLoading) {
    return <>{heading}<p className="text-sm text-muted">Loading sign-in state...</p></>;
  }

  if (!isAuthenticated) {
    return <>{heading}<SignInRequiredEventEditorPanel /></>;
  }

  return <AuthenticatedConnectedEventEditorForm communitySlug={communitySlug} communityName={communityName} event={event} heading={heading} />;
}

function AuthenticatedConnectedEventEditorForm(props: { communitySlug: string; communityName?: string; event?: EditableEvent; heading?: ReactNode }) {
  const viewer = useQuery(api.accounts.viewer);
  return <ConnectedEventEditorForm {...props} savedTimezonePreference={viewer?.user.defaultEventTimezone} />;
}
