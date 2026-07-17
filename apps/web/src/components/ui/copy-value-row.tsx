"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/cn";

export function CopyValueRow({
  className,
  label,
  value,
}: {
  className?: string;
  label: string;
  value: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copyValue() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className={cn("grid min-w-0 gap-1 border-t border-border py-3 first:border-t-0", className)}>
      <span className="text-xs font-medium text-muted">{label}</span>
      <div className="flex min-w-0 items-center gap-2">
        <code className="min-w-0 flex-1 truncate font-mono text-xs text-foreground sm:text-sm" title={value}>
          {value}
        </code>
        <button
          aria-label={copied ? `${label} copied` : `Copy ${label}`}
          className={cn(buttonVariants({ size: "sm", variant: "ghost" }), "size-9 shrink-0 p-0")}
          title={copied ? "Copied" : `Copy ${label}`}
          type="button"
          onClick={() => void copyValue()}
        >
          {copied ? <Check aria-hidden="true" className="size-4" /> : <Copy aria-hidden="true" className="size-4" />}
        </button>
      </div>
    </div>
  );
}
