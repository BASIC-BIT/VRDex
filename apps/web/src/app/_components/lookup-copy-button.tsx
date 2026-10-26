"use client";

import { useEffect, useRef, useState } from "react";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/cn";

export function LookupCopyButton({ className, label = "Copy", value }: { className?: string; label?: string; value: string }) {
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");
  const buttonRef = useRef<HTMLButtonElement>(null);
  const copyOperation = useRef(0);
  const resetTimer = useRef<number | undefined>(undefined);
  const copied = status === "copied";

  useEffect(() => () => {
    copyOperation.current++;
    window.clearTimeout(resetTimer.current);
  }, []);

  async function copyValue() {
    const operation = ++copyOperation.current;
    const button = buttonRef.current;
    let copiedValue = false;
    window.clearTimeout(resetTimer.current);
    setStatus("idle");

    try {
      await navigator.clipboard.writeText(value);
      copiedValue = true;
    } catch {
      if (operation !== copyOperation.current || !button?.isConnected) return;
      const textArea = document.createElement("textarea");

      try {
        textArea.value = value;
        textArea.readOnly = true;
        textArea.tabIndex = -1;
        textArea.setAttribute("aria-hidden", "true");
        textArea.style.position = "fixed";
        textArea.style.left = "-9999px";
        document.body.append(textArea);
        textArea.focus({ preventScroll: true });
        textArea.select();
        copiedValue = document.execCommand("copy");
      } catch {
        copiedValue = false;
      } finally {
        textArea.remove();
        if (button?.isConnected) button.focus({ preventScroll: true });
      }
    }

    if (operation === copyOperation.current && button?.isConnected) {
      window.clearTimeout(resetTimer.current);
      setStatus(copiedValue ? "copied" : "failed");
      resetTimer.current = window.setTimeout(() => {
        resetTimer.current = undefined;
        setStatus("idle");
      }, 1400);
    }
  }

  return (
    <>
      <button
        aria-label={copied ? "Copied" : label}
        className={cn(
          buttonVariants({ size: "sm", variant: "secondary" }),
          "lookup-copy-button px-2 py-1 text-xs",
          copied ? "lookup-copy-button--copied" : undefined,
          className,
        )}
        type="button"
        ref={buttonRef}
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
      <span aria-atomic="true" className="sr-only" role="status">
        {status === "copied" ? "Copied" : status === "failed" ? "Copy failed" : ""}
      </span>
    </>
  );
}
