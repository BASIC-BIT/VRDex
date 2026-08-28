"use client";

import Link from "next/link";
import type { ChangeEvent, FormEvent } from "react";
import { useEffect, useState, useTransition } from "react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { api } from "@convex-generated-api";
import type { Id } from "../../../../../convex/_generated/dataModel";
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
  parseZonedDateTimeInput,
} from "@/lib/calendar/zoned-date-time";

type EventMediaLinkType = PublicEvent["mediaLinks"][number]["type"];

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;

type EventEditorStatus =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "success"; result: { eventPath: string; slug: string } }
  | { kind: "error"; message: string };

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

type EditableEvent = PublicEvent & {
  preservedCommunityProfileId?: Id<"profiles">;
  preservedParticipantAssociationIds: Id<"eventParticipants">[];
  preservedSlotAssociationIds: Id<"eventSlots">[];
  preservedWorldAssociationIds: Id<"eventWorlds">[];
  publicationState?: "draft_private" | "published";
};

type SlotFormRow = {
  id: string;
  offsetMinutes: string;
  durationMinutes: string;
  personSlug: string;
  displayLabel: string;
  roleLabel: string;
};

type VrcdnOutputAccountOption = {
  key: string;
  label: string;
  playbackLinks: Array<{
    platform: "browser" | "pc" | "standalone";
    label?: string;
    url: string;
  }>;
};

function PersonProfileInput({
  inputId,
  onChange,
  value,
}: {
  inputId: string;
  onChange: (value: string, displayName?: string) => void;
  value: string;
}) {
  const query = value.trim();
  const matches = useQuery(
    api.search.searchUniversal,
    query.length >= 2
      ? { query, entityType: "profile", profileType: "person", limit: 6 }
      : "skip",
  );
  const listId = `${inputId}-matches`;
  return (
    <>
      <Input
        id={inputId}
        list={listId}
        onChange={(changeEvent) => {
          const nextValue = eventTargetValue(changeEvent);
          const selected = matches?.find((match) => match.slug === nextValue);
          onChange(nextValue, selected?.title);
        }}
        placeholder="Search name or slug"
        value={value}
      />
      <datalist id={listId}>
        {matches?.map((match) => (
          <option key={match.routePath} label={match.title} value={match.slug} />
        ))}
      </datalist>
    </>
  );
}

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
  /Current event slug is invalid\./,
  /Event was not found\./,
  /Output account is required\./,
  /Output account is not configured\./,
  /Output label is required\./,
  /Output label must be \d+ characters or fewer\./,
  /Watch preview URL is required\./,
  /Confirm you are authorized to publish this output\./,
  /Media control public links must use HTTPS or a recognized VRCDN stream URL\./,
];

function eventEditorErrorMessage(error: unknown): string {
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

function parseSlotRows(rows: SlotFormRow[], eventStartAt: number) {
  return rows.map((row, index) => {
      const offsetMinutes = parseInteger(row.offsetMinutes, "Slot offset minutes");
      const durationMinutes = optionalString(row.durationMinutes) === undefined
        ? undefined
        : parseInteger(row.durationMinutes, "Slot duration minutes");
      const startAt = eventStartAt + offsetMinutes * 60_000;

      return {
        personSlug: optionalString(row.personSlug),
        displayLabel:
          optionalString(row.displayLabel) ??
          optionalString(row.personSlug) ??
          `Slot ${index + 1}`,
        roleLabel: optionalString(row.roleLabel) ?? "Performer",
        startAt,
        ...(durationMinutes === undefined ? {} : { endAt: startAt + durationMinutes * 60_000 }),
      };
    });
}

function serializeMediaLinks(event: PublicEvent | undefined): string {
  return (event?.authoredMediaLinks ?? event?.mediaLinks ?? [])
    .map((link) => `${link.type} | ${link.label} | ${link.url} | ${link.presentation}`)
    .join("\n");
}

function serializeParticipants(event: PublicEvent | undefined): string {
  return (event?.participants ?? [])
    .map((participant) => `${participant.slug} | ${participant.roleLabel}`)
    .join("\n");
}

function initialSlotRows(event: EditableEvent | undefined): SlotFormRow[] {
  if (event === undefined) {
    return [];
  }

  return event.slots.map((slot, index) => ({
    id: `stored-${slot.position}-${slot.startAt}-${index}`,
    offsetMinutes: String(Math.round((slot.startAt - event.startAt) / 60_000)),
    durationMinutes:
      slot.endAt === undefined
        ? ""
        : String(Math.round((slot.endAt - slot.startAt) / 60_000)),
    personSlug: slot.performer?.slug ?? "",
    displayLabel: slot.displayLabel,
    roleLabel: slot.roleLabel,
  }));
}

function createGeneratedSlotRows(
  count: number,
  durationMinutes: number,
  breakMinutes: number,
): SlotFormRow[] {
  return Array.from({ length: count }, (_, index) => {
    const offsetMinutes = index * (durationMinutes + breakMinutes);
    return {
      id: `generated-${Date.now()}-${index}`,
      offsetMinutes: String(offsetMinutes),
      durationMinutes: String(durationMinutes),
      personSlug: "",
      displayLabel: `Slot ${index + 1}`,
      roleLabel: "DJ set",
    };
  });
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

function ConnectedEventEditorForm({ event }: { event?: EditableEvent }) {
  const createEvent = useMutation(api.events.createCommunityEvent);
  const updateEvent = useMutation(api.events.updateCommunityEvent);
  const setEventCancelled = useMutation(api.events.setCommunityEventCancelled);
  const configureVrcdnOutput = useMutation(api.events.configureVrcdnOutput);
  const managedCommunities = useQuery(api.events.listManagedCommunities, {});
  const vrcdnOutputAccounts = useQuery(api.events.listVrcdnOutputAccounts, {});
  const [currentSlug, setCurrentSlug] = useState(event?.slug);
  const eventMediaControlStatus = useQuery(api.events.getEventMediaControlStatus, currentSlug === undefined ? "skip" : { currentSlug });
  const eventAudit = useQuery(
    api.events.listEventAudit,
    currentSlug === undefined ? "skip" : { currentSlug, limit: 40 },
  );
  const [status, setStatus] = useState<EventEditorStatus>({ kind: "idle" });
  const [vrcdnOutputStatus, setVrcdnOutputStatus] = useState<VrcdnOutputStatus>({ kind: "idle" });
  const [timezone, setTimezone] = useState(event?.timezone ?? "UTC");
  const [mediaLinksText, setMediaLinksText] = useState(() => serializeMediaLinks(event));
  const [vrcdnOutput, setVrcdnOutput] = useState<VrcdnOutputFormState>(() => createInitialVrcdnOutputForm(event));
  const [slotRows, setSlotRows] = useState(() => initialSlotRows(event));
  const [slotTemplate, setSlotTemplate] = useState({ count: "4", duration: "45", break: "0" });
  const [cancellationReason, setCancellationReason] = useState("");
  const [eventStatus, setEventStatus] = useState(event?.status);
  const [isPublished, setIsPublished] = useState(event?.publicationState === "published");
  const [, startTransition] = useTransition();

  useEffect(() => {
    if (event === undefined) {
      setTimezone(browserTimeZone());
    }
  }, [event]);

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

  function onGenerateSlots() {
    try {
      const count = parseInteger(slotTemplate.count, "Slot count");
      const duration = parseInteger(slotTemplate.duration, "Slot duration minutes");
      const breakDuration = parseInteger(slotTemplate.break, "Break duration minutes");

      if (count <= 0 || duration <= 0 || breakDuration < 0) {
        setStatus({ kind: "error", message: "Slot count and duration must be positive, and break duration cannot be negative." });
        return;
      }

      setSlotRows(createGeneratedSlotRows(count, duration, breakDuration));
    } catch (error) {
      setStatus({ kind: "error", message: eventEditorErrorMessage(error) });
    }
  }

  async function onSaveVrcdnOutput() {
    if (event === undefined) {
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
    const form = submitEvent.currentTarget;
    const formData = new FormData(form, (submitEvent.nativeEvent as SubmitEvent).submitter);
    const doorsOpenAtInput = optionalString(stringField(formData.get("doorsOpenAt")));
    const endAtInput = optionalString(stringField(formData.get("endAt")));
    const intent = stringField(formData.get("intent"));

    if (event !== undefined && isPublished && intent === "draft" && !window.confirm("Unpublish and save draft")) {
      return;
    }

    setStatus({ kind: "submitting" });

    try {
      const submittedTimezone = optionalString(stringField(formData.get("timezone")));
      const timeZoneForParsing = submittedTimezone ?? browserTimeZone();
      const startAt = parseZonedDateTimeInput(stringField(formData.get("startAt")), timeZoneForParsing, "Event start time");
      const payload = {
        title: stringField(formData.get("title")),
        preferredSlug: optionalString(stringField(formData.get("preferredSlug"))),
        communitySlug: optionalString(stringField(formData.get("communitySlug"))),
        worldSlug: optionalString(stringField(formData.get("worldSlug"))),
        startAt,
        ...(doorsOpenAtInput ? { doorsOpenAt: parseZonedDateTimeInput(doorsOpenAtInput, timeZoneForParsing, "Doors-open time") } : {}),
        ...(endAtInput ? { endAt: parseZonedDateTimeInput(endAtInput, timeZoneForParsing, "Event end time") } : {}),
        timezone: submittedTimezone,
        summary: optionalString(stringField(formData.get("summary"))),
        notes: optionalString(stringField(formData.get("notes"))),
        sourceLabel: optionalString(stringField(formData.get("sourceLabel"))),
        sourceUrl: optionalString(stringField(formData.get("sourceUrl"))),
        posterImageUrl: optionalString(stringField(formData.get("posterImageUrl"))),
        bannerImageUrl: optionalString(stringField(formData.get("bannerImageUrl"))),
        thumbnailImageUrl: optionalString(stringField(formData.get("thumbnailImageUrl"))),
        watchSurfaceEnabled: formData.get("watchSurfaceEnabled") === "on",
        mediaLinks: parseMediaLinks(mediaLinksText),
        participantLinks: parseParticipantLinks(stringField(formData.get("participantLinks"))),
        slotLinks: parseSlotRows(slotRows, startAt),
      };
      const result = event
          ? await updateEvent({
            currentSlug: currentSlug!,
            preservedCommunityProfileId: event.preservedCommunityProfileId,
            preservedParticipantAssociationIds: event.preservedParticipantAssociationIds,
            preservedSlotAssociationIds: event.preservedSlotAssociationIds,
            preservedWorldAssociationIds: event.preservedWorldAssociationIds,
            ...(intent === "publish"
              ? { published: true }
              : intent === "draft"
                ? { published: false }
                : {}),
            ...payload,
          })
        : await createEvent({ ...payload, published: intent === "publish" });

      if (event !== undefined && (intent === "publish" || intent === "draft")) {
        setIsPublished(intent === "publish");
      }
      if (event !== undefined) setCurrentSlug(result.slug);

      startTransition(() =>
        setStatus({
          kind: "success",
          result: {
            ...result,
            eventPath: intent === "publish" ? `/${result.slug}` : `/events/${result.slug}/edit`,
          },
        }),
      );
    } catch (error) {
      startTransition(() => setStatus({ kind: "error", message: eventEditorErrorMessage(error) }));
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
          result: { eventPath: `/${currentSlug}`, slug: currentSlug! },
        }),
      );
    } catch (error) {
      startTransition(() => setStatus({ kind: "error", message: eventEditorErrorMessage(error) }));
    }
  }

  const isSubmitting = status.kind === "submitting";
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
          Community
          {event ? (
            <>
              <Input disabled value={event.communityName ?? event.communitySlug ?? ""} />
              <input name="communitySlug" type="hidden" value={event.communitySlug ?? ""} />
            </>
          ) : (
            <>
              <Select disabled={managedCommunities === undefined || managedCommunities.length === 0} name="communitySlug" required>
                <option value="">Select a community</option>
                {managedCommunities?.map((community) => (
                  <option key={community.profileId} value={community.slug}>
                    {community.displayName} · {community.roleLabel}
                  </option>
                ))}
              </Select>
            </>
          )}
        </Field>
        <Field>
          Optional world slug
          <Input defaultValue={event?.worlds[0]?.slug} name="worldSlug" placeholder="neon-harbor" />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field>
          Doors open
          <Input defaultValue={formatZonedDateTimeInput(event?.doorsOpenAt, event?.timezone)} name="doorsOpenAt" type="datetime-local" />
          <FieldText>Optional public time, at or before event start.</FieldText>
        </Field>
        <Field>
          Start
          <Input defaultValue={formatZonedDateTimeInput(event?.startAt, event?.timezone)} name="startAt" required type="datetime-local" />
        </Field>
        <Field>
          End
          <Input defaultValue={formatZonedDateTimeInput(event?.endAt, event?.timezone)} name="endAt" type="datetime-local" />
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
      <label className="flex gap-3 rounded-control border border-border bg-surface-strong p-4 text-sm leading-6">
        <input
          className="mt-1 h-4 w-4 flex-none accent-accent"
          defaultChecked={event?.watchSurfaceEnabled ?? false}
          name="watchSurfaceEnabled"
          type="checkbox"
        />
        <span>
          <span className="block font-medium text-foreground">Promote a watch surface during the event window</span>
          <span className="mt-1 block text-xs leading-5 text-muted">
            Keep this off unless stream capacity is ready for public viewers. Links still appear in the normal links section.
          </span>
        </span>
      </label>
      <VrcdnMediaLinkAssistant mediaLinksText={mediaLinksText} />

      {event === undefined ? null : (
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

      {event === undefined ? null : (
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
                  <dt className="text-xs text-muted">Program</dt>
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

      <Field>
        Linked person profiles
        <Textarea className="min-h-28" defaultValue={serializeParticipants(event)} name="participantLinks" placeholder="dj-aurora | Performer&#10;vj-lumen | Staff" />
        <FieldText>One per line: person slug | freeform role label.</FieldText>
      </Field>

      <Card className="grid gap-4" padding="sm" surface="strong">
        <div>
          <Eyebrow>DJ slots</Eyebrow>
          <h3 className="mt-3 text-xl font-semibold tracking-[-0.03em]">Set times</h3>
        </div>
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
          <Field className="text-xs text-muted">
            Slot count
            <Input
              className="bg-surface-strong text-foreground"
              inputMode="numeric"
              onChange={(changeEvent) => {
                const value = eventTargetValue(changeEvent);
                setSlotTemplate((current) => ({ ...current, count: value }));
              }}
              value={slotTemplate.count}
            />
          </Field>
          <Field className="text-xs text-muted">
            Duration minutes
            <Input
              className="bg-surface-strong text-foreground"
              inputMode="numeric"
              onChange={(changeEvent) => {
                const value = eventTargetValue(changeEvent);
                setSlotTemplate((current) => ({ ...current, duration: value }));
              }}
              value={slotTemplate.duration}
            />
          </Field>
          <Field className="text-xs text-muted">
            Break minutes
            <Input
              className="bg-surface-strong text-foreground"
              inputMode="numeric"
              onChange={(changeEvent) => {
                const value = eventTargetValue(changeEvent);
                setSlotTemplate((current) => ({ ...current, break: value }));
              }}
              value={slotTemplate.break}
            />
          </Field>
          <Button onClick={onGenerateSlots} type="button">
            Generate
          </Button>
        </div>
        <div className="grid gap-3">
          {slotRows.map((slot, index) => (
            <Card className="grid gap-3" key={slot.id} padding="sm" surface="dashed">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                <Field className="text-xs text-muted">
                  Start offset
                  <Input
                    inputMode="numeric"
                    onChange={(changeEvent) => {
                      const value = eventTargetValue(changeEvent);
                      setSlotRows((rows) => rows.map((row) => row.id === slot.id ? { ...row, offsetMinutes: value } : row));
                    }}
                    value={slot.offsetMinutes}
                  />
                </Field>
                <Field className="text-xs text-muted">
                  Duration
                  <Input
                    inputMode="numeric"
                    onChange={(changeEvent) => {
                      const value = eventTargetValue(changeEvent);
                      setSlotRows((rows) => rows.map((row) => row.id === slot.id ? { ...row, durationMinutes: value } : row));
                    }}
                    value={slot.durationMinutes}
                  />
                </Field>
                <Field className="text-xs text-muted">
                  Person profile
                  <PersonProfileInput
                    inputId={`slot-person-${slot.id}`}
                    onChange={(value, displayName) => {
                      setSlotRows((rows) => rows.map((row) => row.id === slot.id
                        ? {
                            ...row,
                            personSlug: value,
                            ...(displayName !== undefined && row.displayLabel.trim() === ""
                              ? { displayLabel: displayName }
                              : {}),
                          }
                        : row));
                    }}
                    value={slot.personSlug}
                  />
                </Field>
                <Field className="text-xs text-muted">
                  Lineup name
                  <Input
                    onChange={(changeEvent) => {
                      const value = eventTargetValue(changeEvent);
                      setSlotRows((rows) => rows.map((row) => row.id === slot.id ? { ...row, displayLabel: value } : row));
                    }}
                    required
                    value={slot.displayLabel}
                  />
                </Field>
                <Field className="text-xs text-muted">
                  Role or style
                  <Input
                    onChange={(changeEvent) => {
                      const value = eventTargetValue(changeEvent);
                      setSlotRows((rows) => rows.map((row) => row.id === slot.id ? { ...row, roleLabel: value } : row));
                    }}
                    value={slot.roleLabel}
                  />
                </Field>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  disabled={index === 0}
                  onClick={() => setSlotRows((rows) => {
                    const next = [...rows];
                    [next[index - 1], next[index]] = [next[index]!, next[index - 1]!];
                    return next;
                  })}
                  size="sm"
                  type="button"
                  variant="secondary"
                >
                  Move up
                </Button>
                <Button
                  disabled={index === slotRows.length - 1}
                  onClick={() => setSlotRows((rows) => {
                    const next = [...rows];
                    [next[index], next[index + 1]] = [next[index + 1]!, next[index]!];
                    return next;
                  })}
                  size="sm"
                  type="button"
                  variant="secondary"
                >
                  Move down
                </Button>
                <Button
                  onClick={() => setSlotRows((rows) => rows.filter((row) => row.id !== slot.id))}
                  size="sm"
                  type="button"
                  variant="secondary"
                >
                  Remove
                </Button>
              </div>
            </Card>
          ))}
          <Button
            onClick={() => setSlotRows((rows) => [
              ...rows,
              {
                id: `manual-${Date.now()}-${rows.length}`,
                offsetMinutes: "0",
                durationMinutes: "45",
                personSlug: "",
                displayLabel: "",
                roleLabel: "DJ set",
              },
            ])}
            type="button"
            variant="secondary"
          >
            Add slot
          </Button>
        </div>
      </Card>

      {event === undefined ? null : (
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
      )}

      {event === undefined ? null : (
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
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Button disabled={isSubmitting} name="intent" size="lg" type="submit" value="publish" variant="primary">
          {isSubmitting
            ? "Saving..."
            : isPublished
              ? "Save changes"
              : event
                ? "Save and publish"
                : "Publish event"}
        </Button>
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

export function EventEditorForm({ event }: { event?: EditableEvent }) {
  if (!convexUrl) {
    return <DisabledEventEditorPanel />;
  }

  return <AuthenticatedEventEditorForm event={event} />;
}

function AuthenticatedEventEditorForm({ event }: { event?: EditableEvent }) {
  const { isAuthenticated, isLoading } = useConvexAuth();

  if (isLoading) {
    return <p className="text-sm text-muted">Loading sign-in state...</p>;
  }

  if (!isAuthenticated) {
    return <SignInRequiredEventEditorPanel />;
  }

  return <ConnectedEventEditorForm event={event} />;
}
