"use client";

import { useState } from "react";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/cn";

export function LookupCopyButton({ className, label = "Copy", value }: { className?: string; label?: string; value: string }) {
  const [copied, setCopied] = useState(false);

  async function copyValue() {
    let copiedValue = false;

    try {
      await navigator.clipboard.writeText(value);
      copiedValue = true;
    } catch {
      const textArea = document.createElement("textarea");

      textArea.value = value;
      textArea.style.position = "fixed";
      textArea.style.left = "-9999px";
      document.body.append(textArea);
      textArea.focus();
      textArea.select();
      copiedValue = document.execCommand("copy");
      textArea.remove();
    }

    if (copiedValue) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    }
  }

  return (
    <button
      aria-label={copied ? "Copied" : label}
      className={cn(
        buttonVariants({ size: "sm", variant: "secondary" }),
        "lookup-copy-button px-2 py-1 text-xs",
        copied ? "lookup-copy-button--copied" : undefined,
        className,
      )}
      type="button"
      onClick={() => void copyValue()}
    >
      <span aria-hidden="true" className="lookup-copy-button__spark" />
      <span className="lookup-copy-button__content relative z-10">
        {copied ? (
          <svg aria-hidden="true" className="lookup-copy-button__check" fill="none" viewBox="0 0 16 16">
            <path d="m3.5 8.2 2.7 2.7 6.3-6.8" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
          </svg>
        ) : label}
      </span>
    </button>
  );
}
