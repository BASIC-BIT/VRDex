"use client";

import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/field";

async function copyText(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    const textArea = document.createElement("textarea");

    textArea.value = value;
    textArea.style.position = "fixed";
    textArea.style.left = "-9999px";
    document.body.append(textArea);
    textArea.focus();
    textArea.select();

    const copied = document.execCommand("copy");

    textArea.remove();
    return copied;
  }
}

export function EventDiscordExportPanel({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const rows = useMemo(() => Math.min(Math.max(text.split("\n").length + 1, 8), 18), [text]);

  async function onCopy() {
    if (await copyText(text)) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    }
  }

  return (
    <Card className="grid gap-4" surface="white">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-xl font-semibold">Discord post</h2>
        <Button className="w-full sm:w-fit" onClick={() => void onCopy()} type="button" variant="secondary">
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <Textarea
        aria-label="Discord-ready event post"
        className="resize-y bg-white font-mono text-xs leading-5"
        readOnly
        rows={rows}
        value={text}
      />
    </Card>
  );
}
