import type { PublicEvent } from '../app/_components/event-public-page';
import { eventDjTarget } from './event-dj-target';
import type { PublicStatusSource } from './event-source-observations';

/** Spend one four-probe wave on current/upcoming performers. All authored links
 * remain in the roster; omitted health is unknown, never inferred offline.
 */
export function eventHostStatusSources(event: PublicEvent, now: number): PublicStatusSource[] {
  const slots = [...event.slots].sort((a, b) => a.startAt - b.startAt);
  const current = slots.filter((slot, index) => {
    const end = slot.endAt ?? slots[index + 1]?.startAt;
    return slot.startAt <= now && (end === undefined || now < end);
  });
  const upcoming = slots.find(slot => slot.startAt > now);
  const rows = [...current, ...(upcoming ? [upcoming] : [])].slice(0, 2);
  const performers = rows.length ? rows : (event.lineup ?? event.participants.map(performer => ({ performer }))).slice(0, 2);
  const targets = performers.map(row => {
    const choices = [...new Map((row.performer?.outboundLinks ?? []).flatMap(link => {
      const target = eventDjTarget(link.url);
      return target ? [[target.key, target] as const] : [];
    })).values()];
    const selected = 'stream' in row && row.stream ? `vrcdn:${row.stream.streamId}` : undefined;
    const primary = choices.find(target => target.key === selected) ?? choices.find(target => target.pcUrl) ?? choices[0];
    return primary ? [primary, ...choices.filter(target => target !== primary)] : [];
  });
  const sources = new Map<string, PublicStatusSource>();
  // Round-robin alternatives so the upcoming performer's primary is not hidden
  // by a current performer with many alternate accounts.
  for (let index = 0; sources.size < 4 && targets.some(row => row[index]); index++) {
    for (const row of targets) {
      const target = row[index];
      if (target && sources.size < 4) sources.set(target.key, { key: target.key, url: target.url });
    }
  }
  return [...sources.values()];
}
