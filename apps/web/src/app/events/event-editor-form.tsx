"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState, useTransition } from "react";
import { useMutation } from "convex/react";
import { api } from "@convex-generated-api";
import type { PublicEvent } from "../_components/event-public-page";
import { buttonVariants, Button } from "@/components/ui/button";
import { Card, Eyebrow, SectionTitle } from "@/components/ui/card";
import { Field, FieldText, Input, Textarea } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";

type EventMediaLinkType = PublicEvent["mediaLinks"][number]["type"];

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
const eventEditorAuthReady =
  process.env.NEXT_PUBLIC_VRDEX_EVENT_EDITOR_AUTH_READY === "true" ||
  process.env.NEXT_PUBLIC_VRDEX_SUBMISSIONS_AUTH_READY === "true";

type EventEditorStatus =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "success"; result: { eventPath: string; slug: string } }
  | { kind: "error"; message: string };

const userSafeErrorPatterns = [
  /Event changes require a signed-in user\./,
  /Event start time must be a valid timestamp\./,
  /Doors-open time must be a valid timestamp\./,
  /Event end time must be a valid timestamp\./,
  /(?:Event start|Event end|Doors-open) time must be a valid local time in .+\./,
  /Event title must be at least \d+ characters\./,
  /Event title must be \d+ characters or fewer\./,
  /Doors-open time must be at or before the event start time\./,
  /Event end time must be after the start time\./,
  /Time zone must be a valid IANA time zone\./,
  /Time zone is required when event slots are provided\./,
  /(?:Event source URL|Poster image URL|Media link URL|Participant source URL|Slot source URL) must (?:use https|be a valid URL)\./,
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
];

function eventEditorErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);

  for (const pattern of userSafeErrorPatterns) {
    const match = message.match(pattern);

    if (match) {
      return match[0];
    }
  }

  return "Event save failed. Please try again once the backend is reachable.";
}

function stringField(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value : "";
}

function optionalString(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

type DateTimeLocalParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
};

function padDatePart(value: number): string {
  return String(value).padStart(2, "0");
}

function parseDateTimeLocalParts(value: string, fieldName: string): DateTimeLocalParts {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);

  if (match === null) {
    throw new Error(`${fieldName} must be a valid timestamp.`);
  }

  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
  };
}

function formatDateTimeLocalParts(parts: DateTimeLocalParts): string {
  return `${parts.year}-${padDatePart(parts.month)}-${padDatePart(parts.day)}T${padDatePart(parts.hour)}:${padDatePart(parts.minute)}`;
}

function getZonedDateTimeParts(timestamp: number, timeZone: string): DateTimeLocalParts {
  let parts: Intl.DateTimeFormatPart[];

  try {
    parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(timestamp));
  } catch {
    throw new Error("Time zone must be a valid IANA time zone.");
  }

  const valueByType = new Map(parts.map((part) => [part.type, part.value]));

  return {
    year: Number(valueByType.get("year")),
    month: Number(valueByType.get("month")),
    day: Number(valueByType.get("day")),
    hour: Number(valueByType.get("hour")),
    minute: Number(valueByType.get("minute")),
  };
}

function toZonedInputValue(timestamp: number | undefined, timeZone: string | undefined): string {
  if (timestamp === undefined) {
    return "";
  }

  return formatDateTimeLocalParts(getZonedDateTimeParts(timestamp, timeZone ?? getBrowserTimezone()));
}

function dateTimePartsToUtc(parts: DateTimeLocalParts): number {
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
}

function fromZonedInputValue(value: string, timeZone: string, fieldName: string): number {
  const parts = parseDateTimeLocalParts(value, fieldName);
  const wallTimeUtc = dateTimePartsToUtc(parts);
  let timestamp = wallTimeUtc;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const zonedParts = getZonedDateTimeParts(timestamp, timeZone);
    const zonedWallTimeUtc = dateTimePartsToUtc(zonedParts);
    const nextTimestamp = timestamp + wallTimeUtc - zonedWallTimeUtc;

    if (nextTimestamp === timestamp) {
      break;
    }

    timestamp = nextTimestamp;
  }

  if (!Number.isFinite(timestamp)) {
    throw new Error(`${fieldName} must be a valid timestamp.`);
  }

  if (formatDateTimeLocalParts(getZonedDateTimeParts(timestamp, timeZone)) !== formatDateTimeLocalParts(parts)) {
    throw new Error(`${fieldName} must be a valid local time in ${timeZone}.`);
  }

  return timestamp;
}

function getBrowserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return "UTC";
  }
}

function parseInteger(value: string, fieldName: string): number {
  const parsed = Number(value.trim());

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

function parseParticipantLinks(value: string) {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [personSlug = "", roleLabel = "Performer"] = line.split("|").map((part) => part.trim());

      return { personSlug, roleLabel };
    });
}

function parseSlotLinks(value: string, eventStartAt: number) {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const [offsetInput = "", durationInput = "", personSlugInput = "", displayLabelInput = "", roleLabelInput = "Performer"] = line
        .split("|")
        .map((part) => part.trim());
      const offsetMinutes = parseInteger(offsetInput, "Slot offset minutes");
      const durationMinutes = optionalString(durationInput) === undefined ? undefined : parseInteger(durationInput, "Slot duration minutes");
      const startAt = eventStartAt + offsetMinutes * 60_000;

      return {
        personSlug: optionalString(personSlugInput),
        displayLabel: optionalString(displayLabelInput) ?? optionalString(personSlugInput) ?? `Slot ${index + 1}`,
        roleLabel: optionalString(roleLabelInput) ?? "Performer",
        startAt,
        ...(durationMinutes === undefined ? {} : { endAt: startAt + durationMinutes * 60_000 }),
      };
    });
}

function serializeMediaLinks(event: PublicEvent | undefined): string {
  return (event?.mediaLinks ?? [])
    .map((link) => `${link.type} | ${link.label} | ${link.url} | ${link.presentation}`)
    .join("\n");
}

function serializeParticipants(event: PublicEvent | undefined): string {
  return (event?.participants ?? [])
    .map((participant) => `${participant.slug} | ${participant.roleLabel}`)
    .join("\n");
}

function serializeSlots(event: PublicEvent | undefined): string {
  return (event?.slots ?? [])
    .map((slot) => {
      const offsetMinutes = Math.round((slot.startAt - event!.startAt) / 60_000);
      const durationMinutes = slot.endAt === undefined ? "" : String(Math.round((slot.endAt - slot.startAt) / 60_000));

      return [
        offsetMinutes,
        durationMinutes,
        slot.performer?.slug ?? "",
        slot.displayLabel,
        slot.roleLabel,
      ].join(" | ");
    })
    .join("\n");
}

function createGeneratedSlotText(count: number, durationMinutes: number, breakMinutes: number): string {
  return Array.from({ length: count }, (_, index) => {
    const offsetMinutes = index * (durationMinutes + breakMinutes);
    return `${offsetMinutes} | ${durationMinutes} |  | Slot ${index + 1} | DJ set`;
  }).join("\n");
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
      <p className="mt-3 text-sm leading-7 text-muted">
        The event mutations and form are wired, but the public editor stays locked until Convex auth is enabled for the web app.
      </p>
    </Card>
  );
}

function ConnectedEventEditorForm({ event }: { event?: PublicEvent }) {
  const createEvent = useMutation(api.events.createCommunityEvent);
  const updateEvent = useMutation(api.events.updateCommunityEvent);
  const [status, setStatus] = useState<EventEditorStatus>({ kind: "idle" });
  const [timezone, setTimezone] = useState(event?.timezone ?? "UTC");
  const [slotText, setSlotText] = useState(() => serializeSlots(event));
  const [slotTemplate, setSlotTemplate] = useState({ count: "4", duration: "45", break: "0" });
  const [, startTransition] = useTransition();

  useEffect(() => {
    if (event === undefined) {
      setTimezone(getBrowserTimezone());
    }
  }, [event]);

  function onGenerateSlots() {
    try {
      const count = parseInteger(slotTemplate.count, "Slot count");
      const duration = parseInteger(slotTemplate.duration, "Slot duration minutes");
      const breakDuration = parseInteger(slotTemplate.break, "Break duration minutes");

      if (count <= 0 || duration <= 0 || breakDuration < 0) {
        setStatus({ kind: "error", message: "Slot count and duration must be positive, and break duration cannot be negative." });
        return;
      }

      setSlotText(createGeneratedSlotText(count, duration, breakDuration));
    } catch (error) {
      setStatus({ kind: "error", message: eventEditorErrorMessage(error) });
    }
  }

  async function onSubmit(submitEvent: FormEvent<HTMLFormElement>) {
    submitEvent.preventDefault();
    const form = submitEvent.currentTarget;
    const formData = new FormData(form);
    const doorsOpenAtInput = optionalString(stringField(formData.get("doorsOpenAt")));
    const endAtInput = optionalString(stringField(formData.get("endAt")));

    setStatus({ kind: "submitting" });

    try {
      const submittedTimezone = optionalString(stringField(formData.get("timezone")));
      const timeZoneForParsing = submittedTimezone ?? getBrowserTimezone();
      const startAt = fromZonedInputValue(stringField(formData.get("startAt")), timeZoneForParsing, "Event start time");
      const payload = {
        title: stringField(formData.get("title")),
        preferredSlug: optionalString(stringField(formData.get("preferredSlug"))),
        communitySlug: optionalString(stringField(formData.get("communitySlug"))),
        worldSlug: optionalString(stringField(formData.get("worldSlug"))),
        startAt,
        ...(doorsOpenAtInput ? { doorsOpenAt: fromZonedInputValue(doorsOpenAtInput, timeZoneForParsing, "Doors-open time") } : {}),
        ...(endAtInput ? { endAt: fromZonedInputValue(endAtInput, timeZoneForParsing, "Event end time") } : {}),
        timezone: submittedTimezone,
        summary: optionalString(stringField(formData.get("summary"))),
        notes: optionalString(stringField(formData.get("notes"))),
        sourceLabel: optionalString(stringField(formData.get("sourceLabel"))),
        sourceUrl: optionalString(stringField(formData.get("sourceUrl"))),
        posterImageUrl: optionalString(stringField(formData.get("posterImageUrl"))),
        mediaLinks: parseMediaLinks(stringField(formData.get("mediaLinks"))),
        participantLinks: parseParticipantLinks(stringField(formData.get("participantLinks"))),
        slotLinks: parseSlotLinks(slotText, startAt),
      };
      const result = event
        ? await updateEvent({ currentSlug: event.slug, ...payload })
        : await createEvent(payload);

      startTransition(() => setStatus({ kind: "success", result }));
    } catch (error) {
      startTransition(() => setStatus({ kind: "error", message: eventEditorErrorMessage(error) }));
    }
  }

  const isSubmitting = status.kind === "submitting";

  return (
    <form className="grid gap-5" onSubmit={onSubmit}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field>
          Event title
          <Input defaultValue={event?.title} name="title" placeholder="Afterglow Harbor Sessions" required />
        </Field>
        <Field>
          Optional slug
          <Input defaultValue={event?.slug} name="preferredSlug" placeholder="afterglow-harbor-sessions" />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field>
          Community slug
          <Input defaultValue={event?.communitySlug} name="communitySlug" placeholder="afterglow-social" />
        </Field>
        <Field>
          Optional world slug
          <Input defaultValue={event?.worlds[0]?.slug} name="worldSlug" placeholder="neon-harbor" />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field>
          Doors open
          <Input defaultValue={toZonedInputValue(event?.doorsOpenAt, event?.timezone)} name="doorsOpenAt" type="datetime-local" />
          <FieldText>Optional public time, at or before event start.</FieldText>
        </Field>
        <Field>
          Start
          <Input defaultValue={toZonedInputValue(event?.startAt, event?.timezone)} name="startAt" required type="datetime-local" />
        </Field>
        <Field>
          End
          <Input defaultValue={toZonedInputValue(event?.endAt, event?.timezone)} name="endAt" type="datetime-local" />
        </Field>
        <Field>
          Time zone
          <Input name="timezone" onChange={(changeEvent) => setTimezone(changeEvent.currentTarget.value)} placeholder="America/New_York" value={timezone} />
        </Field>
      </div>

      <Field>
        Summary
        <Input defaultValue={event?.summary} name="summary" placeholder="Short public event summary" />
      </Field>

      <Field>
        Public notes
        <Textarea className="min-h-28" defaultValue={event?.notes} name="notes" placeholder="Door notes, schedule notes, or other public context" />
      </Field>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field className="sm:col-span-1">
          Source label
          <Input defaultValue={event?.source.label} name="sourceLabel" placeholder="Community event listing" />
        </Field>
        <Field className="sm:col-span-1">
          Source URL
          <Input defaultValue={event?.source.url} name="sourceUrl" placeholder="https://..." />
        </Field>
        <Field className="sm:col-span-1">
          Poster image URL
          <Input defaultValue={event?.posterImageUrl} name="posterImageUrl" placeholder="https://..." />
        </Field>
      </div>

      <Field>
        Media links
        <Textarea className="min-h-28" defaultValue={serializeMediaLinks(event)} name="mediaLinks" placeholder="watch | Twitch watch link | https://... | open&#10;vrcdn | VRCDN Quest link | https://stream.vrcdn.live/live/name.live.ts | copy&#10;vrcdn | VRCDN PC link | rtspt://stream.vrcdn.live/live/name | copy" />
        <FieldText>One per line: type | label | https URL | open or copy.</FieldText>
      </Field>

      <Field>
        Linked person profiles
        <Textarea className="min-h-28" defaultValue={serializeParticipants(event)} name="participantLinks" placeholder="dj-aurora | Performer&#10;vj-lumen | Staff" />
        <FieldText>One per line: person slug | freeform role label.</FieldText>
      </Field>

      <Card className="grid gap-4" padding="sm" surface="strong">
        <div>
          <Eyebrow>DJ slots</Eyebrow>
          <h3 className="mt-3 text-xl font-semibold tracking-[-0.03em]">Generate a set-time scaffold</h3>
          <p className="mt-2 text-xs leading-5 text-muted">
            Slots use minute offsets from the event start, so changing the event start keeps the lineup shape intact. Save requires a valid IANA time zone such as <code>America/New_York</code> or <code>UTC</code>.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
          <Field className="text-xs text-muted">
            Slot count
            <Input className="bg-white text-foreground" inputMode="numeric" onChange={(changeEvent) => setSlotTemplate((current) => ({ ...current, count: changeEvent.currentTarget.value }))} value={slotTemplate.count} />
          </Field>
          <Field className="text-xs text-muted">
            Duration minutes
            <Input className="bg-white text-foreground" inputMode="numeric" onChange={(changeEvent) => setSlotTemplate((current) => ({ ...current, duration: changeEvent.currentTarget.value }))} value={slotTemplate.duration} />
          </Field>
          <Field className="text-xs text-muted">
            Break minutes
            <Input className="bg-white text-foreground" inputMode="numeric" onChange={(changeEvent) => setSlotTemplate((current) => ({ ...current, break: changeEvent.currentTarget.value }))} value={slotTemplate.break} />
          </Field>
          <Button className="bg-white" onClick={onGenerateSlots} type="button">
            Generate
          </Button>
        </div>
        <Field>
          Slot rows
          <Textarea className="min-h-36 bg-white" name="slotLinks" onChange={(changeEvent) => setSlotText(changeEvent.currentTarget.value)} placeholder="0 | 45 | dj-aurora | DJ Aurora | House&#10;45 | 45 | dj-lumen | DJ Lumen | Trance" value={slotText} />
          <FieldText>One per line: start offset minutes | duration minutes | optional person slug | billing name | style or role. Linked slot performers are also deduped into event participants.</FieldText>
        </Field>
      </Card>

      <Notice>
        Event links publish immediately when saved. Approval, disputes, RSVP/interested state, recurring events, and friend-aware discovery are tracked as follow-on issues.
      </Notice>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Button disabled={isSubmitting} size="lg" type="submit" variant="primary">
          {isSubmitting ? "Saving..." : event ? "Update event" : "Create event"}
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

export function EventEditorForm({ event }: { event?: PublicEvent }) {
  if (!convexUrl) {
    return <DisabledEventEditorPanel />;
  }

  if (!eventEditorAuthReady) {
    return <SignInRequiredEventEditorPanel />;
  }

  return <ConnectedEventEditorForm event={event} />;
}
