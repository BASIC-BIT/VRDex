"use client";

import { useState } from "react";

import { buttonVariants, Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/cn";
import { parseVrcdnStreamLinks, type VrcdnStreamLinks } from "../../../../../convex/_vrcdnLinks";

type DerivedVrcdnStreamLinks = VrcdnStreamLinks & {
  label: string;
};

function mediaLineUrl(line: string): string {
  const parts = line.split("|").map((part) => part.trim());

  if (parts.length >= 3) {
    return parts[2] ?? "";
  }

  return line.trim();
}

export function deriveVrcdnMediaLinks(mediaLinksText: string): DerivedVrcdnStreamLinks[] {
  const links: DerivedVrcdnStreamLinks[] = [];
  const seenStreamIds = new Set<string>();

  for (const line of mediaLinksText.split("\n")) {
    const trimmed = line.trim();

    if (!trimmed) {
      continue;
    }

    const parts = trimmed.split("|").map((part) => part.trim());
    const parsedLinks = parseVrcdnStreamLinks(mediaLineUrl(trimmed));

    if (parsedLinks === null || seenStreamIds.has(parsedLinks.streamId)) {
      continue;
    }

    seenStreamIds.add(parsedLinks.streamId);
    links.push({
      ...parsedLinks,
      label: parts.length >= 3 ? parts[1] || "VRCDN stream" : "VRCDN stream",
    });
  }

  return links;
}

function VrcdnLinkRow({
  copied,
  label,
  onCopy,
  value,
}: {
  copied: boolean;
  label: string;
  onCopy: () => void;
  value: string;
}) {
  return (
    <div className="grid gap-2 rounded-control border border-border bg-surface-strong p-3 sm:grid-cols-[7.5rem_1fr_auto] sm:items-center">
      <div className="text-sm font-semibold">{label}</div>
      <code className="break-all rounded-control bg-surface-strong px-3 py-2 text-xs leading-5 text-muted">{value}</code>
      <Button className="w-full sm:w-fit" onClick={onCopy} size="sm" type="button" variant="surface">
        {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}

export function VrcdnMediaLinkAssistant({
  className,
  mediaLinksText,
}: {
  className?: string;
  mediaLinksText: string;
}) {
  const [copiedValue, setCopiedValue] = useState<string | null>(null);
  const vrcdnLinks = deriveVrcdnMediaLinks(mediaLinksText);

  if (vrcdnLinks.length === 0) {
    return null;
  }

  async function copyValue(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedValue(value);
      window.setTimeout(() => setCopiedValue((current) => (current === value ? null : current)), 1_400);
    } catch {
      setCopiedValue(null);
    }
  }

  return (
    <Card className={cn("grid gap-4 border-accent/20 bg-accent/5", className)} padding="sm" surface="white">
      <div className="grid gap-1">
        <h3 className="text-base font-semibold tracking-[-0.02em]">VRCDN stream links</h3>
      </div>

      <div className="grid gap-4">
        {vrcdnLinks.map((link) => (
          <section className="grid gap-3" key={link.streamId}>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-sm text-muted">
                Stream ID <code className="font-mono text-foreground">{link.streamId}</code>
              </div>
              <a
                className={cn(buttonVariants({ size: "sm", variant: "secondary" }), "w-full sm:w-fit")}
                href={link.pageUrl}
                rel="noreferrer"
                target="_blank"
              >
                Open preview
              </a>
            </div>
            <VrcdnLinkRow
              copied={copiedValue === link.questUrl}
              label="Quest MPEG-TS"
              onCopy={() => void copyValue(link.questUrl)}
              value={link.questUrl}
            />
            <VrcdnLinkRow
              copied={copiedValue === link.pcUrl}
              label="PC RTSPT"
              onCopy={() => void copyValue(link.pcUrl)}
              value={link.pcUrl}
            />
          </section>
        ))}
      </div>
    </Card>
  );
}
