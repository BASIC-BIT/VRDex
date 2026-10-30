import { ConvexError, v, type Infer } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { DatabaseReader, MutationCtx, QueryCtx } from "./_generated/server";
import { getAccountFeatureAccess } from "./_accountFeatures";
import { resolveClubSubject } from "./_clubAccess";
import type { ClubPermission } from "./_clubModel";
import type { AuthSubject } from "./_communityAuthority";
import { userOwnsProfile } from "./_profileOwnership";
import { allowedDirections, type ConnectorDirection, type ConnectorKind } from "./_eventConnectorModel";
import { UpdateEventContributionSchema, type EventIntakeFields } from "../packages/api-contracts/src/event-intake";

export const connectorKind = v.union(
  v.literal("discord_announcements"), v.literal("discord_board"), v.literal("discord_scheduled_events"),
  v.literal("google_calendar"), v.literal("vrchat_calendar"), v.literal("notion"),
);
export const connectorDirection = v.union(v.literal("import"), v.literal("export"), v.literal("bidirectional"), v.literal("off"));
export const connectorMode = v.union(v.literal("hold"), v.literal("autopublish"));
export const connectorState = v.union(v.literal("active"), v.literal("paused"), v.literal("needs_reauth"), v.literal("removed"));
// The *Name fields are display names captured at connect time for the settings page; never used for matching.
export const connectorTarget = v.object({
  guildId: v.optional(v.string()), channelId: v.optional(v.string()), calendarId: v.optional(v.string()), groupId: v.optional(v.string()),
  guildName: v.optional(v.string()), channelName: v.optional(v.string()), calendarName: v.optional(v.string()), groupName: v.optional(v.string()),
});
export const credentialProvider = v.union(v.literal("google"), v.literal("notion"));
export const syncLinkState = v.union(v.literal("linked"), v.literal("external_deleted"), v.literal("vrdex_retracted"));
export const syncJobKind = v.union(
  v.literal("reconcile"), v.literal("export_upsert"), v.literal("export_delete"),
  v.literal("import_item"), v.literal("import_poll"), v.literal("board_refresh"),
);
export const syncJobState = v.union(v.literal("pending"), v.literal("running"), v.literal("done"), v.literal("failed"));

// The literal unions live in _eventConnectorModel for the web client; this fails typecheck if the validators drift from them.
export { allowedDirections, type ConnectorDirection, type ConnectorKind };
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
export const validatorsMatchModel: Same<ConnectorKind, Infer<typeof connectorKind>> & Same<ConnectorDirection, Infer<typeof connectorDirection>> = true;
export type ConnectorMode = Infer<typeof connectorMode>;
export type ConnectorState = Infer<typeof connectorState>;
export type SyncJobKind = Infer<typeof syncJobKind>;

export function connectorsEnabled(): boolean {
  return process.env.VRDEX_EVENT_CONNECTORS_ENABLED === "true";
}

export const DISCORD_ID = /^\d{17,20}$/;

export async function userAuthSubject(db: DatabaseReader, userId: Id<"users">): Promise<AuthSubject | null> {
  const subject = (await db.get(userId))?.clerkUserId;
  const issuer = process.env.CLERK_JWT_ISSUER_DOMAIN;
  if (!subject || !issuer) return null;
  return { subject, issuer, tokenIdentifier: `${issuer}|${subject}` };
}

export async function userHasCommunityPermission(db: DatabaseReader, communityProfileId: Id<"profiles">, userId: Id<"users">, permissions: ClubPermission[]): Promise<boolean> {
  if ((await getAccountFeatureAccess(db, userId)).superAdmin) return true;
  if (await userOwnsProfile(db, communityProfileId, userId)) return true;
  const subject = await userAuthSubject(db, userId);
  if (!subject) return false;
  const actor = await resolveClubSubject(db, communityProfileId, subject);
  return permissions.some(permission => actor.permissions.includes(permission));
}

export async function requireConnectorAuthority(ctx: QueryCtx | MutationCtx, communityProfileId: Id<"profiles">, userId: Id<"users">): Promise<void> {
  if (!await userHasCommunityPermission(ctx.db, communityProfileId, userId, ["manage_integrations"])) throw new ConvexError({ code: "CONNECTOR_FORBIDDEN" });
}

type IntakeKey = keyof EventIntakeFields;
const TIME: IntakeKey[] = ["title", "eventDate", "timeTba", "timezone", "start", "end"];
const CARRIED: Record<ConnectorKind, ReadonlyArray<IntakeKey>> = {
  google_calendar: [...TIME, "summary", "venueLabel"],
  discord_scheduled_events: [...TIME, "summary", "venueLabel"],
  vrchat_calendar: [...TIME, "summary"],
  discord_board: [...TIME, "doors", "summary", "venueLabel", "worldSlug", "sourceUrl", "lineup"],
  discord_announcements: [...TIME, "doors", "summary", "venueLabel", "lineup"],
  notion: [],
};
export function carriedFields(kind: ConnectorKind): ReadonlyArray<IntakeKey> {
  return CARRIED[kind];
}

const position = (row: unknown) => (row && typeof row === "object" && typeof (row as { position?: unknown }).position === "number" ? (row as { position: number }).position : 0);
// Canonical form for hashing: blanks drop, keys sort, lineup rows sort by position and renumber from 0, clientKey and zero dayOffset drop.
export function canonicalIntakeValue(value: unknown): unknown {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "string") return value.trim() || undefined;
  if (Array.isArray(value)) return [...value].sort((a, b) => position(a) - position(b))
    .map((row, index) => canonicalIntakeValue(row && typeof row === "object" && "position" in row ? { ...row, position: index } : row));
  if (typeof value === "object") {
    const { clientKey: _clientKey, dayOffset, ...rest } = value as Record<string, unknown>;
    const out: Record<string, unknown> = Object.fromEntries(Object.keys(rest).sort().flatMap(key => {
      const item = canonicalIntakeValue(rest[key]);
      return item === undefined ? [] : [[key, item]];
    }));
    if (typeof dayOffset === "number" && dayOffset !== 0) out.dayOffset = dayOffset;
    return out;
  }
  return value;
}

// Every caller hashes through this one function, so a date-only round trip matches.
export function carriedFieldsHash(kind: ConnectorKind, fields: EventIntakeFields): string {
  const dateOnly = fields.timeTba === true;
  const pairs = [...carriedFields(kind)].sort().flatMap(key => {
    if (dateOnly && (key === "start" || key === "end" || key === "doors" || key === "timezone")) return [];
    // Only a true timeTba is meaningful; false and absent both mean a timed event.
    if (key === "timeTba" && !dateOnly) return [];
    const item = canonicalIntakeValue(fields[key]);
    return item === undefined ? [] : [[key, item]];
  });
  return sha256Hex(JSON.stringify(pairs));
}

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));

// Synchronous FIPS 180-4 SHA-256: the default Convex runtime only offers async crypto.subtle.digest.
export function sha256Hex(text: string): string {
  const bytes = new TextEncoder().encode(text);
  const blocks = Math.ceil((bytes.length + 9) / 64);
  const data = new Uint8Array(blocks * 64);
  data.set(bytes);
  data[bytes.length] = 0x80;
  const view = new DataView(data.buffer);
  const bits = bytes.length * 8;
  view.setUint32(data.length - 8, Math.floor(bits / 0x100000000));
  view.setUint32(data.length - 4, bits >>> 0);
  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const w = new Uint32Array(64);
  for (let offset = 0; offset < data.length; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = w[i - 16] + s0 + w[i - 7] + s1;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) >>> 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      hh = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    h[0] += a; h[1] += b; h[2] += c; h[3] += d; h[4] += e; h[5] += f; h[6] += g; h[7] += hh;
  }
  return Array.from(h, word => word.toString(16).padStart(8, "0")).join("");
}

// A connector's link points at a draft that is still awaiting publish; imports must not race it.
export async function pendingLinkDraft(db: DatabaseReader, link: Doc<"eventSyncLinks"> | null, now = Date.now()): Promise<Doc<"eventIntakeDrafts"> | null> {
  if (!link?.draftId) return null;
  const draft = await db.get(link.draftId);
  return draft && !draft.publishedReceiptId && draft.expiresAt > now ? draft : null;
}

// Handlers take `patch: eventIntakeUpdatePatchValidator` and parse with the zod schema, as eventCorrections.ts does.
export const EventIntakeUpdatePatchSchema = UpdateEventContributionSchema.shape.patch;
export type EventIntakeUpdatePatch = ReturnType<typeof EventIntakeUpdatePatchSchema.parse>;
export const eventIntakeUpdatePatchValidator = v.record(v.string(), v.any());
