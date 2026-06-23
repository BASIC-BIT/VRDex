import { normalizeProfileInlineText, sanitizeProfileTextList } from "./_profileSubmissions";
import {
  sanitizeEventSlotInputs,
  type EventSlotInput,
  type SanitizedEventSlotInput,
} from "./_eventSlots";
import { parseVrcdnStreamLinks } from "./_vrcdnLinks";

export const EVENT_TITLE_MIN_LENGTH = 2;
export const EVENT_TITLE_MAX_LENGTH = 120;
export const EVENT_SUMMARY_MAX_LENGTH = 240;
export const EVENT_NOTES_MAX_LENGTH = 1_200;
export const EVENT_TIMEZONE_MAX_LENGTH = 64;
export const EVENT_SOURCE_LABEL_MAX_LENGTH = 120;
export const EVENT_MEDIA_LINK_MAX_COUNT = 8;
export const EVENT_MEDIA_LABEL_MAX_LENGTH = 80;
export const EVENT_PARTICIPANT_MAX_COUNT = 80;
export const EVENT_PARTICIPANT_ROLE_MAX_LENGTH = 48;

type EventMediaLinkType =
  | "event_page"
  | "watch"
  | "stream"
  | "vrcdn"
  | "discord"
  | "ticket"
  | "other";

type EventMediaLinkPresentation = "open" | "copy";

export type EventMediaLinkInput = {
  type: EventMediaLinkType;
  label: string;
  url: string;
  presentation?: EventMediaLinkPresentation;
};

export type SanitizedEventMediaLink = {
  type: EventMediaLinkType;
  label: string;
  url: string;
  presentation: EventMediaLinkPresentation;
};

export type EventParticipantInput = {
  personSlug: string;
  roleLabel?: string;
  sourceLabel?: string;
  sourceUrl?: string;
  notes?: string;
};

export type SanitizedEventParticipantInput = {
  personSlug: string;
  roleLabel: string;
  sourceLabel: string;
  sourceUrl?: string;
  notes?: string;
};

export type EventDraftInput = {
  title: string;
  startAt: number;
  doorsOpenAt?: number;
  endAt?: number;
  timezone?: string;
  communitySlug?: string;
  summary?: string;
  notes?: string;
  sourceLabel?: string;
  sourceUrl?: string;
  posterImageUrl?: string;
  bannerImageUrl?: string;
  thumbnailImageUrl?: string;
  watchSurfaceEnabled?: boolean;
  mediaLinks?: EventMediaLinkInput[];
  participantLinks?: EventParticipantInput[];
  slotLinks?: EventSlotInput[];
  worldSlug?: string;
  preferredSlug?: string;
};

export type SanitizedEventDraftInput = {
  title: string;
  sortTitle: string;
  startAt: number;
  doorsOpenAt?: number;
  endAt?: number;
  timezone?: string;
  communitySlug?: string;
  summary?: string;
  notes?: string;
  sourceLabel: string;
  sourceUrl?: string;
  posterImageUrl?: string;
  bannerImageUrl?: string;
  thumbnailImageUrl?: string;
  watchSurfaceEnabled: boolean;
  mediaLinks: SanitizedEventMediaLink[];
  participantLinks: SanitizedEventParticipantInput[];
  slotLinks: SanitizedEventSlotInput[];
  worldSlug?: string;
  preferredSlug?: string;
};

const eventMediaLinkTypes = new Set<EventMediaLinkType>([
  "event_page",
  "watch",
  "stream",
  "vrcdn",
  "discord",
  "ticket",
  "other",
]);

function requireBoundedText(
  input: string,
  fieldName: string,
  minLength: number,
  maxLength: number,
): string {
  const value = normalizeProfileInlineText(input);

  if (value.length < minLength) {
    throw new Error(`${fieldName} must be at least ${minLength} characters.`);
  }

  if (value.length > maxLength) {
    throw new Error(`${fieldName} must be ${maxLength} characters or fewer.`);
  }

  return value;
}

function optionalBoundedText(
  input: string | undefined,
  fieldName: string,
  maxLength: number,
): string | undefined {
  if (input === undefined) {
    return undefined;
  }

  const value = normalizeProfileInlineText(input);

  if (value.length === 0) {
    return undefined;
  }

  if (value.length > maxLength) {
    throw new Error(`${fieldName} must be ${maxLength} characters or fewer.`);
  }

  return value;
}

export function createEventSortTitle(title: string): string {
  const asciiSortTitle = normalizeProfileInlineText(
    title
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " "),
  );

  return asciiSortTitle || normalizeProfileInlineText(title).toLowerCase();
}

function requireValidTimestamp(input: number, fieldName: string): number {
  if (!Number.isFinite(input)) {
    throw new Error(`${fieldName} must be a valid timestamp.`);
  }

  return input;
}

function optionalIanaTimezone(input: string | undefined): string | undefined {
  const value = optionalBoundedText(input, "Time zone", EVENT_TIMEZONE_MAX_LENGTH);

  if (value === undefined) {
    return undefined;
  }

  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format(new Date(0));
  } catch {
    throw new Error("Time zone must be a valid IANA time zone.");
  }

  return value;
}

function optionalHttpsUrl(input: string | undefined, fieldName: string): string | undefined {
  const value = optionalBoundedText(input, fieldName, 2_048);

  if (value === undefined) {
    return undefined;
  }

  try {
    const url = new URL(value);

    if (url.protocol !== "https:") {
      throw new Error(`${fieldName} must use https.`);
    }

    return url.href;
  } catch (error) {
    if (error instanceof Error && error.message === `${fieldName} must use https.`) {
      throw error;
    }

    throw new Error(`${fieldName} must be a valid URL.`);
  }
}

function optionalEventMediaUrl(input: string | undefined, fieldName: string): string | undefined {
  const value = optionalBoundedText(input, fieldName, 2_048);

  if (value === undefined) {
    return undefined;
  }

  const vrcdnLinks = parseVrcdnStreamLinks(value);

  if (vrcdnLinks !== null) {
    return vrcdnLinks.directVideoUrl ?? vrcdnLinks.pageUrl;
  }

  return optionalHttpsUrl(value, fieldName);
}

function sanitizeEventMediaLinks(input: EventMediaLinkInput[] | undefined): SanitizedEventMediaLink[] {
  const links: SanitizedEventMediaLink[] = [];
  const seenUrls = new Set<string>();

  for (const link of input ?? []) {
    if (!eventMediaLinkTypes.has(link.type)) {
      throw new Error("Event media link type is not supported.");
    }

    const label = requireBoundedText(link.label, "Media link label", 1, EVENT_MEDIA_LABEL_MAX_LENGTH);
    const url = optionalEventMediaUrl(link.url, "Media link URL");

    if (url === undefined) {
      continue;
    }

    const key = url.toLowerCase();
    if (seenUrls.has(key)) {
      continue;
    }

    if (links.length >= EVENT_MEDIA_LINK_MAX_COUNT) {
      throw new Error(`Media links can include at most ${EVENT_MEDIA_LINK_MAX_COUNT} entries.`);
    }

    seenUrls.add(key);
    links.push({
      type: link.type,
      label,
      url,
      presentation: link.presentation ?? (link.type === "vrcdn" ? "copy" : "open"),
    });
  }

  return links;
}

function sanitizeParticipantLinks(
  input: EventParticipantInput[] | undefined,
  fallbackSourceLabel: string,
): SanitizedEventParticipantInput[] {
  const links: SanitizedEventParticipantInput[] = [];
  const seenSlugs = new Set<string>();

  for (const link of input ?? []) {
    const [personSlug] = sanitizeProfileTextList([link.personSlug], "Participant profile slugs", {
      maxItems: 1,
      maxLength: 64,
    });

    if (personSlug === undefined) {
      continue;
    }

    const key = personSlug.toLowerCase();
    if (seenSlugs.has(key)) {
      continue;
    }

    if (links.length >= EVENT_PARTICIPANT_MAX_COUNT) {
      throw new Error(`Participant links can include at most ${EVENT_PARTICIPANT_MAX_COUNT} entries.`);
    }

    const roleLabel = optionalBoundedText(
      link.roleLabel,
      "Participant role",
      EVENT_PARTICIPANT_ROLE_MAX_LENGTH,
    ) ?? "Performer";
    const sourceLabel = optionalBoundedText(
      link.sourceLabel,
      "Participant source label",
      EVENT_SOURCE_LABEL_MAX_LENGTH,
    ) ?? fallbackSourceLabel;
    const sourceUrl = optionalHttpsUrl(link.sourceUrl, "Participant source URL");
    const notes = optionalBoundedText(link.notes, "Participant notes", EVENT_NOTES_MAX_LENGTH);

    seenSlugs.add(key);
    links.push({
      personSlug,
      roleLabel,
      sourceLabel,
      ...(sourceUrl ? { sourceUrl } : {}),
      ...(notes ? { notes } : {}),
    });
  }

  return links;
}

function assertDerivedParticipantLimit(
  participantLinks: SanitizedEventParticipantInput[],
  slotLinks: SanitizedEventSlotInput[],
) {
  const seenSlugs = new Set(participantLinks.map((link) => link.personSlug.toLowerCase()));

  for (const slot of slotLinks) {
    if (slot.personSlug !== undefined) {
      seenSlugs.add(slot.personSlug.toLowerCase());
    }
  }

  if (seenSlugs.size > EVENT_PARTICIPANT_MAX_COUNT) {
    throw new Error(`Participant links can include at most ${EVENT_PARTICIPANT_MAX_COUNT} unique profiles including linked slot performers.`);
  }
}

export function sanitizeEventDraftInput(input: EventDraftInput): SanitizedEventDraftInput {
  const title = requireBoundedText(
    input.title,
    "Event title",
    EVENT_TITLE_MIN_LENGTH,
    EVENT_TITLE_MAX_LENGTH,
  );
  const startAt = requireValidTimestamp(input.startAt, "Event start time");
  const doorsOpenAt = input.doorsOpenAt === undefined ? undefined : requireValidTimestamp(input.doorsOpenAt, "Doors-open time");
  const endAt = input.endAt === undefined ? undefined : requireValidTimestamp(input.endAt, "Event end time");

  if (doorsOpenAt !== undefined && doorsOpenAt > startAt) {
    throw new Error("Doors-open time must be at or before the event start time.");
  }

  if (endAt !== undefined && endAt <= startAt) {
    throw new Error("Event end time must be after the start time.");
  }

  const sourceLabel = optionalBoundedText(
    input.sourceLabel,
    "Event source label",
    EVENT_SOURCE_LABEL_MAX_LENGTH,
  ) ?? "Community-submitted event";
  const timezone = optionalIanaTimezone(input.timezone);
  const participantLinks = sanitizeParticipantLinks(input.participantLinks, sourceLabel);
  const slotLinks = sanitizeEventSlotInputs(input.slotLinks, sourceLabel, { startAt, endAt });
  assertDerivedParticipantLimit(participantLinks, slotLinks);

  if (slotLinks.length > 0 && timezone === undefined) {
    throw new Error("Time zone is required when event slots are provided.");
  }

  return {
    title,
    sortTitle: createEventSortTitle(title),
    startAt,
    ...optionalObjectField("doorsOpenAt", doorsOpenAt),
    ...(endAt ? { endAt } : {}),
    ...optionalObjectField("timezone", timezone),
    ...optionalObjectField("communitySlug", optionalBoundedText(input.communitySlug, "Community slug", 64)),
    ...optionalObjectField("summary", optionalBoundedText(input.summary, "Event summary", EVENT_SUMMARY_MAX_LENGTH)),
    ...optionalObjectField("notes", optionalBoundedText(input.notes, "Event notes", EVENT_NOTES_MAX_LENGTH)),
    sourceLabel,
    ...optionalObjectField("sourceUrl", optionalHttpsUrl(input.sourceUrl, "Event source URL")),
    ...optionalObjectField("posterImageUrl", optionalHttpsUrl(input.posterImageUrl, "Poster image URL")),
    ...optionalObjectField("bannerImageUrl", optionalHttpsUrl(input.bannerImageUrl, "Banner image URL")),
    ...optionalObjectField("thumbnailImageUrl", optionalHttpsUrl(input.thumbnailImageUrl, "Thumbnail image URL")),
    watchSurfaceEnabled: input.watchSurfaceEnabled ?? false,
    mediaLinks: sanitizeEventMediaLinks(input.mediaLinks),
    participantLinks,
    slotLinks,
    ...optionalObjectField("worldSlug", optionalBoundedText(input.worldSlug, "World slug", 64)),
    ...optionalObjectField("preferredSlug", optionalBoundedText(input.preferredSlug, "Event slug", 64)),
  };
}

function optionalObjectField<T>(key: string, value: T | undefined): Record<string, T> {
  return value === undefined ? {} : { [key]: value };
}
