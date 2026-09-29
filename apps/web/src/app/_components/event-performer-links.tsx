import { CopyValueRow } from "@/components/ui/copy-value-row";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { parseVrcdnStreamLinks } from "../../../../../convex/_vrcdnLinks";
import { profileLinkPresentation } from "../../../../../convex/_profileLinkPresentation";
import { parseProfileLinkDestination } from "../../../../../convex/_profileLinkDestination";
import type { EventOutboundLinks } from "./event-public-page";

/** Receives discovery-filtered event links. Never fetches profile-page links or media. */
export function EventPerformerLinks({ links }: { links: EventOutboundLinks }) {
  const seen = new Set<string>();
  return <div className="mt-3 grid min-w-0 gap-2 empty:hidden">
    {links.map(link => {
      const stream = parseVrcdnStreamLinks(link.url);
      const key = stream?.directVideoUrl ?? stream?.reference ?? link.url;
      if (seen.has(key)) return null;
      seen.add(key);
      if (stream && stream.directVideoUrl === undefined) return <div className="min-w-0" key={key}>
        <p className="text-sm font-medium [overflow-wrap:anywhere]">{link.label}</p>
        <CopyValueRow label="PC" value={stream.pcUrl} />
        <CopyValueRow label="Quest" value={stream.questUrl} />
      </div>;
      if (link.type === "discord" && parseProfileLinkDestination(link)?.kind !== "discord_guild") {
        const handle = link.handle ?? link.label.replace(/^Discord\s*:?\s*/i, "").trim();
        if (handle && handle.toLowerCase() !== "discord") return <CopyValueRow key={key} label="Discord" value={handle} />;
      }
      if (link.presentation === "copy") return <CopyValueRow key={key} label={link.label} value={link.url} />;
      let href: string;
      try { const url = new URL(link.url); if (url.protocol !== "https:") return null; href = url.href; } catch { return null; }
      const presentation = profileLinkPresentation(link);
      return <a key={key} className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "w-fit max-w-full justify-start text-left [overflow-wrap:anywhere]")} href={href} rel="noreferrer" target="_blank">{presentation.label}</a>;
    })}
  </div>;
}
