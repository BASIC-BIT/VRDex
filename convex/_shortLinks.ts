import type { Doc, Id } from "./_generated/dataModel";
import type { DatabaseReader, DatabaseWriter } from "./_generated/server";
import {
  isSameAuthSubject,
  subjectHasCommunityCapability,
  type AuthSubject,
} from "./_communityAuthority";
import { getPublicEventBySlug } from "./_eventPublic";
import { userOwnsProfile } from "./_profileOwnership";
import { canReadProfile } from "./_profilePermissions";

export const SHORT_LINK_CODE_MIN_LENGTH = 5;
export const SHORT_LINK_CODE_MAX_LENGTH = 12;
export const SHORT_LINK_CODE_LENGTH = 7;
export const SHORT_LINK_CODE_PATTERN = /^[a-z0-9]+$/;
export const SHORT_LINK_CODE_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";

export const RESERVED_SHORT_LINK_CODES = [
  "about",
  "account",
  "admin",
  "api",
  "auth",
  "billing",
  "blog",
  "cards",
  "communities",
  "community",
  "contact",
  "dashboard",
  "docs",
  "events",
  "health",
  "help",
  "login",
  "logout",
  "moderation",
  "people",
  "pricing",
  "privacy",
  "profile",
  "qr",
  "search",
  "settings",
  "signup",
  "status",
  "support",
  "terms",
  "vrdex",
  "world",
  "worlds",
] as const;

export type ShortLinkTargetType = "profile" | "world" | "event";

export type ShortLinkTarget =
  | { targetType: "profile"; targetId: Id<"profiles"> }
  | { targetType: "world"; targetId: Id<"worlds"> }
  | { targetType: "event"; targetId: Id<"events"> };

export type ShortLinkReservationActor = {
  userId: Id<"users">;
  subject?: AuthSubject;
};

export type ShortLinkCodeValidationReason =
  | "empty"
  | "too_short"
  | "too_long"
  | "invalid_format"
  | "reserved";

export type ShortLinkCodeValidationResult =
  | { ok: true; code: string }
  | { ok: false; reason: ShortLinkCodeValidationReason };

export type ShortLinkCodeAvailabilityResult =
  | { available: true; code: string }
  | { available: false; code: string; reason: "invalid" | "reserved" | "taken" };

export type ShortLinkReservation = {
  shortLinkId: Id<"shortLinks">;
  code: string;
  shortLinkPath: string;
  targetType: ShortLinkTargetType;
  targetId: string;
  createdAt: number;
};

export type PublicShortLinkTarget = {
  code: string;
  targetType: ShortLinkTargetType;
  path: string;
};

const RESERVED_SHORT_LINK_CODE_SET = new Set<string>(RESERVED_SHORT_LINK_CODES);

export function normalizeShortLinkCodeInput(input: string): string {
  return input.trim().toLowerCase();
}

export function isReservedShortLinkCode(code: string): boolean {
  return RESERVED_SHORT_LINK_CODE_SET.has(code);
}

export function validateShortLinkCode(code: string): ShortLinkCodeValidationResult {
  if (code.length === 0) {
    return { ok: false, reason: "empty" };
  }

  if (code.length < SHORT_LINK_CODE_MIN_LENGTH) {
    return { ok: false, reason: "too_short" };
  }

  if (code.length > SHORT_LINK_CODE_MAX_LENGTH) {
    return { ok: false, reason: "too_long" };
  }

  if (!SHORT_LINK_CODE_PATTERN.test(code)) {
    return { ok: false, reason: "invalid_format" };
  }

  if (isReservedShortLinkCode(code)) {
    return { ok: false, reason: "reserved" };
  }

  return { ok: true, code };
}

export function toShortLinkCode(input: string): ShortLinkCodeValidationResult {
  return validateShortLinkCode(normalizeShortLinkCodeInput(input));
}

export function generateShortLinkCode(
  options: { length?: number; random?: () => number } = {},
): string {
  const length = options.length ?? SHORT_LINK_CODE_LENGTH;

  if (
    !Number.isInteger(length) ||
    length < SHORT_LINK_CODE_MIN_LENGTH ||
    length > SHORT_LINK_CODE_MAX_LENGTH
  ) {
    throw new Error(
      `Short link codes must be ${SHORT_LINK_CODE_MIN_LENGTH} to ${SHORT_LINK_CODE_MAX_LENGTH} characters.`,
    );
  }

  const random = options.random ?? Math.random;
  let code = "";

  for (let index = 0; index < length; index += 1) {
    const value = Math.max(0, Math.min(random(), 0.999999999));
    const alphabetIndex = Math.floor(value * SHORT_LINK_CODE_ALPHABET.length);
    code += SHORT_LINK_CODE_ALPHABET[alphabetIndex] ?? SHORT_LINK_CODE_ALPHABET[0];
  }

  return code;
}

export async function getShortLinkByCode(db: DatabaseReader, code: string) {
  return await db
    .query("shortLinks")
    .withIndex("by_code", (query) => query.eq("code", code))
    .unique();
}

export async function checkShortLinkCodeAvailability(
  db: DatabaseReader,
  code: string,
): Promise<ShortLinkCodeAvailabilityResult> {
  const validation = validateShortLinkCode(code);

  if (!validation.ok) {
    return {
      available: false,
      code,
      reason: validation.reason === "reserved" ? "reserved" : "invalid",
    };
  }

  const existingShortLink = await getShortLinkByCode(db, validation.code);

  if (existingShortLink !== null) {
    return { available: false, code: validation.code, reason: "taken" };
  }

  return { available: true, code: validation.code };
}

export async function findAvailableShortLinkCode(
  db: DatabaseReader,
  options: {
    maxAttempts?: number;
    generateCode?: (attempt: number) => string;
  } = {},
): Promise<string> {
  const maxAttempts = options.maxAttempts ?? 50;
  const generateCode = options.generateCode ?? (() => generateShortLinkCode());

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const candidate = normalizeShortLinkCodeInput(generateCode(attempt));
    const availability = await checkShortLinkCodeAvailability(db, candidate);

    if (availability.available) {
      return availability.code;
    }
  }

  throw new Error("Unable to reserve an available short link code.");
}

async function getShortLinkForTarget(db: DatabaseReader, target: ShortLinkTarget) {
  if (target.targetType === "profile") {
    return await db
      .query("shortLinks")
      .withIndex("by_targetProfileId", (query) => query.eq("targetProfileId", target.targetId))
      .unique();
  }

  if (target.targetType === "world") {
    return await db
      .query("shortLinks")
      .withIndex("by_targetWorldId", (query) => query.eq("targetWorldId", target.targetId))
      .unique();
  }

  return await db
    .query("shortLinks")
    .withIndex("by_targetEventId", (query) => query.eq("targetEventId", target.targetId))
    .unique();
}

async function requireShortLinkTarget(db: DatabaseReader, target: ShortLinkTarget) {
  const record = await db.get(target.targetId);

  if (record === null) {
    throw new Error("Short link target was not found.");
  }
}

async function actorCanManageProfile(
  db: DatabaseReader,
  profileId: Id<"profiles">,
  actor: ShortLinkReservationActor,
) {
  if (await userOwnsProfile(db, profileId, actor.userId)) {
    return true;
  }

  if (actor.subject === undefined) {
    return false;
  }

  return subjectHasCommunityCapability(db, profileId, actor.subject, "manage_profile");
}

async function actorCanReserveWorldShortLink(
  db: DatabaseReader,
  world: Doc<"worlds">,
  actor: ShortLinkReservationActor,
) {
  for (const attribution of world.creatorAttributions) {
    if (
      attribution.profileId !== undefined &&
      (await actorCanManageProfile(db, attribution.profileId, actor))
    ) {
      return true;
    }
  }

  return false;
}

async function actorCanReserveEventShortLink(
  db: DatabaseReader,
  event: Doc<"events">,
  actor: ShortLinkReservationActor,
) {
  if (
    actor.subject !== undefined &&
    event.submitter !== undefined &&
    isSameAuthSubject(event.submitter, actor.subject)
  ) {
    return true;
  }

  if (actor.subject === undefined || event.communityProfileId === undefined) {
    return false;
  }

  return subjectHasCommunityCapability(db, event.communityProfileId, actor.subject, "manage_events");
}

export async function canReserveShortLinkForTarget(
  db: DatabaseReader,
  target: ShortLinkTarget,
  actor: ShortLinkReservationActor,
): Promise<boolean> {
  if (target.targetType === "profile") {
    return actorCanManageProfile(db, target.targetId, actor);
  }

  if (target.targetType === "world") {
    const world = await db.get(target.targetId);

    return world !== null && (await actorCanReserveWorldShortLink(db, world, actor));
  }

  const event = await db.get(target.targetId);

  return event !== null && (await actorCanReserveEventShortLink(db, event, actor));
}

export async function requireShortLinkReservationPermission(
  db: DatabaseReader,
  target: ShortLinkTarget,
  actor: ShortLinkReservationActor,
) {
  if (!(await canReserveShortLinkForTarget(db, target, actor))) {
    throw new Error("You do not have permission to create a short link for this target.");
  }
}

function shortLinkTargetFields(target: ShortLinkTarget) {
  if (target.targetType === "profile") {
    return { targetProfileId: target.targetId };
  }

  if (target.targetType === "world") {
    return { targetWorldId: target.targetId };
  }

  return { targetEventId: target.targetId };
}

function shortLinkTargetId(shortLink: Doc<"shortLinks">): string {
  if (shortLink.targetType === "profile") {
    return String(shortLink.targetProfileId);
  }

  if (shortLink.targetType === "world") {
    return String(shortLink.targetWorldId);
  }

  return String(shortLink.targetEventId);
}

function toShortLinkReservation(shortLink: Doc<"shortLinks">): ShortLinkReservation {
  return {
    shortLinkId: shortLink._id,
    code: shortLink.code,
    shortLinkPath: `/l/${shortLink.code}`,
    targetType: shortLink.targetType,
    targetId: shortLinkTargetId(shortLink),
    createdAt: shortLink.createdAt,
  };
}

export async function ensureShortLinkForTarget(
  db: DatabaseWriter,
  target: ShortLinkTarget,
  now: number,
  options: {
    maxAttempts?: number;
    generateCode?: (attempt: number) => string;
  } = {},
): Promise<ShortLinkReservation> {
  await requireShortLinkTarget(db, target);

  const existingShortLink = await getShortLinkForTarget(db, target);

  if (existingShortLink !== null) {
    return toShortLinkReservation(existingShortLink);
  }

  const code = await findAvailableShortLinkCode(db, options);
  const shortLinkId = await db.insert("shortLinks", {
    code,
    targetType: target.targetType,
    ...shortLinkTargetFields(target),
    createdAt: now,
  });
  const shortLink = await db.get(shortLinkId);

  if (shortLink === null) {
    throw new Error("Short link reservation could not be read after creation.");
  }

  return toShortLinkReservation(shortLink);
}

async function publicProfileShortLinkPath(db: DatabaseReader, shortLink: Doc<"shortLinks">) {
  if (shortLink.targetProfileId === undefined) {
    return null;
  }

  const profile = await db.get(shortLink.targetProfileId);

  if (profile === null || !canReadProfile("public", profile)) {
    return null;
  }

  return profile.profileType === "person" ? `/p/${profile.slug}` : `/c/${profile.slug}`;
}

async function publicWorldShortLinkPath(db: DatabaseReader, shortLink: Doc<"shortLinks">) {
  if (shortLink.targetWorldId === undefined) {
    return null;
  }

  const world = await db.get(shortLink.targetWorldId);

  if (world === null || world.publicationState !== "published") {
    return null;
  }

  return `/w/${world.slug}`;
}

async function publicEventShortLinkPath(db: DatabaseReader, shortLink: Doc<"shortLinks">) {
  if (shortLink.targetEventId === undefined) {
    return null;
  }

  const event = await db.get(shortLink.targetEventId);
  const publicEvent = await getPublicEventBySlug(db, event);

  if (publicEvent === null) {
    return null;
  }

  return `/e/${publicEvent.slug}`;
}

export async function resolvePublicShortLinkTarget(
  db: DatabaseReader,
  inputCode: string,
): Promise<PublicShortLinkTarget | null> {
  const validation = toShortLinkCode(inputCode);

  if (!validation.ok) {
    return null;
  }

  const shortLink = await getShortLinkByCode(db, validation.code);

  if (shortLink === null) {
    return null;
  }

  const path =
    shortLink.targetType === "profile"
      ? await publicProfileShortLinkPath(db, shortLink)
      : shortLink.targetType === "world"
        ? await publicWorldShortLinkPath(db, shortLink)
        : await publicEventShortLinkPath(db, shortLink);

  if (path === null) {
    return null;
  }

  return {
    code: shortLink.code,
    targetType: shortLink.targetType,
    path,
  };
}
