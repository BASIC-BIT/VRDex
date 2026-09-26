import { CopyValueRow } from "@/components/ui/copy-value-row";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { parseVrcdnStreamLinks } from "../../../../../convex/_vrcdnLinks";
import type { PublicEventLineupEntry } from "./event-public-page";

type DjTarget = { key: string; label: string; url: string; pcUrl?: string; questUrl?: string };

function djTarget(url: string): DjTarget | undefined {
  const stream = parseVrcdnStreamLinks(url);
  if (stream !== null) return stream.directVideoUrl
    ? { key: `vrcdn:${stream.directVideoUrl}`, label: "VRCDN", url: stream.directVideoUrl }
    : { key: `vrcdn:${stream.streamId}`, label: stream.streamId, url: stream.reference, pcUrl: stream.pcUrl, questUrl: stream.questUrl };
  try {
    const target = new URL(url);
    if (target.protocol !== "https:" || target.username || target.password || target.port) return;
    if (!["twitch.tv", "www.twitch.tv", "m.twitch.tv"].includes(target.hostname)) return;
    const channel = target.pathname.match(/^\/([a-zA-Z0-9_]{1,25})\/?$/)?.[1]?.toLowerCase();
    if (!channel || ["directory", "downloads", "jobs", "p", "search", "settings", "subscriptions", "videos"].includes(channel)) return;
    return { key: `twitch:${channel}`, label: "Twitch", url: `https://www.twitch.tv/${channel}` };
  } catch { return; }
}

/** Only discovery-visible links supplied with the public lineup are considered. */
export function EventDjLinks({ lineup }: { lineup: PublicEventLineupEntry[] }) {
  const groups = new Map<string, { name: string; targets: DjTarget[] }>();
  const seen = new Set<string>();
  for (const row of lineup) {
    if (!row.performer) continue;
    for (const link of row.performer.outboundLinks ?? []) {
      const target = djTarget(link.url);
      if (target === undefined || seen.has(target.key)) continue;
      seen.add(target.key);
      const group = groups.get(row.performer.slug) ?? { name: row.performer.displayName, targets: [] };
      group.targets.push(target);
      groups.set(row.performer.slug, group);
    }
  }
  if (groups.size === 0) return null;
  return <details className="rounded-panel border border-border bg-surface-strong p-5 sm:p-6">
    <summary className="cursor-pointer font-semibold focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent">DJ links</summary>
    <div className="mt-5 grid gap-5 sm:grid-cols-2">
      {Array.from(groups, ([slug, group]) => <section className="min-w-0" key={slug}>
        <h3 className="font-semibold [overflow-wrap:anywhere]">{group.name}</h3>
        <div className="mt-2 grid gap-2">
          {group.targets.map(target => target.pcUrl && target.questUrl
            ? <details className="min-w-0 rounded-control border border-border p-3" key={target.key}>
                <summary className="cursor-pointer text-sm font-medium [overflow-wrap:anywhere]">VRCDN · {target.label}</summary>
                <div className="mt-2"><CopyValueRow label="PC" value={target.pcUrl} /><CopyValueRow label="Quest" value={target.questUrl} /></div>
              </details>
            : <a className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "w-fit")} href={target.url} rel="noreferrer" target="_blank" key={target.key}>{target.label}</a>)}
        </div>
      </section>)}
    </div>
  </details>;
}
