import { v, type Infer } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { DatabaseReader } from "./_generated/server";
import { eventMediaSourceStateValidator } from "./_eventMediaControl";
import { canReadProfile } from "./_profilePermissions";
import { publicProfileOutboundLinks } from "./_profilePublic";
import { parseVrcdnStreamLinks, createVrcdnStreamLinks } from "./_vrcdnLinks";
import { twitchLoginFromUrl } from "./_twitchLinks";

export const broadcastInputValidator = v.union(
  v.object({ kind: v.literal("vrcdn"), streamId: v.string() }),
  v.object({ kind: v.literal("twitch"), channel: v.string() }),
);
export type BroadcastInputRef = Infer<typeof broadcastInputValidator>;
export type BroadcastInputChoice = { input: BroadcastInputRef; key: string; label: string };

export function parseBroadcastInputUrl(value: string): BroadcastInputRef {
  const channel = twitchLoginFromUrl(value);
  if (channel !== null) return { kind: "twitch", channel };
  const stream = parseVrcdnStreamLinks(value);
  if (stream !== null && stream.directVideoUrl === undefined) return { kind: "vrcdn", streamId: stream.streamId };
  throw new Error("Broadcast input must be a canonical VRCDN stream or Twitch channel.");
}

export function normalizeBroadcastInput(input: BroadcastInputRef): BroadcastInputRef {
  const normalized = parseBroadcastInputUrl(input.kind === "vrcdn" ? `vrcdn:${input.streamId}` : `https://www.twitch.tv/${input.channel}`);
  if (broadcastInputKey(normalized) !== broadcastInputKey(input)) {
    throw new Error("Broadcast input reference must be canonical.");
  }
  return normalized;
}

export function broadcastInputKey(input: BroadcastInputRef): string {
  return input.kind === "vrcdn" ? `vrcdn:${input.streamId}` : `twitch:${input.channel}`;
}

export function broadcastInputPublicUrl(input: BroadcastInputRef): string {
  const canonical = normalizeBroadcastInput(input);
  if (canonical.kind === "twitch") return `https://www.twitch.tv/${canonical.channel}`;
  const stream = createVrcdnStreamLinks(canonical.streamId);
  if (stream === null) throw new Error("Invalid VRCDN stream.");
  return stream.questUrl;
}

export function eventProfileBroadcastInputChoices(profile: Doc<"profiles">): BroadcastInputChoice[] {
  if (!canReadProfile("public", profile)) return [];
  const choices = new Map<string, BroadcastInputChoice>();
  for (const link of publicProfileOutboundLinks(profile, "discovery")) {
    const stream = parseVrcdnStreamLinks(link.url);
    const channel = link.type === "twitch" ? twitchLoginFromUrl(link.url) : null;
    const input: BroadcastInputRef | undefined = stream && !stream.directVideoUrl ? { kind: "vrcdn", streamId: stream.streamId } : channel ? { kind: "twitch", channel } : undefined;
    if (input) {
      const key = broadcastInputKey(input);
      if (!choices.has(key)) choices.set(key, { input, key, label: input.kind === "vrcdn" ? input.streamId : input.channel });
    }
  }
  return [...choices.values()].sort((a, b) => Number(a.input.kind === "twitch") - Number(b.input.kind === "twitch"));
}

export function resolveBroadcastInput({ choices, explicitInput, legacySelectedStreamId }: {
  choices: readonly BroadcastInputChoice[]; explicitInput?: BroadcastInputRef; legacySelectedStreamId?: string;
}): BroadcastInputRef | undefined {
  const explicitKey = explicitInput ? broadcastInputKey(explicitInput) : legacySelectedStreamId === undefined ? undefined : `vrcdn:${legacySelectedStreamId}`;
  if (explicitKey !== undefined) return choices.find(choice => choice.key === explicitKey)?.input;
  const vrcdn = choices.filter(choice => choice.input.kind === "vrcdn");
  return vrcdn.length === 0 ? choices.find(choice => choice.input.kind === "twitch")?.input : vrcdn.length === 1 ? vrcdn[0]?.input : undefined;
}

/** Normalize legacy provider rows without interpreting unrelated asset kinds. */
export function eventMediaSourceBroadcastInput(source: Pick<Doc<"eventMediaSources">, "input" | "type" | "publicUrl">): BroadcastInputRef | undefined {
  if (source.input !== undefined) return normalizeBroadcastInput(source.input);
  if (!source.publicUrl || (source.type !== "vrcdn_link" && source.type !== "twitch_watch")) return undefined;
  try {
    const input = parseBroadcastInputUrl(source.publicUrl);
    return (source.type === "vrcdn_link" ? input.kind === "vrcdn" : input.kind === "twitch") ? input : undefined;
  } catch { return undefined; }
}

export function authoredBroadcastInput({ value, previous, samePerson, profile }: {
  value?: BroadcastInputRef | null; previous?: BroadcastInputRef; samePerson: boolean; profile?: Doc<"profiles"> | null;
}): BroadcastInputRef | undefined {
  const input = value === undefined ? samePerson ? previous : undefined : value ?? undefined;
  if (input === undefined) return undefined;
  normalizeBroadcastInput(input);
  if (!(samePerson && previous && broadcastInputKey(previous) === broadcastInputKey(input)) &&
      (!profile || !eventProfileBroadcastInputChoices(profile).some(choice => choice.key === broadcastInputKey(input)))) {
    throw new Error("Broadcast input must belong to the performer's public inputs.");
  }
  return input;
}


/** Internal descriptors still pass through the relay's deployment allowlist and
 * public-address checks. Public authoring accepts only BroadcastInputRef URLs.
 */
export function eventMediaSourceWorkerDescriptor(source: Doc<"eventMediaSources">) {
  const input = eventMediaSourceBroadcastInput(source);
  const descriptor = {
    id: source._id, key: source.key, type: source.type, eventId: source.eventId,
    eventSlotId: source.eventSlotId, revision: source.revision ?? 1,
    privateConfigRef: source.privateConfigRef,
  };
  if (input) return { ...descriptor, input, publicUrl: broadcastInputPublicUrl(input) };
  if (source.input === undefined && source.publicUrl && (source.type === "rtmp_source" || source.type === "vrcdn_link")) {
    return { ...descriptor, input: undefined, publicUrl: source.publicUrl };
  }
  return undefined;
}

export async function eventMediaSourceProjectionAvailable(
  db: DatabaseReader,
  source: Doc<"eventMediaSources">,
) {
  const projected =
    source.profileProjection ||
    (source.eventSlotId !== undefined &&
      source.sourceProfileId !== undefined &&
      source.key === `slot-${source.eventSlotId}`);
  if (!projected) return true;
  const slot =
    source.eventSlotId === undefined ? null : await db.get(source.eventSlotId);
  if (!slot?.personProfileId || slot.eventId !== source.eventId) return false;
  const profile = await db.get(slot.personProfileId);
  if (!profile || !canReadProfile("public", profile)) return false;
  const input = resolveBroadcastInput({
    choices: eventProfileBroadcastInputChoices(profile),
    explicitInput: slot.broadcastInput,
    legacySelectedStreamId: slot.selectedStreamId,
  });
  return (
    input !== undefined &&
    broadcastInputPublicUrl(input) === source.publicUrl &&
    source.projectionAvailable !== false
  );
}

/** Bound usable rows, not disabled history or unavailable profile projections. */
export async function listUsableEventMediaSources(db: DatabaseReader, programId: Id<"eventMediaPrograms">, limit: number) {
  if (limit <= 0) return [];
  const states = eventMediaSourceStateValidator.members.map(state => state.value).filter(state => state !== "disabled");
  const rows = (await Promise.all(states.map(async state => {
    const usable: Doc<"eventMediaSources">[] = [];
    // Iterate the index so preexisting detached rows cannot exhaust a take(limit).
    // Retain at most limit rows per state instead of collecting source history.
    for await (const source of db.query("eventMediaSources")
      .withIndex("by_programId_state_position", q => q.eq("programId", programId).eq("state", state))) {
      if (await eventMediaSourceProjectionAvailable(db, source)) {
        usable.push(source);
        if (usable.length >= limit) break;
      }
    }
    return usable;
  }))).flat();
  return rows.sort((a, b) => a.position - b.position || a.key.localeCompare(b.key)).slice(0, limit);
}
