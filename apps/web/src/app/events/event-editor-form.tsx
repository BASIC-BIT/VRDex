"use client";

import Link from "next/link";
import { FormEvent, useState, useTransition } from "react";
import { useMutation } from "convex/react";
import { api } from "@convex-generated-api";
import type { PublicEvent } from "../_components/event-public-page";

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
  /Event title must be at least \d+ characters\./,
  /Event title must be \d+ characters or fewer\./,
  /Event end time must be after the start time\./,
  /(?:Event source URL|Poster image URL|Media link URL|Participant source URL) must (?:use https|be a valid URL)\./,
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

function toLocalInputValue(timestamp: number | undefined): string {
  if (timestamp === undefined) {
    return "";
  }

  const date = new Date(timestamp);
  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

function fromLocalInputValue(value: string): number {
  const timestamp = new Date(value).getTime();

  if (!Number.isFinite(timestamp)) {
    throw new Error("Event start time must be a valid timestamp.");
  }

  return timestamp;
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

function DisabledEventEditorPanel() {
  return (
    <div className="rounded-[1.5rem] border border-dashed border-border bg-surface px-5 py-6">
      <p className="font-mono text-xs uppercase tracking-[0.28em] text-muted">Event editor</p>
      <h2 className="mt-4 text-2xl font-semibold tracking-[-0.03em]">Convex URL not configured</h2>
      <p className="mt-3 text-sm leading-7 text-muted">
        Run <code className="font-mono text-[0.95em]">pnpm bootstrap:backend:local</code> before testing event creation locally.
      </p>
    </div>
  );
}

function SignInRequiredEventEditorPanel() {
  return (
    <div className="rounded-[1.5rem] border border-dashed border-border bg-surface px-5 py-6">
      <p className="font-mono text-xs uppercase tracking-[0.28em] text-muted">Event editor</p>
      <h2 className="mt-4 text-2xl font-semibold tracking-[-0.03em]">Sign-in required</h2>
      <p className="mt-3 text-sm leading-7 text-muted">
        The event mutations and form are wired, but the public editor stays locked until Convex auth is enabled for the web app.
      </p>
    </div>
  );
}

function ConnectedEventEditorForm({ event }: { event?: PublicEvent }) {
  const createEvent = useMutation(api.events.createCommunityEvent);
  const updateEvent = useMutation(api.events.updateCommunityEvent);
  const [status, setStatus] = useState<EventEditorStatus>({ kind: "idle" });
  const [, startTransition] = useTransition();

  async function onSubmit(submitEvent: FormEvent<HTMLFormElement>) {
    submitEvent.preventDefault();
    const form = submitEvent.currentTarget;
    const formData = new FormData(form);
    const endAtInput = optionalString(stringField(formData.get("endAt")));

    setStatus({ kind: "submitting" });

    try {
      const startAt = fromLocalInputValue(stringField(formData.get("startAt")));
      const payload = {
        title: stringField(formData.get("title")),
        preferredSlug: optionalString(stringField(formData.get("preferredSlug"))),
        communitySlug: optionalString(stringField(formData.get("communitySlug"))),
        worldSlug: optionalString(stringField(formData.get("worldSlug"))),
        startAt,
        ...(endAtInput ? { endAt: fromLocalInputValue(endAtInput) } : {}),
        timezone: optionalString(stringField(formData.get("timezone"))),
        summary: optionalString(stringField(formData.get("summary"))),
        notes: optionalString(stringField(formData.get("notes"))),
        sourceLabel: optionalString(stringField(formData.get("sourceLabel"))),
        sourceUrl: optionalString(stringField(formData.get("sourceUrl"))),
        posterImageUrl: optionalString(stringField(formData.get("posterImageUrl"))),
        mediaLinks: parseMediaLinks(stringField(formData.get("mediaLinks"))),
        participantLinks: parseParticipantLinks(stringField(formData.get("participantLinks"))),
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
        <label className="grid gap-2 text-sm font-medium">
          Event title
          <input className="rounded-2xl border border-border bg-surface-strong px-4 py-3 font-normal outline-none transition focus:border-accent" defaultValue={event?.title} name="title" placeholder="Afterglow Harbor Sessions" required />
        </label>
        <label className="grid gap-2 text-sm font-medium">
          Optional slug
          <input className="rounded-2xl border border-border bg-surface-strong px-4 py-3 font-normal outline-none transition focus:border-accent" defaultValue={event?.slug} name="preferredSlug" placeholder="afterglow-harbor-sessions" />
        </label>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="grid gap-2 text-sm font-medium">
          Community slug
          <input className="rounded-2xl border border-border bg-surface-strong px-4 py-3 font-normal outline-none transition focus:border-accent" defaultValue={event?.communitySlug} name="communitySlug" placeholder="afterglow-social" />
        </label>
        <label className="grid gap-2 text-sm font-medium">
          Optional world slug
          <input className="rounded-2xl border border-border bg-surface-strong px-4 py-3 font-normal outline-none transition focus:border-accent" defaultValue={event?.worlds[0]?.slug} name="worldSlug" placeholder="neon-harbor" />
        </label>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <label className="grid gap-2 text-sm font-medium">
          Start
          <input className="rounded-2xl border border-border bg-surface-strong px-4 py-3 font-normal outline-none transition focus:border-accent" defaultValue={toLocalInputValue(event?.startAt)} name="startAt" required type="datetime-local" />
        </label>
        <label className="grid gap-2 text-sm font-medium">
          End
          <input className="rounded-2xl border border-border bg-surface-strong px-4 py-3 font-normal outline-none transition focus:border-accent" defaultValue={toLocalInputValue(event?.endAt)} name="endAt" type="datetime-local" />
        </label>
        <label className="grid gap-2 text-sm font-medium">
          Time zone
          <input className="rounded-2xl border border-border bg-surface-strong px-4 py-3 font-normal outline-none transition focus:border-accent" defaultValue={event?.timezone} name="timezone" placeholder="America/New_York" />
        </label>
      </div>

      <label className="grid gap-2 text-sm font-medium">
        Summary
        <input className="rounded-2xl border border-border bg-surface-strong px-4 py-3 font-normal outline-none transition focus:border-accent" defaultValue={event?.summary} name="summary" placeholder="Short public event summary" />
      </label>

      <label className="grid gap-2 text-sm font-medium">
        Public notes
        <textarea className="min-h-28 rounded-2xl border border-border bg-surface-strong px-4 py-3 font-normal outline-none transition focus:border-accent" defaultValue={event?.notes} name="notes" placeholder="Door notes, schedule notes, or other public context" />
      </label>

      <div className="grid gap-4 sm:grid-cols-3">
        <label className="grid gap-2 text-sm font-medium sm:col-span-1">
          Source label
          <input className="rounded-2xl border border-border bg-surface-strong px-4 py-3 font-normal outline-none transition focus:border-accent" defaultValue={event?.source.label} name="sourceLabel" placeholder="Community event listing" />
        </label>
        <label className="grid gap-2 text-sm font-medium sm:col-span-1">
          Source URL
          <input className="rounded-2xl border border-border bg-surface-strong px-4 py-3 font-normal outline-none transition focus:border-accent" defaultValue={event?.source.url} name="sourceUrl" placeholder="https://..." />
        </label>
        <label className="grid gap-2 text-sm font-medium sm:col-span-1">
          Poster image URL
          <input className="rounded-2xl border border-border bg-surface-strong px-4 py-3 font-normal outline-none transition focus:border-accent" defaultValue={event?.posterImageUrl} name="posterImageUrl" placeholder="https://..." />
        </label>
      </div>

      <label className="grid gap-2 text-sm font-medium">
        Media links
        <textarea className="min-h-28 rounded-2xl border border-border bg-surface-strong px-4 py-3 font-normal outline-none transition focus:border-accent" defaultValue={serializeMediaLinks(event)} name="mediaLinks" placeholder="watch | Twitch watch link | https://... | open&#10;vrcdn | VRCDN PC link | https://... | copy" />
        <span className="text-xs leading-5 text-muted">One per line: type | label | https URL | open or copy.</span>
      </label>

      <label className="grid gap-2 text-sm font-medium">
        Linked person profiles
        <textarea className="min-h-28 rounded-2xl border border-border bg-surface-strong px-4 py-3 font-normal outline-none transition focus:border-accent" defaultValue={serializeParticipants(event)} name="participantLinks" placeholder="dj-aurora | Performer&#10;vj-lumen | Staff" />
        <span className="text-xs leading-5 text-muted">One per line: person slug | freeform role label.</span>
      </label>

      <div className="rounded-[1.25rem] border border-border bg-surface-strong px-4 py-4 text-sm leading-6 text-muted">
        Event links publish immediately when saved. Approval, disputes, RSVP/interested state, recurring events, and friend-aware discovery are tracked as follow-on issues.
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <button className="inline-flex items-center justify-center rounded-full bg-accent px-5 py-3 text-sm font-medium text-white transition hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-60" disabled={isSubmitting} type="submit">
          {isSubmitting ? "Saving..." : event ? "Update event" : "Create event"}
        </button>
        {status.kind === "success" ? (
          <Link className="inline-flex items-center justify-center rounded-full border border-border bg-surface-strong px-5 py-3 text-sm font-medium" href={status.result.eventPath}>
            View {status.result.eventPath}
          </Link>
        ) : null}
      </div>

      {status.kind === "error" ? (
        <p className="rounded-[1rem] border border-accent/35 bg-accent/10 px-4 py-3 text-sm leading-6 text-accent-strong">
          {status.message}
        </p>
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
