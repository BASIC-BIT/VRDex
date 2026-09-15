import type { PlaybackSlot } from "./event-playback";
export type LineupSlot = PlaybackSlot & { performerId?: string; label?: string };
export function reconcileSlot(previous: LineupSlot, slots: readonly LineupSlot[]): LineupSlot | undefined {
  if (!previous.stream) return undefined;
  const sameSource = (slot: LineupSlot) => slot.stream?.streamId === previous.stream?.streamId;
  const exact = slots.filter(slot => slot.key === previous.key);
  if (exact.length) return exact.length === 1 && sameSource(exact[0]) ? exact[0] : undefined;
  if (!previous.performerId) return undefined;
  const matches = slots.filter(slot => slot.performerId === previous.performerId && slot.startAt === previous.startAt && sameSource(slot));
  return matches.length === 1 ? matches[0] : undefined;
}
export function nextSlot(current: LineupSlot, slots: readonly LineupSlot[]): LineupSlot | undefined {
  const index = slots.findIndex(slot => slot.key === current.key);
  if (index < 0 || slots.filter(slot => slot.key === current.key).length !== 1) return undefined;
  // An ordered sequence must not invent a winner for simultaneous or overlapping slots.
  if (slots.some((slot, i) => i > 0 && (slot.startAt <= slots[i-1].startAt || (slots[i-1].endAt ?? slot.startAt) > slot.startAt))) return undefined;
  return slots[index + 1];
}
